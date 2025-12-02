# -*- coding: utf-8 -*-
"""
Agent Service with OpenAI Agents SDK

This is a modern implementation of the agent service using the OpenAI Agents SDK.
It provides better tool handling, native MCP support, and automatic session management.
"""
import re
import time
import json
import asyncio
import threading
import requests
from typing import Optional, Tuple, List, Dict, Set
from openai import AsyncOpenAI

# OpenAI Agents SDK imports
from agents import (
    Agent,
    Runner,
    RunConfig,
    function_tool,
    ModelProvider,
    ModelSettings,
    set_default_openai_client,
    set_default_openai_api,
    set_tracing_disabled,
)
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from agents.tool import FunctionTool
from agents.run_context import RunContextWrapper

# Configuration constants
API_BASE = "http://localhost:4000"
AGENT_TOKEN = "dev-agent-token"
DEFAULT_AGENT_ID = "helper-agent-1"
POLL_INTERVAL = 1
HEARTBEAT_INTERVAL = 5
DEFAULT_PROACTIVE_COOLDOWN = 30
CONVERSATION_ID = "global"
DEFAULT_AGENT_USER_ID = "llm1"
CONTEXT_LIMIT = 10
REQUEST_TIMEOUT = 10

# Precompiled regex patterns for cleaning model output
_RE_FINAL_CHANNEL = re.compile(r"<\|channel\|>final<\|message\|>(.*?)(?:<\|end\|>|$)", re.DOTALL)
_RE_THINK_TAG = re.compile(r"<think>.*?</think>", re.DOTALL)
_RE_START_BLOCK = re.compile(r"<\|start\|>.*?(?=<\|start\|>|$)", re.DOTALL)
_RE_CHANNEL_BLOCK = re.compile(r"<\|channel\|>[^<]*<\|message\|>.*?(?:<\|end\|>|<\|start\|>|$)", re.DOTALL)
_RE_SPECIAL_TAG = re.compile(r"<\|[^>]+\|>")
_RE_KEYWORDS = re.compile(r"^(analysis|commentary|thinking|final)\s*", re.IGNORECASE | re.MULTILINE)
_RE_JSON_REACTION = re.compile(r'\{[^}]*"(?:reaction|emoji)"[^}]*\}')
_RE_MULTI_NEWLINES = re.compile(r"\n{3,}")
_RE_MSG_PREFIX = re.compile(r"\[msg:[a-f0-9\-]+\]\s*<[^>]+>\s*(?:\[TO:[^\]]+\]\s*)?:?\s*")
_RE_NATIVE_CHANNEL_BLOCK = re.compile(
    r"<\|channel\|>(?:analysis|commentary|tool)[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>.*?(?:<\|end\|>|<\|call\|>|<\|start\|>|$)",
    re.DOTALL | re.IGNORECASE
)
_RE_NATIVE_TOOL_CALL = re.compile(
    r"<\|channel\|>(?:commentary|analysis|tool)\s+to=\w+[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\{[^}]*\}(?:<\|call\|>)?",
    re.DOTALL | re.IGNORECASE
)
_RE_JSON_TOOL_CALL = re.compile(r'\{"(?:query|id|search)[^}]*\}')

# Native Harmony COT tool call patterns - multiple formats the model may output:
# Pattern 1: <|channel|>commentary to=TOOL <|constrain|>json<|message|>{...}<|call|>
# Pattern 2: <|channel|>commentary to=TOOL code<|message|>{...}<|call|>  (no constrain)
# Pattern 3: <|channel|>commentary to= TOOL <|constrain|>...<|message|>{...}<|call|> (space after =)
_RE_TOOL_PATTERNS = [
    # Most specific: with <|constrain|>
    re.compile(
        r"<\|channel\|>(?:commentary|analysis)\s+to=\s*(\w+)[^<]*<\|constrain\|>[^<]*<\|message\|>(\{[^}]*\})(?:<\|call\|>)?",
        re.DOTALL | re.IGNORECASE
    ),
    # Without <|constrain|>: to=TOOL ...code/other...<|message|>
    re.compile(
        r"<\|channel\|>(?:commentary|analysis)\s+to=\s*(\w+)[^<]*<\|message\|>(\{[^}]*\})(?:<\|call\|>)?",
        re.DOTALL | re.IGNORECASE
    ),
    # Fallback: any "to=TOOL" followed by JSON in <|message|>
    re.compile(
        r"to=\s*(\w+)[^{]*(\{[^}]+\})",
        re.DOTALL | re.IGNORECASE
    ),
]


def strip_special_tags(text: str) -> str:
    """Clean model output of special tags, keeping only final answer."""
    if not text:
        return ""

    # 1. Try to extract final channel content
    final_match = _RE_FINAL_CHANNEL.search(text)
    if final_match:
        text = final_match.group(1)
    else:
        # Remove all analysis/commentary blocks
        text = _RE_NATIVE_TOOL_CALL.sub("", text)
        text = _RE_NATIVE_CHANNEL_BLOCK.sub("", text)

    # 2. Remove <think>...</think>
    text = _RE_THINK_TAG.sub("", text)

    # 3. Remove complete channel blocks
    text = _RE_START_BLOCK.sub("", text)
    text = _RE_CHANNEL_BLOCK.sub("", text)

    # 4. Remove remaining special tags
    text = _RE_SPECIAL_TAG.sub("", text)

    # 5. Clean residual keywords at line start
    text = _RE_KEYWORDS.sub("", text)

    # 6. Remove JSON tool call residuals
    text = _RE_JSON_REACTION.sub("", text)
    text = _RE_JSON_TOOL_CALL.sub("", text)

    # 7. Remove LLM miscopied message prefix format
    text = _RE_MSG_PREFIX.sub("", text)

    # 8. Clean excess newlines
    text = _RE_MULTI_NEWLINES.sub("\n\n", text)

    return text.strip()


def parse_native_tool_calls(response: str) -> List[Dict]:
    """
    Parse native Harmony COT tool calls from model response.

    Handles multiple formats:
    - <|channel|>commentary to=TOOL <|constrain|>json<|message|>{...}<|call|>
    - <|channel|>commentary to=TOOL code<|message|>{...}<|call|>
    - to=TOOL ...{json}...

    Returns list of {"tool": name, "args": dict}
    """
    tool_calls = []
    seen = set()  # Deduplicate

    # Try each pattern in order of specificity
    for i, pattern in enumerate(_RE_TOOL_PATTERNS):
        matches = pattern.findall(response)
        if matches:
            print(f"[Tools] Pattern {i+1} matched {len(matches)} tool call(s)")
            for tool_name, args_json in matches:
                # Clean up tool name and args
                tool_name = tool_name.strip()
                args_json = args_json.strip()

                # Skip duplicates
                call_key = (tool_name, args_json)
                if call_key in seen:
                    continue
                seen.add(call_key)

                # Skip if tool name looks invalid (too short, just "code", etc.)
                if len(tool_name) < 3 or tool_name.lower() in ('code', 'json', 'end', 'call'):
                    continue

                try:
                    args = json.loads(args_json)
                    tool_calls.append({"tool": tool_name, "args": args})
                    print(f"[Tools] Parsed: {tool_name}({args})")
                except json.JSONDecodeError:
                    print(f"[Tools] Invalid JSON for {tool_name}: {args_json[:50]}...")

    if not tool_calls:
        print("[Tools] No tool calls detected in response")

    return tool_calls


def extract_final_response(response: str) -> str:
    """
    Extract the final response from Harmony COT format.

    Looks for: <|channel|>final<|message|>CONTENT
    Falls back to strip_special_tags if not found.
    """
    final_match = _RE_FINAL_CHANNEL.search(response)
    if final_match:
        return final_match.group(1).strip()

    # Fallback: clean all special tags
    return strip_special_tags(response)


class AgentContext:
    """
    Context object passed to tools containing agent state and API access.
    """
    def __init__(
        self,
        api_base: str,
        agent_id: str,
        headers: Dict[str, str],
        session: requests.Session,
        conversation_id: str,
        current_msg: Optional[Dict] = None,
    ):
        self.api_base = api_base
        self.agent_id = agent_id
        self.headers = headers
        self.session = session
        self.conversation_id = conversation_id
        self.current_msg = current_msg

    def get_context(self, message_id: str, before: int = 5, after: int = 4) -> Optional[Dict]:
        """Get context around a specific message."""
        try:
            resp = self.session.get(
                f"{self.api_base}/agents/{self.agent_id}/context",
                params={
                    "messageId": message_id,
                    "before": before,
                    "after": after,
                    "conversationId": self.conversation_id,
                },
                headers=self.headers,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.RequestException:
            return None

    def get_long_context(self, max_messages: int = 50) -> Optional[Dict]:
        """Get full conversation history."""
        try:
            resp = self.session.get(
                f"{self.api_base}/agents/{self.agent_id}/long-context",
                params={
                    "maxMessages": min(max_messages, 200),
                    "conversationId": self.conversation_id,
                    "includeSystemPrompt": "false",
                },
                headers=self.headers,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.RequestException:
            return None

    def web_search(self, query: str, max_results: int = 5) -> Optional[Dict]:
        """Search the web for information."""
        try:
            resp = self.session.post(
                f"{self.api_base}/agents/{self.agent_id}/tools/web-search",
                json={"query": query, "maxResults": max_results},
                headers=self.headers,
                timeout=30,
            )
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.RequestException:
            return None

    def local_rag(self, query: str, top_k: int = 5) -> Optional[Dict]:
        """Search the local knowledge base."""
        try:
            resp = self.session.post(
                f"{self.api_base}/agents/{self.agent_id}/tools/local-rag",
                json={"query": query, "topK": top_k},
                headers=self.headers,
                timeout=15,
            )
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.RequestException:
            return None

    def execute_mcp_tool(self, mcp_config: Dict, tool_name: str, arguments: Dict) -> Optional[Dict]:
        """Execute an MCP tool via backend proxy."""
        server_url = mcp_config.get("endpoint") or mcp_config.get("url", "")
        api_key = mcp_config.get("apiKey", "")
        transport = mcp_config.get("transport")

        if not server_url:
            print(f"[MCP] No server URL configured for tool {tool_name}")
            return None

        try:
            payload = {
                "serverUrl": server_url,
                "apiKey": api_key,
                "toolName": tool_name,
                "arguments": arguments,
            }
            if transport:
                payload["mcpTransport"] = transport

            print(f"[MCP] Executing {tool_name} via {self.api_base}/mcp/execute")
            resp = self.session.post(
                f"{self.api_base}/mcp/execute",
                json=payload,
                headers=self.headers,
                timeout=30,
            )
            print(f"[MCP] {tool_name} response: HTTP {resp.status_code}")
            if resp.status_code == 200:
                resp_json = resp.json()
                print(f"[MCP] {tool_name} response keys: {list(resp_json.keys())}")
                # Try different keys the backend might use
                result = resp_json.get("result") or resp_json.get("data") or resp_json.get("content")
                if result:
                    print(f"[MCP] {tool_name} succeeded, result type: {type(result).__name__}")
                else:
                    print(f"[MCP] {tool_name} no result found in response: {str(resp_json)[:300]}")
                return result
            else:
                print(f"[MCP] {tool_name} failed: HTTP {resp.status_code} - {resp.text[:200]}")
                return None
        except requests.RequestException as e:
            print(f"[MCP] {tool_name} request error: {e}")
            return None

    def add_reaction(self, message_id: str, emoji: str) -> bool:
        """Add reaction to a message."""
        try:
            resp = self.session.post(
                f"{self.api_base}/agents/{self.agent_id}/reactions",
                json={"messageId": message_id, "emoji": emoji},
                headers=self.headers,
                timeout=REQUEST_TIMEOUT,
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False


# Global context for tools (will be set per-request)
_current_context: Optional[AgentContext] = None


def set_tool_context(ctx: AgentContext):
    """Set the current context for tool execution."""
    global _current_context
    _current_context = ctx


def get_tool_context() -> Optional[AgentContext]:
    """Get the current tool context."""
    return _current_context


# =============================================================================
# Function Tools (using @function_tool decorator)
# =============================================================================

@function_tool
def get_context(message_id: str) -> str:
    """
    Get 10 messages around a specific message for context.
    Use this when you need to understand what was being discussed around a particular message.

    Args:
        message_id: The ID of the message to get context around (from [msg:xxx] prefix)
    """
    ctx = get_tool_context()
    if not ctx:
        return "[Error: No context available]"

    result = ctx.get_context(message_id)
    if not result:
        return f"[Could not retrieve context for message {message_id}]"

    messages = result.get("messages", [])
    users = result.get("users", [])
    user_map = {u["id"]: u.get("name", "User") for u in users}

    lines = []
    for msg in messages:
        sender_id = msg.get("senderId", "")
        sender_name = user_map.get(sender_id, "Unknown")
        content = msg.get("content", "")[:200]
        lines.append(f"[{sender_name}]: {content}")

    return "\n".join(lines) if lines else "[No messages found]"


@function_tool
def get_long_context() -> str:
    """
    Get the full conversation history for comprehensive understanding.
    Use this when you need to summarize or understand the entire conversation.
    """
    ctx = get_tool_context()
    if not ctx:
        return "[Error: No context available]"

    result = ctx.get_long_context()
    if not result:
        return "[Could not retrieve conversation history]"

    messages = result.get("messages", [])
    users = result.get("users", [])
    user_map = {u["id"]: u.get("name", "User") for u in users}

    lines = []
    for msg in messages[-50:]:  # Limit to recent 50
        sender_id = msg.get("senderId", "")
        sender_name = user_map.get(sender_id, "Unknown")
        content = msg.get("content", "")[:200]
        ts = msg.get("timestamp", 0)
        time_str = time.strftime("%H:%M", time.localtime(ts / 1000)) if ts else "??:??"
        lines.append(f"[{time_str}] {sender_name}: {content}")

    return "\n".join(lines) if lines else "[No messages in history]"


@function_tool
def web_search(query: str) -> str:
    """
    Search the web for current information. ALWAYS use this for:
    - Current events, news, sports scores, standings
    - Recent developments (anything after your knowledge cutoff)
    - Real-time data (stock prices, weather, etc.)
    - Facts you're unsure about

    Args:
        query: The search query
    """
    ctx = get_tool_context()
    if not ctx:
        return "[Error: No context available]"

    print(f"[SDK Tool] Executing web_search: {query}")
    result = ctx.web_search(query, max_results=5)
    if not result:
        return f"[Web search failed for: {query}]"

    results = result.get("results", [])
    if not results:
        return "[No search results found]"

    formatted = []
    for i, r in enumerate(results[:5], 1):
        title = r.get("title", "No title")
        url = r.get("actualUrl", r.get("url", ""))
        content = r.get("content", r.get("snippet", ""))
        formatted.append(f"{i}. **{title}**\n   URL: {url}\n   {content}")

    return "\n\n".join(formatted)


@function_tool
def local_rag(query: str) -> str:
    """
    Search the local knowledge base for relevant documents.
    Use this when the user asks about:
    - Uploaded documents or attachments
    - Company policies, rules, procedures
    - Specific document names mentioned by the user

    Args:
        query: The search query
    """
    ctx = get_tool_context()
    if not ctx:
        return "[Error: No context available]"

    print(f"[SDK Tool] Executing local_rag: {query}")
    result = ctx.local_rag(query)
    if not result:
        return f"[RAG search failed for: {query}]"

    chunks = result.get("chunks", [])
    if not chunks:
        return "[No relevant documents found in knowledge base]"

    formatted = ["**Relevant information from knowledge base:**"]
    for chunk in chunks[:5]:
        source = chunk.get("source", "Unknown document")
        content = chunk.get("content", "")
        score = chunk.get("score", 0)
        formatted.append(f"[Source: {source}] (relevance: {score:.2f})\n{content}")

    return "\n---\n".join(formatted)


@function_tool
def add_reaction(message_id: str, emoji: str) -> str:
    """
    Add an emoji reaction to a message.
    Use this for simple acknowledgments (thanks, ok, etc.) instead of text replies.

    Args:
        message_id: The message ID from [msg:xxx] prefix
        emoji: Any emoji like 👍 ❤️ 😂 🎉
    """
    ctx = get_tool_context()
    if not ctx:
        return "[Error: No context available]"

    print(f"[SDK Tool] Adding reaction {emoji} to {message_id}")
    success = ctx.add_reaction(message_id, emoji)
    return f"[Reaction {emoji} added to {message_id}]" if success else "[Failed to add reaction]"


# =============================================================================
# Custom Model Provider for OpenAI-compatible endpoints
# =============================================================================

class CustomModelProvider(ModelProvider):
    """Custom model provider for OpenAI-compatible endpoints."""

    def __init__(self, base_url: str, api_key: str = "not-needed", model_name: str = "default"):
        self.base_url = base_url
        self.api_key = api_key
        self.model_name = model_name
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)

    def get_model(self, model_name: str = None):
        return OpenAIChatCompletionsModel(
            model=model_name or self.model_name,
            openai_client=self._client,
        )


# =============================================================================
# Dynamic MCP Tool Factory
# =============================================================================

def create_mcp_tool(mcp_config: Dict, tool_info: Dict) -> FunctionTool:
    """
    Create a FunctionTool for an MCP tool dynamically.

    Args:
        mcp_config: MCP server configuration (url, apiKey, etc.)
        tool_info: Tool definition from MCP server (name, description, inputSchema)
    """
    tool_name = tool_info.get("name", "unknown")
    description = tool_info.get("description", "No description")
    input_schema = tool_info.get("inputSchema", {}) or tool_info.get("parameters", {})

    # Build JSON schema for parameters
    properties = input_schema.get("properties", {})
    required = input_schema.get("required", [])

    # If no properties, check if params are at top level
    if not properties and input_schema:
        properties = {k: v for k, v in input_schema.items()
                      if isinstance(v, dict) and "type" in v}

    params_schema = {
        "type": "object",
        "properties": properties,
        "required": required,
    }

    async def invoke_mcp_tool(ctx: RunContextWrapper[AgentContext], args_json: str) -> str:
        """Execute the MCP tool."""
        tool_ctx = get_tool_context()
        if not tool_ctx:
            return f"[Error: No context for MCP tool {tool_name}]"

        try:
            args = json.loads(args_json)
        except json.JSONDecodeError:
            return f"[Invalid JSON arguments for {tool_name}]"

        print(f"[SDK MCP Tool] Executing {tool_name}: {args}")
        result = tool_ctx.execute_mcp_tool(mcp_config, tool_name, args)

        if result is None:
            return f"[MCP tool {tool_name} returned no result]"

        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            return f"**Result from {tool_name}:**\n" + "\n".join(f"- {k}: {v}" for k, v in result.items())
        if isinstance(result, list):
            return f"**Result from {tool_name}:**\n" + "\n".join(f"{i}. {item}" for i, item in enumerate(result, 1))
        return str(result)

    return FunctionTool(
        name=f"mcp_{tool_name}",
        description=f"[MCP] {description}",
        params_json_schema=params_schema,
        on_invoke_tool=invoke_mcp_tool,
    )


# =============================================================================
# SDK-based Agent Service
# =============================================================================

class AgentServiceSDK:
    """
    Agent Service using OpenAI Agents SDK.

    This provides a modern, SDK-based implementation with:
    - Native tool support via @function_tool
    - Automatic tool loop handling
    - MCP tool integration
    - Better structured outputs
    """

    def __init__(
        self,
        api_base: str = API_BASE,
        agent_token: str = AGENT_TOKEN,
        agent_id: str = DEFAULT_AGENT_ID,
        agent_user_id: str = DEFAULT_AGENT_USER_ID,
    ):
        self.api_base = api_base
        self.agent_token = agent_token
        self.agent_id = agent_id
        self.agent_user_id = agent_user_id
        self.last_seen_timestamp = int(time.time() * 1000)
        self.processed_message_ids: Set[str] = set()
        self.reacted_message_ids: Set[str] = set()
        self.last_proactive_time: float = 0
        self.agent_config: Optional[Dict] = None
        self.jwt_token: Optional[str] = None
        self._running = False

        # HTTP session
        self._session = requests.Session()
        self._agent_headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": self.agent_token,
        }

        # User cache
        self._user_map_cache: Dict[str, str] = {}
        self._agent_name_cache: Optional[str] = None

        # SDK components (initialized after config fetch)
        self._model_provider: Optional[CustomModelProvider] = None
        self._agent: Optional[Agent] = None

    def _get_auth_headers(self) -> Dict[str, str]:
        """Get JWT auth headers."""
        if self.jwt_token:
            return {"Authorization": f"Bearer {self.jwt_token}"}
        return {}

    def login(self, email: str, password: str) -> Optional[str]:
        """Login and get JWT token."""
        try:
            resp = self._session.post(
                f"{self.api_base}/auth/login",
                json={"email": email, "password": password},
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                token = resp.cookies.get("token")
                if token:
                    self.jwt_token = token
                    print("[Agent SDK] Login successful")
                    return token
            print(f"[Agent SDK] Login failed: {resp.status_code}")
            return None
        except requests.RequestException as e:
            print(f"[Agent SDK] Login error: {e}")
            return None

    def fetch_agent_config(self) -> Optional[Dict]:
        """Fetch agent configuration from backend."""
        try:
            resp = self._session.get(
                f"{self.api_base}/agents",
                headers=self._get_auth_headers(),
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code != 200:
                print(f"[Agent SDK] Failed to fetch config: {resp.status_code}")
                return None

            agents = resp.json().get("agents", [])
            agent = next((a for a in agents if a.get("id") == self.agent_id), None)
            if not agent:
                print(f"[Agent SDK] Agent not found: {self.agent_id}")
                return None

            self.agent_config = agent

            # Update agent_user_id
            if agent.get("userId"):
                self.agent_user_id = agent["userId"]

            # Initialize SDK components
            self._init_sdk()

            return agent
        except requests.RequestException as e:
            print(f"[Agent SDK] Config fetch error: {e}")
            return None

    def _init_sdk(self):
        """Initialize SDK components based on agent config."""
        if not self.agent_config:
            return

        # Get model configuration
        model_config = self.agent_config.get("model", {})
        runtime = self.agent_config.get("runtime", {})

        # Get endpoint URL
        base_url = runtime.get("endpoint", "https://api.openai.com/v1")
        api_key = runtime.get("apiKeyAlias") or "not-needed"
        model_name = model_config.get("name", "default")

        print(f"[Agent SDK] Initializing with endpoint: {base_url}")
        print(f"[Agent SDK] Model: {model_name}")

        # Create custom model provider
        self._model_provider = CustomModelProvider(base_url, api_key, model_name)

        # Disable tracing (we don't have OpenAI API key for traces)
        set_tracing_disabled(True)

        # Build tools list based on enabled tools
        tools = self._build_tools()

        # Build system prompt
        system_prompt = self._build_system_prompt()

        # Create agent
        self._agent = Agent(
            name=self.agent_config.get("name", "Assistant"),
            instructions=system_prompt,
            tools=tools,
            model=model_name,
        )

        print(f"[Agent SDK] Agent initialized with {len(tools)} tools")

    def _build_tools(self) -> List:
        """Build list of tools based on agent configuration."""
        tools = []
        enabled_tools = self.agent_config.get("tools", []) if self.agent_config else []
        capabilities = self.agent_config.get("capabilities", {}) if self.agent_config else {}

        # Add reaction tool if enabled
        if capabilities.get("like", False):
            tools.append(add_reaction)

        # Add context tools if enabled
        if "chat.get_context" in enabled_tools:
            tools.append(get_context)

        if "chat.get_long_context" in enabled_tools:
            tools.append(get_long_context)

        # Add web search if enabled
        if "tools.web_search" in enabled_tools:
            tools.append(web_search)

        # Add RAG if enabled
        if "tools.local_rag" in enabled_tools:
            tools.append(local_rag)

        # Add MCP tools if configured
        mcp_config = self.agent_config.get("mcp", {}) if self.agent_config else {}
        mcp_enabled = mcp_config.get("enabledTools", [])
        mcp_available = mcp_config.get("availableTools", [])

        if mcp_enabled and mcp_available:
            for tool_info in mcp_available:
                tool_name = tool_info.get("name", "")
                if tool_name in mcp_enabled:
                    mcp_tool = create_mcp_tool(mcp_config, tool_info)
                    tools.append(mcp_tool)
                    print(f"[Agent SDK] Added MCP tool: {tool_name}")

        return tools

    def _build_system_prompt(self, mode: str = "passive", users: List[Dict] = None) -> str:
        """Build system prompt for the agent."""
        import datetime
        current_date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        default_prompt = (
            "You are a helpful AI assistant in a group chat. "
            "Respond directly and concisely to the user's message. "
            "Do NOT include any prefix like '[GPT-4]:' or your name in responses. "
            "Be friendly and helpful. Respond in the user's language."
        )

        config_prompt = self.agent_config.get("systemPrompt") if self.agent_config else None
        base_prompt = config_prompt or default_prompt
        base_prompt = f"**Current time: {current_date}**\n\n{base_prompt}"

        # Add agent awareness
        my_name = self._agent_name_cache or "Assistant"
        ai_agents = []
        if users:
            for u in users:
                if (u.get("type") == "agent" or u.get("isLLM")) and u.get("id") != self.agent_user_id:
                    ai_agents.append(u.get("name", "Unknown"))

        base_prompt += f"\n\n## Group Chat Info\n"
        base_prompt += f"**Your Name:** {my_name}\n"
        if ai_agents:
            base_prompt += f"**Other AI Agents:** {', '.join(ai_agents)}\n"

        # Add message format explanation
        base_prompt += (
            "\n## Message Format\n"
            "Messages are shown as: `[msg:ID] [Sender → Recipient]: content`\n"
            "- **Sender** = who sent the message\n"
            "- **Recipient** = who it's directed to (`everyone` if no @mention, `you` if @YourName)\n"
            "- Example: `[msg:abc123] [Admin → everyone]: hello` = Admin said hello to everyone\n"
            "- Example: `[msg:def456] [Admin → @MOSS]: help me` = Admin asked MOSS specifically\n"
        )

        # Add mode-specific instructions
        if mode == "proactive":
            base_prompt += (
                "\n## Proactive Mode\n"
                "You're observing the chat. Decide whether to:\n"
                "1. **Reply** - if you can provide valuable help to an UNANSWERED question\n"
                "2. **React** - use emoji for interesting content\n"
                "3. **Stay silent** - output exactly `[SKIP]` if not relevant or someone else already answered\n\n"
                "**Rules:**\n"
                "- If Recipient is `@OtherAgent` (not you), output `[SKIP]` - it's for them\n"
                "- If the question was ALREADY ANSWERED by another agent, output `[SKIP]`\n"
                "- If Recipient is `everyone` and NO ONE has answered yet, you MAY respond if helpful\n"
                "- If Recipient is `@YourName`, you SHOULD respond\n"
                "- If unsure, output `[SKIP]`\n"
                "- **IMPORTANT:** When you decide not to respond, you MUST output exactly `[SKIP]` - nothing else!\n"
            )
        else:
            base_prompt += (
                "\n**You were mentioned.** Respond helpfully to the user's question.\n"
            )

        # Add tool descriptions for models that don't support native function calling
        base_prompt += self._build_tools_prompt()

        return base_prompt

    def _build_tools_prompt(self) -> str:
        """Build tool descriptions for the system prompt."""
        enabled_tools = self.agent_config.get("tools", []) if self.agent_config else []
        capabilities = self.agent_config.get("capabilities", {}) if self.agent_config else {}

        tools_sections = []
        tool_num = 1

        # Reaction tool
        if capabilities.get("like", False):
            tools_sections.append(
                f"{tool_num}. **add_reaction(message_id, emoji)** - React to a message with emoji\n"
                "   Use for simple acknowledgments instead of text replies."
            )
            tool_num += 1

        # Context tools
        if "chat.get_context" in enabled_tools:
            tools_sections.append(
                f"{tool_num}. **get_context(message_id)** - Get 10 messages around a specific message\n"
                "   Use when you need context about a particular message."
            )
            tool_num += 1

        if "chat.get_long_context" in enabled_tools:
            tools_sections.append(
                f"{tool_num}. **get_long_context()** - Get full conversation history\n"
                "   Use when you need to summarize or understand the entire conversation."
            )
            tool_num += 1

        # Web search
        if "tools.web_search" in enabled_tools:
            tools_sections.append(
                f"{tool_num}. **web_search(query)** - Search the web for current information\n"
                "   **MUST use for:** current events, news, sports scores, real-time data\n"
                "   DO NOT guess - search first!"
            )
            tool_num += 1

        # RAG
        if "tools.local_rag" in enabled_tools:
            tools_sections.append(
                f"{tool_num}. **local_rag(query)** - Search uploaded documents/knowledge base\n"
                "   **MUST use for:** questions about uploaded docs, company policies, attachments"
            )
            tool_num += 1

        # MCP tools
        mcp_config = self.agent_config.get("mcp", {}) if self.agent_config else {}
        mcp_enabled = mcp_config.get("enabledTools", [])
        mcp_available = mcp_config.get("availableTools", [])

        if mcp_enabled and mcp_available:
            for tool_info in mcp_available:
                tool_name = tool_info.get("name", "")
                if tool_name in mcp_enabled:
                    description = tool_info.get("description", "No description")
                    input_schema = tool_info.get("inputSchema", {}) or tool_info.get("parameters", {})

                    # Handle different schema formats:
                    # 1. Standard JSON Schema: { "properties": { "query": {...} } }
                    # 2. Direct params: { "query": {...}, "limit": {...} }
                    properties = input_schema.get("properties", {})
                    if not properties:
                        # Check if params are directly in schema (MCP server format)
                        properties = {k: v for k, v in input_schema.items()
                                      if isinstance(v, dict) and ("type" in v or "description" in v)}

                    # Build detailed params string with descriptions
                    params = []
                    required = input_schema.get("required", [])
                    for param_name, param_info in properties.items():
                        if isinstance(param_info, dict):
                            param_type = param_info.get("type", "any")
                            param_desc = param_info.get("description", "")
                            is_required = param_info.get("required", param_name in required)
                            req_marker = "" if is_required else "?"
                            params.append(f"{param_name}{req_marker}: {param_type}")

                    params_str = ", ".join(params) if params else ""

                    # Build full tool description with parameter details
                    tool_desc = f"{tool_num}. **mcp_{tool_name}({params_str})** - [MCP] {description}"

                    # Add parameter descriptions for clarity
                    if properties:
                        param_details = []
                        for param_name, param_info in properties.items():
                            if isinstance(param_info, dict) and param_info.get("description"):
                                param_details.append(f"   - `{param_name}`: {param_info['description']}")
                        if param_details:
                            tool_desc += "\n" + "\n".join(param_details)

                    tools_sections.append(tool_desc)
                    tool_num += 1

        if tools_sections:
            return (
                "\n\n## Available Tools\n"
                "You can call these tools to get information:\n\n"
                + "\n\n".join(tools_sections)
                + "\n\n**Note:** Tools are called automatically when you need them."
            )

        return ""

    def fetch_messages(self, since: Optional[int] = None) -> Tuple[List[Dict], List[Dict]]:
        """Fetch messages from the server."""
        params = {"conversationId": CONVERSATION_ID}
        if since:
            params["since"] = since

        try:
            resp = self._session.get(
                f"{self.api_base}/messages",
                params=params,
                headers=self._get_auth_headers(),
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                data = resp.json()
                users = data.get("users", [])
                self._update_user_cache(users)
                return data.get("messages", []), users
            return [], []
        except requests.RequestException:
            return [], []

    def _update_user_cache(self, users: List[Dict]):
        """Update user name cache."""
        for user in users:
            user_id = user.get("id")
            if user_id:
                self._user_map_cache[user_id] = user.get("name", "User")
                if user_id == self.agent_user_id:
                    self._agent_name_cache = user.get("name")

    def send_heartbeat(self) -> bool:
        """Send heartbeat signal."""
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/heartbeat",
                headers=self._agent_headers,
                timeout=5,
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def _heartbeat_loop(self):
        """Heartbeat thread."""
        while self._running:
            self.send_heartbeat()
            time.sleep(HEARTBEAT_INTERVAL)

    def send_message(self, content: str, reply_to_id: Optional[str] = None) -> bool:
        """Send a message."""
        payload = {"content": content, "conversationId": CONVERSATION_ID}
        if reply_to_id:
            payload["replyToId"] = reply_to_id

        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/messages",
                json=payload,
                headers=self._agent_headers,
                timeout=30,
            )
            if resp.status_code == 200:
                print(f"[Agent SDK] Message sent: {content[:50]}...")
                return True
            print(f"[Agent SDK] Send failed: {resp.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[Agent SDK] Send error: {e}")
            return False

    def set_looking(self, is_looking: bool) -> bool:
        """Set agent looking status."""
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/looking",
                json={"isLooking": is_looking},
                headers=self._agent_headers,
                timeout=5,
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def is_mentioned(self, message: Dict, users: List[Dict]) -> bool:
        """Check if this agent was mentioned."""
        mentions = message.get("mentions", [])
        content = message.get("content", "")

        if self.agent_user_id in mentions:
            return True

        agent_name = self._agent_name_cache
        if agent_name and f"@{agent_name}" in content:
            return True

        return False

    def mentions_another_agent(self, message: Dict, users: List[Dict]) -> bool:
        """Check if message mentions another agent (not this one)."""
        mentions = message.get("mentions", [])
        content = message.get("content", "")

        agent_users = [u for u in users if u.get("type") == "agent" or u.get("isLLM")]

        for user in agent_users:
            user_id = user.get("id")
            user_name = user.get("name", "")

            if user_id == self.agent_user_id:
                continue

            if user_id in mentions:
                return True
            if user_name and f"@{user_name}" in content:
                return True

        return False

    def build_context(self, messages: List[Dict], users: List[Dict], current_msg: Dict) -> str:
        """Build conversation context as text for SDK input."""
        user_map = self._user_map_cache.copy()
        for u in users:
            if u["id"] not in user_map:
                user_map[u["id"]] = u.get("name", "User")

        # Build agent user IDs map for detecting @mentions to agents
        agent_names = set()
        for u in users:
            if u.get("type") == "agent" or u.get("isLLM"):
                agent_names.add(u.get("name", ""))

        my_name = self._agent_name_cache or "Assistant"
        recent = messages[-CONTEXT_LIMIT:]
        lines = []

        for msg in recent:
            sender_id = msg.get("senderId", "")
            msg_id = msg.get("id", "")
            content = msg.get("content", "")
            mentions = msg.get("mentions", [])

            # Clean special tags (reasoning, tool calls, etc.)
            content = strip_special_tags(content)

            sender_name = user_map.get(sender_id, "User")

            # Determine recipient
            recipient = "everyone"

            # Check mentions list first
            for mentioned_id in mentions:
                mentioned_name = user_map.get(mentioned_id, "")
                if mentioned_name:
                    if mentioned_id == self.agent_user_id:
                        recipient = "you"
                    else:
                        recipient = f"@{mentioned_name}"
                    break

            # Also check @mentions in content if no explicit mention
            if recipient == "everyone":
                at_matches = re.findall(r'@(\S+)', content)
                for mentioned in at_matches:
                    if mentioned == my_name:
                        recipient = "you"
                        break
                    elif mentioned in agent_names:
                        recipient = f"@{mentioned}"
                        break

            # Format: [msg:ID] [Sender → Recipient]: content
            if sender_id == self.agent_user_id:
                # Agent's own messages
                lines.append(f"[msg:{msg_id}] [you → {recipient}]: {content}")
            else:
                lines.append(f"[msg:{msg_id}] [{sender_name} → {recipient}]: {content}")

        return "\n\n".join(lines)

    def _execute_tool(self, tool_name: str, args: Dict, tool_ctx: AgentContext) -> Optional[str]:
        """Execute a single tool and return formatted result."""
        mcp_config = self.agent_config.get("mcp", {}) if self.agent_config else {}

        # Map tool names (native format may use different names)
        tool_map = {
            "web_search": "web_search",
            "search": "web_search",
            "browse": "web_search",
            "local_rag": "local_rag",
            "rag": "local_rag",
            "knowledge_base": "local_rag",
            "get_context": "get_context",
            "get_long_context": "get_long_context",
        }

        # Check for MCP tools
        mcp_enabled = mcp_config.get("enabledTools", [])
        for mcp_tool in mcp_enabled:
            tool_map[mcp_tool] = f"mcp:{mcp_tool}"
            # Also map without prefix
            tool_map[f"mcp_{mcp_tool}"] = f"mcp:{mcp_tool}"

        mapped_tool = tool_map.get(tool_name, tool_name)
        print(f"[Agent SDK] Executing tool: {tool_name} -> {mapped_tool}")

        if mapped_tool == "web_search":
            query = args.get("query", args.get("q", str(args)))
            result = tool_ctx.web_search(query)
            if result:
                results = result.get("results", [])
                formatted = []
                for i, r in enumerate(results[:5], 1):
                    title = r.get("title", "No title")
                    url = r.get("actualUrl", r.get("url", ""))
                    content = r.get("content", r.get("snippet", ""))
                    formatted.append(f"{i}. **{title}**\n   URL: {url}\n   {content}")
                return "\n\n".join(formatted) if formatted else "[No results found]"
            return "[Web search failed]"

        elif mapped_tool == "local_rag":
            query = args.get("query", args.get("q", str(args)))
            result = tool_ctx.local_rag(query)
            if result:
                chunks = result.get("chunks", [])
                if chunks:
                    formatted = ["**From knowledge base:**"]
                    for chunk in chunks[:5]:
                        source = chunk.get("source", "Unknown")
                        content = chunk.get("content", "")
                        formatted.append(f"[{source}]: {content}")
                    return "\n---\n".join(formatted)
            return "[No relevant documents found]"

        elif mapped_tool == "get_context":
            msg_id = args.get("message_id", args.get("id", ""))
            result = tool_ctx.get_context(msg_id)
            if result:
                messages = result.get("messages", [])
                users = result.get("users", [])
                user_map = {u["id"]: u.get("name", "User") for u in users}
                lines = [f"[{user_map.get(m.get('senderId', ''), 'Unknown')}]: {strip_special_tags(m.get('content', ''))[:200]}" for m in messages]
                return "\n".join(lines) if lines else "[No context found]"
            return "[Failed to get context]"

        elif mapped_tool == "get_long_context":
            result = tool_ctx.get_long_context()
            if result:
                messages = result.get("messages", [])
                users = result.get("users", [])
                user_map = {u["id"]: u.get("name", "User") for u in users}
                lines = [f"[{user_map.get(m.get('senderId', ''), 'Unknown')}]: {strip_special_tags(m.get('content', ''))[:150]}" for m in messages[-30:]]
                return "\n".join(lines) if lines else "[No history found]"
            return "[Failed to get history]"

        elif mapped_tool.startswith("mcp:"):
            actual_tool = mapped_tool[4:]  # Remove "mcp:" prefix
            print(f"[Agent SDK] Calling MCP tool: {actual_tool} with args: {args}")
            result = tool_ctx.execute_mcp_tool(mcp_config, actual_tool, args)
            print(f"[Agent SDK] MCP tool {actual_tool} returned: {type(result).__name__}")
            if result is not None:
                if isinstance(result, str):
                    return result
                elif isinstance(result, dict):
                    return json.dumps(result, ensure_ascii=False, indent=2)
                elif isinstance(result, list):
                    return "\n".join(f"{i}. {json.dumps(item, ensure_ascii=False) if isinstance(item, dict) else item}" for i, item in enumerate(result, 1))
                return str(result)
            return f"[MCP tool {actual_tool} failed - no result returned. Check MCP server connection.]"

        return f"[Unknown tool: {tool_name}]"

    async def generate_reply_async(self, context: str, current_msg: Dict, users: List[Dict], mode: str = "passive", max_rounds: int = 3) -> Tuple[bool, str]:
        """Generate a reply with native Harmony COT tool handling."""
        if not self._model_provider:
            return False, "[Agent not initialized]"

        # Set up tool context
        tool_ctx = AgentContext(
            api_base=self.api_base,
            agent_id=self.agent_id,
            headers=self._agent_headers,
            session=self._session,
            conversation_id=CONVERSATION_ID,
            current_msg=current_msg,
        )
        set_tool_context(tool_ctx)

        # Build system prompt and messages
        system_prompt = self._build_system_prompt(mode=mode, users=users)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"**Recent conversation:**\n{context}\n\n**Please respond to the latest message.**"}
        ]

        agent_name = self.agent_config.get("name", self.agent_id) if self.agent_config else self.agent_id
        model_config = self.agent_config.get("model", {}) if self.agent_config else {}
        model_name = model_config.get("name", "default")
        temperature = model_config.get("temperature", 0.6)
        max_tokens = model_config.get("maxTokens", 1024)

        for round_num in range(1, max_rounds + 1):
            # ============================================================
            # PROMPT SECTION
            # ============================================================
            separator = "=" * 70
            print(f"\n{separator}")
            print(f"| AGENT: {agent_name} | ROUND: {round_num}/{max_rounds} | MODE: {mode} |")
            print(separator)
            print(">>> PROMPT >>>")
            for i, msg in enumerate(messages):
                role = msg["role"].upper()
                content = msg["content"]
                print(f"\n[{i+1}] {role}:")
                print("-" * 40)
                print(content)
            print(f"\n{'=' * 70}")
            print(">>> CALLING MODEL >>>")

            try:
                # Use higher max_tokens to avoid truncation during tool reasoning
                round_max_tokens = max(max_tokens, 2048)

                # Call model directly using provider's client with timeout
                import asyncio
                try:
                    response = await asyncio.wait_for(
                        self._model_provider._client.chat.completions.create(
                            model=model_name,
                            messages=messages,
                            temperature=temperature,
                            max_tokens=round_max_tokens,
                        ),
                        timeout=120.0  # 2 minute timeout
                    )
                except asyncio.TimeoutError:
                    print(f"!!! TIMEOUT after 120s !!!")
                    print(separator)
                    return False, "[Model request timed out]"

                # Handle empty or invalid response
                if not response or not response.choices:
                    print(f"!!! EMPTY RESPONSE !!!")
                    if round_num < max_rounds:
                        messages = messages[:2]
                        continue
                    print(separator)
                    return False, "[Model returned empty response]"

                raw_output = response.choices[0].message.content or ""
                finish_reason = response.choices[0].finish_reason

                # ============================================================
                # RESPONSE SECTION
                # ============================================================
                print(f"\n>>> RESPONSE (finish={finish_reason}) >>>")
                print("-" * 40)
                print(raw_output)
                print("-" * 40)

                # Check for truncation
                is_truncated = finish_reason == "length"
                if is_truncated:
                    print("!!! OUTPUT TRUNCATED (max_tokens reached) !!!")

                # Parse native tool calls
                tool_calls = parse_native_tool_calls(raw_output)

                if tool_calls:
                    print(f"\n>>> TOOL CALLS DETECTED: {len(tool_calls)} >>>")
                    for i, tc in enumerate(tool_calls):
                        print(f"  [{i+1}] {tc['tool']}({tc['args']})")

                    # Execute tools
                    print("\n>>> EXECUTING TOOLS >>>")
                    tool_results = []
                    for tc in tool_calls:
                        print(f"  -> Executing: {tc['tool']}")
                        result = self._execute_tool(tc["tool"], tc["args"], tool_ctx)
                        if result:
                            tool_results.append((tc["tool"], result))
                            print(f"     Result: {str(result)[:100]}...")
                        else:
                            print(f"     Result: (empty/failed)")

                    if tool_results and round_num < max_rounds:
                        tools_called = ", ".join([tc["tool"] for tc in tool_calls])
                        results_text = "\n\n".join([f"**[{name} result]:**\n{res}" for name, res in tool_results])
                        messages.append({"role": "assistant", "content": f"I called the following tools: {tools_called}"})
                        messages.append({"role": "user", "content": f"**Tool Results:**\n{results_text}\n\nBased on these results, please provide your final response to the user."})
                        print(f"\n>>> CONTINUING TO ROUND {round_num + 1} WITH TOOL RESULTS >>>")
                        print(separator)
                        continue

                # If truncated but no tool calls, continue generation
                if is_truncated and not tool_calls and round_num < max_rounds:
                    print(">>> TRUNCATED - ASKING MODEL TO CONTINUE >>>")
                    # Clean output to remove <|channel|> tags (model server rejects them in content)
                    clean_output = strip_special_tags(raw_output) or "I was explaining..."
                    messages.append({"role": "assistant", "content": clean_output})
                    messages.append({"role": "user", "content": "Please continue and complete your response."})
                    print(separator)
                    continue

                # Extract final response
                final_output = extract_final_response(raw_output)

                print(f"\n>>> FINAL OUTPUT >>>")
                print("-" * 40)
                print(final_output if final_output else "(empty)")
                print("-" * 40)

                # Check for skip
                if "[SKIP]" in final_output or "[SKIP]" in raw_output:
                    print(">>> ACTION: SKIP >>>")
                    print(separator)
                    return True, ""

                # If no final output but has analysis, ask for completion
                if not final_output.strip():
                    if "<|channel|>analysis" in raw_output and round_num < max_rounds:
                        print(">>> NO FINAL OUTPUT - ASKING FOR COMPLETION >>>")
                        # Clean output to remove <|channel|> tags (model server rejects them in content)
                        clean_output = strip_special_tags(raw_output) or "I was thinking about this..."
                        messages.append({"role": "assistant", "content": clean_output})
                        messages.append({"role": "user", "content": "Please provide your final response now."})
                        print(separator)
                        continue
                    print(">>> ACTION: NO RESPONSE >>>")
                    print(separator)
                    return True, ""

                print(">>> ACTION: SEND MESSAGE >>>")
                print(separator)
                return False, final_output.strip()

            except Exception as e:
                print(f"\n!!! ERROR in round {round_num}: {e} !!!")
                import traceback
                traceback.print_exc()
                return False, f"Sorry, I encountered an error: {str(e)}"

        return False, "[Max rounds reached]"

    def generate_reply(self, context: str, current_msg: Dict, users: List[Dict], mode: str = "passive") -> Tuple[bool, str]:
        """Generate a reply using the SDK (sync wrapper)."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(
                self.generate_reply_async(context, current_msg, users, mode)
            )
        finally:
            loop.close()

    def process_message(self, message: Dict, messages: List[Dict], users: List[Dict]):
        """Process a single message that mentioned this agent."""
        msg_id = message.get("id")
        sender_id = message.get("senderId")

        if sender_id == self.agent_user_id:
            return
        if msg_id in self.processed_message_ids:
            return
        if not self.is_mentioned(message, users):
            return

        print(f"[Agent SDK] Processing mention: {message.get('content', '')[:50]}...")

        self.set_looking(True)
        try:
            # Refresh config
            self.fetch_agent_config()

            # Fetch fresh messages
            fresh_messages, fresh_users = self.fetch_messages()
            if fresh_messages:
                messages = fresh_messages
                users = fresh_users

            # Build context
            context = self.build_context(messages, users, message)

            # Generate reply
            only_tools, reply = self.generate_reply(context, message, users)

            if only_tools:
                print(f"[Agent SDK] Only tool actions, no text reply needed")
            elif reply:
                self.send_message(reply, reply_to_id=msg_id)

            self.processed_message_ids.add(msg_id)
        finally:
            self.set_looking(False)

    def try_proactive_response(self, message: Dict, messages: List[Dict], users: List[Dict]) -> bool:
        """Try to respond proactively (AI decides)."""
        msg_id = message.get("id")
        sender_id = message.get("senderId")

        if sender_id == self.agent_user_id:
            return False
        if msg_id in self.reacted_message_ids:
            return False

        # Skip messages from other AI agents - don't respond to agent messages in proactive mode
        agent_user_ids = set()
        for u in users:
            if u.get("type") == "agent" or u.get("isLLM"):
                agent_user_ids.add(u.get("id"))

        if sender_id in agent_user_ids:
            # Don't proactively respond to other agents' messages
            self.reacted_message_ids.add(msg_id)
            return False

        # Skip if mentions another agent
        if self.mentions_another_agent(message, users):
            self.reacted_message_ids.add(msg_id)
            return False

        # Check capabilities
        capabilities = self.agent_config.get("capabilities", {}) if self.agent_config else {}
        if not capabilities.get("answer_active") and not capabilities.get("like"):
            return False

        # Check cooldown
        runtime = self.agent_config.get("runtime", {}) if self.agent_config else {}
        cooldown = runtime.get("proactiveCooldown", DEFAULT_PROACTIVE_COOLDOWN)
        now = time.time()
        if now - self.last_proactive_time < cooldown:
            return False

        print(f"[Agent SDK] Proactive mode: {message.get('content', '')[:50]}...")

        self.set_looking(True)
        try:
            self.fetch_agent_config()

            fresh_messages, fresh_users = self.fetch_messages()
            if fresh_messages:
                messages = fresh_messages
                users = fresh_users

            context = self.build_context(messages, users, message)
            only_tools, response = self.generate_reply(context, message, users, mode="proactive")

            if "[SKIP]" in response:
                self.reacted_message_ids.add(msg_id)
                return False

            if not only_tools and response.strip():
                self.send_message(response, reply_to_id=msg_id)

            self.last_proactive_time = now
            self.reacted_message_ids.add(msg_id)
            self.processed_message_ids.add(msg_id)
            return True
        finally:
            self.set_looking(False)

    def run(self):
        """Main loop."""
        print(f"[Agent SDK] Starting service...")
        print(f"[Agent SDK] API: {self.api_base}")
        print(f"[Agent SDK] Agent ID: {self.agent_id}")
        print("-" * 40)

        self._running = True
        self.send_heartbeat()

        heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        heartbeat_thread.start()
        print("[Agent SDK] Heartbeat thread started")

        while self._running:
            try:
                messages, users = self.fetch_messages()

                if messages:
                    new_messages = [
                        m for m in messages
                        if m.get("timestamp", 0) > self.last_seen_timestamp
                        and m.get("id") not in self.processed_message_ids
                    ]

                    for msg in new_messages:
                        if self.is_mentioned(msg, users):
                            self.process_message(msg, messages, users)
                        else:
                            self.try_proactive_response(msg, messages, users)

                    if messages:
                        latest_ts = max(m.get("timestamp", 0) for m in messages)
                        self.last_seen_timestamp = max(self.last_seen_timestamp, latest_ts)

            except Exception as e:
                print(f"[Agent SDK] Loop error: {e}")
                import traceback
                traceback.print_exc()

            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Agent Service with OpenAI Agents SDK")
    parser.add_argument("--email", default="root@example.com", help="Login email")
    parser.add_argument("--password", default="1234567890", help="Login password")
    parser.add_argument("--agent-id", default=DEFAULT_AGENT_ID, help="Agent ID")
    args = parser.parse_args()

    print(f"[Agent SDK] Starting with OpenAI Agents SDK...")
    print("-" * 40)

    service = AgentServiceSDK(agent_id=args.agent_id)

    if service.login(args.email, args.password):
        config = service.fetch_agent_config()
        if config:
            print(f"[Agent SDK] Loaded config:")
            print(f"  - Name: {config.get('name')}")
            print(f"  - Model: {config.get('model', {}).get('name')}")
            print(f"  - Endpoint: {config.get('runtime', {}).get('endpoint')}")
            caps = config.get("capabilities", {})
            mode = "proactive" if caps.get("answer_active") else "passive"
            print(f"  - Mode: {mode}")
            print(f"  - Tools: {config.get('tools', [])}")
        else:
            print("[Agent SDK] Warning: Could not load agent config")

        service.run()
    else:
        print("[Agent SDK] Cannot start: login failed")
