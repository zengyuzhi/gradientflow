# -*- coding: utf-8 -*-
"""
Tool Executor

Built-in tools for agent services:
- Context retrieval (get_context, get_long_context)
- Web search (web_search)
- Local RAG (local_rag)
- MCP tool execution
"""
import re
import time
import json
import requests
from typing import Optional, Dict, List

# Import shared utilities
from .response_cleaner import strip_special_tags, RE_MENTION
from .harmony_parser import RE_FUNCTION_CALL as RE_HARMONY_FUNCTION_CALL


# ============================================================================
# Tool Patterns for Parsing LLM Responses
# ============================================================================

# Standard format: [TOOL:argument]
RE_GET_CONTEXT_TOOL = re.compile(r"\[GET_CONTEXT:([^\]]+)\]")
RE_GET_LONG_CONTEXT_TOOL = re.compile(r"\[GET_LONG_CONTEXT\]")
RE_WEB_SEARCH_TOOL = re.compile(r"\[WEB_SEARCH:([^\]]+)\]")
RE_LOCAL_RAG_TOOL = re.compile(r"\[LOCAL_RAG:([^\]]+)\]")

# MCP tool pattern: [MCP:tool_name:{"args": "value"}]
RE_MCP_TOOL = re.compile(r"\[MCP:([\w\.\-]+):(\{[^}]+\})\]")

# Native model format patterns
# Some models (e.g., parallax/gpt-oss) use: <|channel|>commentary to=TOOL <|message|>{...}

# WEB_SEARCH native patterns
RE_NATIVE_WEB_SEARCH_JSON = re.compile(
    r"<\|channel\|>(?:commentary|tool|analysis)\s+to=WEB_SEARCH[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\s*(\{[^}]+\})",
    re.IGNORECASE
)
RE_NATIVE_WEB_SEARCH_TEXT = re.compile(
    r"<\|channel\|>(?:commentary|tool|analysis)\s+to=WEB_SEARCH[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\s*(?:WEB_SEARCH:\s*)?([^<\|]+?)(?:<\||\|>|$)",
    re.IGNORECASE
)

# LOCAL_RAG native patterns
RE_NATIVE_LOCAL_RAG_JSON = re.compile(
    r"<\|channel\|>(?:commentary|tool|analysis)\s+to=LOCAL_RAG[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\s*(\{[^}]+\})",
    re.IGNORECASE
)
RE_NATIVE_LOCAL_RAG_TEXT = re.compile(
    r"<\|channel\|>(?:commentary|tool|analysis)\s+to=LOCAL_RAG[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\s*(?:LOCAL_RAG:\s*)?([^<\|]+?)(?:<\||\|>|$)",
    re.IGNORECASE
)

# GET_CONTEXT native patterns
RE_NATIVE_GET_CONTEXT_JSON = re.compile(
    r"<\|channel\|>(?:commentary|tool|analysis)\s+to=GET_CONTEXT[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\s*(\{[^}]+\})",
    re.IGNORECASE
)
RE_NATIVE_GET_CONTEXT_TEXT = re.compile(
    r"<\|channel\|>(?:commentary|tool|analysis)\s+to=GET_CONTEXT[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\s*(?:GET_CONTEXT:\s*)?([^<\|]+?)(?:<\||\|>|$)",
    re.IGNORECASE
)


# ============================================================================
# Constants
# ============================================================================

DEFAULT_CONTEXT_BEFORE = 5
DEFAULT_CONTEXT_AFTER = 4
DEFAULT_LONG_CONTEXT_MAX = 50
DEFAULT_COMPRESS_MAX_CHARS = 4000
DEFAULT_RAG_TOP_K = 5


# ============================================================================
# AgentTools Class
# ============================================================================

class AgentTools:
    """
    Built-in tools for agent context retrieval and external services.

    Usage:
        tools = AgentTools(api_base, agent_id, headers, session)
        context = tools.get_context(message_id)
        long_context = tools.get_long_context()
        search_results = tools.web_search("query")
    """

    def __init__(
        self,
        api_base: str,
        agent_id: str,
        headers: Dict[str, str],
        session: requests.Session,
        conversation_id: str = "global",
        request_timeout: int = 10,
    ):
        self.api_base = api_base
        self.agent_id = agent_id
        self.headers = headers
        self.session = session
        self.conversation_id = conversation_id
        self.request_timeout = request_timeout

    # ========== Context Tools ==========

    def get_context(
        self,
        message_id: str,
        before: int = DEFAULT_CONTEXT_BEFORE,
        after: int = DEFAULT_CONTEXT_AFTER,
    ) -> Optional[Dict]:
        """
        Get context around a specific message (default: 5 before, 4 after = 10 messages).

        Tool format: [GET_CONTEXT:message_id]

        Args:
            message_id: The ID of the target message
            before: Number of messages before the target (default 5)
            after: Number of messages after the target (default 4)

        Returns:
            Dict with 'messages', 'users', and 'targetMessageId' or None on error
        """
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
                timeout=self.request_timeout,
            )
            if resp.status_code == 200:
                data = resp.json()
                print(f"[Tools] get_context: Retrieved {len(data.get('messages', []))} messages around {message_id[:8]}...")
                return data
            print(f"[Tools] get_context failed: {resp.status_code}")
            return None
        except requests.RequestException as e:
            print(f"[Tools] get_context error: {e}")
            return None

    def get_long_context(self, max_messages: int = DEFAULT_LONG_CONTEXT_MAX) -> Optional[Dict]:
        """
        Get the full conversation history for comprehensive understanding.

        Tool format: [GET_LONG_CONTEXT]

        Args:
            max_messages: Maximum number of messages to retrieve (default 50, max 200)

        Returns:
            Dict with 'messages', 'users', 'participants', 'totalMessages', 'returnedMessages'
        """
        try:
            resp = self.session.get(
                f"{self.api_base}/agents/{self.agent_id}/long-context",
                params={
                    "maxMessages": min(max_messages, 200),
                    "conversationId": self.conversation_id,
                    "includeSystemPrompt": "false",
                },
                headers=self.headers,
                timeout=self.request_timeout,
            )
            if resp.status_code == 200:
                data = resp.json()
                print(f"[Tools] get_long_context: Retrieved {data.get('returnedMessages', 0)}/{data.get('totalMessages', 0)} messages")
                return data
            print(f"[Tools] get_long_context failed: {resp.status_code}")
            return None
        except requests.RequestException as e:
            print(f"[Tools] get_long_context error: {e}")
            return None

    def compress_context(
        self,
        messages: List[Dict],
        users: List[Dict],
        max_chars: int = DEFAULT_COMPRESS_MAX_CHARS,
    ) -> str:
        """
        Compress conversation history into a concise summary format.

        Args:
            messages: List of message objects
            users: List of user objects
            max_chars: Maximum characters in output (default 4000)

        Returns:
            Compressed text representation of the conversation
        """
        if not messages:
            return "[No messages in history]"

        # Build user map
        user_map = {u["id"]: u.get("name", "User") for u in users}

        lines = []
        for msg in messages:
            sender_id = msg.get("senderId", "")
            sender_name = user_map.get(sender_id, "Unknown")
            content = strip_special_tags(msg.get("content", ""))
            # Remove @ mentions for brevity
            content = RE_MENTION.sub("", content).strip()
            # Truncate long messages
            if len(content) > 200:
                content = content[:200] + "..."

            timestamp = msg.get("timestamp", 0)
            time_str = time.strftime("%H:%M", time.localtime(timestamp / 1000)) if timestamp else "??:??"
            lines.append(f"[{time_str}] {sender_name}: {content}")

        result = "\n".join(lines)

        # If still too long, truncate from the beginning (keep recent messages)
        if len(result) > max_chars:
            result = "...[earlier messages truncated]...\n" + result[-(max_chars - 50):]

        return result

    def format_context_for_llm(self, context_data: Dict, user_map: Dict[str, str] = None) -> List[Dict]:
        """
        Format context data into LLM-friendly message format.

        Args:
            context_data: Response from get_context() or get_long_context()
            user_map: Optional pre-built user ID to name mapping

        Returns:
            List of messages formatted for LLM context
        """
        messages = context_data.get("messages", [])
        users = context_data.get("users", [])

        if user_map is None:
            user_map = {u["id"]: u.get("name", "User") for u in users}

        formatted = []
        for msg in messages:
            sender_id = msg.get("senderId", "")
            content = strip_special_tags(msg.get("content", ""))
            content = RE_MENTION.sub("", content).strip()
            msg_id = msg.get("id", "")

            sender_name = user_map.get(sender_id, "User")
            # Check if this is from an agent/assistant
            sender_type = next((u.get("type") for u in users if u.get("id") == sender_id), None)

            if sender_type == "agent":
                formatted.append({"role": "assistant", "content": content})
            else:
                formatted.append({
                    "role": "user",
                    "content": f"[msg:{msg_id}] <{sender_name}>: {content}"
                })

        return formatted

    # ========== Web Search Tool ==========

    def web_search(self, query: str, max_results: int = 5) -> Optional[Dict]:
        """
        Search the web for information.

        Tool format: [WEB_SEARCH:query]

        Args:
            query: The search query
            max_results: Maximum number of results to return (default 5)

        Returns:
            Dict with 'results' list containing title, url, snippet for each result
        """
        try:
            resp = self.session.post(
                f"{self.api_base}/agents/{self.agent_id}/tools/web-search",
                json={
                    "query": query,
                    "maxResults": max_results,
                },
                headers=self.headers,
                timeout=30,  # Web search may take longer
            )
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                print(f"[Tools] web_search: Found {len(results)} results for '{query[:30]}...'")
                return data
            print(f"[Tools] web_search failed: {resp.status_code}")
            return None
        except requests.RequestException as e:
            print(f"[Tools] web_search error: {e}")
            return None

    def format_search_results(self, search_data: Dict) -> str:
        """Format web search results for LLM consumption."""
        if not search_data:
            return "[No search results found]"

        results = search_data.get("results", [])
        if not results:
            return "[No search results found]"

        formatted = []
        for i, result in enumerate(results, 1):
            title = result.get("title", "No title")
            # Use actual URL if available (decoded from DuckDuckGo redirect)
            url = result.get("actualUrl", result.get("url", ""))
            snippet = result.get("snippet", "")
            content = result.get("content", "")  # Fetched page content

            entry = f"{i}. **{title}**\n   URL: {url}"
            if content:
                # If we have fetched content, use it (more detailed)
                entry += f"\n   Content: {content}"
            elif snippet:
                # Fall back to snippet
                entry += f"\n   {snippet}"

            formatted.append(entry)

        return "\n\n".join(formatted)

    # ========== Local RAG Tool ==========

    def local_rag(self, query: str, top_k: int = DEFAULT_RAG_TOP_K) -> Optional[Dict]:
        """
        Search the local knowledge base for relevant information.

        Tool format: [LOCAL_RAG:query]

        Args:
            query: The search query
            top_k: Number of most relevant chunks to return (default 5)

        Returns:
            Dict with 'chunks' list containing relevant document chunks
        """
        try:
            resp = self.session.post(
                f"{self.api_base}/agents/{self.agent_id}/tools/local-rag",
                json={
                    "query": query,
                    "topK": top_k,
                },
                headers=self.headers,
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                chunks = data.get("chunks", [])
                print(f"[Tools] local_rag: Found {len(chunks)} relevant chunks for '{query[:30]}...'")
                return data
            print(f"[Tools] local_rag failed: {resp.status_code}")
            return None
        except requests.RequestException as e:
            print(f"[Tools] local_rag error: {e}")
            return None

    def format_rag_results(self, rag_data: Dict) -> str:
        """Format RAG results for LLM consumption."""
        if not rag_data:
            return "[No relevant documents found in knowledge base]"

        chunks = rag_data.get("chunks", [])
        if not chunks:
            return "[No relevant documents found in knowledge base]"

        formatted = ["**Relevant information from knowledge base:**\n"]
        for i, chunk in enumerate(chunks, 1):
            source = chunk.get("source", "Unknown document")
            content = chunk.get("content", "")
            score = chunk.get("score", 0)
            formatted.append(f"[Source: {source}] (relevance: {score:.2f})\n{content}\n")

        return "\n---\n".join(formatted)

    # ========== MCP Tools ==========

    def execute_mcp_tool(self, mcp_config: Dict, tool_name: str, arguments: Dict) -> Optional[Dict]:
        """
        Execute an MCP tool via the backend proxy.

        Args:
            mcp_config: MCP configuration with url, apiKey, endpoint, and transport
            tool_name: Name of the tool to execute
            arguments: Tool arguments

        Returns:
            Dict with execution result or None on error
        """
        # Use endpoint if available (set during connection), otherwise fall back to url
        server_url = mcp_config.get("endpoint") or mcp_config.get("url", "")
        api_key = mcp_config.get("apiKey", "")
        transport = mcp_config.get("transport")  # 'streamable-http', 'sse', or 'rest'

        if not server_url:
            print(f"[Tools] MCP execution failed: No server URL configured")
            return None

        try:
            # Call the backend MCP execute endpoint
            payload = {
                "serverUrl": server_url,
                "apiKey": api_key,
                "toolName": tool_name,
                "arguments": arguments,
            }
            # Include transport if known (helps backend choose correct protocol)
            if transport:
                payload["mcpTransport"] = transport

            resp = self.session.post(
                f"{self.api_base}/mcp/execute",
                json=payload,
                headers=self.headers,
                timeout=30,
            )
            if resp.status_code == 200:
                data = resp.json()
                print(f"[Tools] MCP tool '{tool_name}' executed successfully (transport: {transport or 'auto'})")
                return data.get("result")
            print(f"[Tools] MCP execute failed: {resp.status_code}")
            return None
        except requests.RequestException as e:
            print(f"[Tools] MCP execute error: {e}")
            return None

    def format_mcp_result(self, tool_name: str, result: any) -> str:
        """Format MCP tool result for LLM consumption."""
        if result is None:
            return f"[ERROR] Tool '{tool_name}' returned no result. Please inform the user that the search failed."

        if isinstance(result, str):
            # Check if result contains error
            if "error" in result.lower():
                return f"[ERROR] Tool '{tool_name}' failed:\n{result}\n\nPlease inform the user about this error honestly."
            return f"**Result from {tool_name}:**\n{result}"

        if isinstance(result, dict):
            # Check for error in dict result
            if "error" in result:
                error_msg = result.get("error", "Unknown error")
                return f"[ERROR] Tool '{tool_name}' failed: {error_msg}\n\nPlease inform the user about this error honestly. Do NOT make up or guess the answer."

            # Pretty print dict result
            formatted = f"**Result from {tool_name}:**\n"
            for key, value in result.items():
                formatted += f"- {key}: {value}\n"
            return formatted

        if isinstance(result, list):
            formatted = f"**Result from {tool_name}:**\n"
            for i, item in enumerate(result, 1):
                if isinstance(item, dict):
                    formatted += f"{i}. {json.dumps(item, ensure_ascii=False)}\n"
                else:
                    formatted += f"{i}. {item}\n"
            return formatted

        return f"**Result from {tool_name}:**\n{str(result)}"


# ============================================================================
# Tool Parsing Utilities
# ============================================================================

def _extract_query_from_json(json_str: str) -> Optional[str]:
    """Extract query from JSON string like {"query": "..."} or {"search": "..."}."""
    try:
        data = json.loads(json_str)
        # Try common keys
        for key in ["query", "search", "q", "message_id", "messageId", "id"]:
            if key in data:
                return str(data[key])
        # If only one key, use that
        if len(data) == 1:
            return str(list(data.values())[0])
        return None
    except (json.JSONDecodeError, TypeError):
        return None


def parse_tool_calls(response: str) -> Dict[str, List]:
    """
    Parse tool calls from LLM response.

    Supports multiple formats:
    - Standard: [TOOL:argument]
    - Native model: <|channel|>commentary to=TOOL <|message|>{...}
    - Harmony: to=functions.xxx <|message|>{...}
    - MCP: [MCP:tool_name:{"args": "value"}]

    Returns:
        Dict with tool names as keys and their arguments as values:
        - 'get_context': list of message_ids
        - 'get_long_context': bool
        - 'web_search': list of search queries
        - 'local_rag': list of RAG queries
        - 'mcp': list of {'tool': name, 'args': dict} for MCP tools
    """
    result = {
        "get_context": [],
        "get_long_context": False,
        "web_search": [],
        "local_rag": [],
        "mcp": [],
    }

    # ===== Standard format: [TOOL:argument] =====

    # Find [GET_CONTEXT:message_id] calls
    context_matches = RE_GET_CONTEXT_TOOL.findall(response)
    result["get_context"] = [mid.strip() for mid in context_matches]

    # Find [GET_LONG_CONTEXT] calls
    if RE_GET_LONG_CONTEXT_TOOL.search(response):
        result["get_long_context"] = True

    # Find [WEB_SEARCH:query] calls
    search_matches = RE_WEB_SEARCH_TOOL.findall(response)
    result["web_search"] = [q.strip() for q in search_matches]

    # Find [LOCAL_RAG:query] calls
    rag_matches = RE_LOCAL_RAG_TOOL.findall(response)
    result["local_rag"] = [q.strip() for q in rag_matches]

    # ===== Native model format: <|channel|>commentary to=TOOL... =====

    # Parse native WEB_SEARCH - try JSON first, then plain text
    native_search_json = RE_NATIVE_WEB_SEARCH_JSON.findall(response)
    for json_str in native_search_json:
        query = _extract_query_from_json(json_str)
        if query and query not in result["web_search"]:
            print(f"[Tools] Detected native WEB_SEARCH (JSON): {query[:50]}...")
            result["web_search"].append(query)

    native_search_text = RE_NATIVE_WEB_SEARCH_TEXT.findall(response)
    for text in native_search_text:
        query = text.strip().strip('"').strip("'")
        # Skip if it looks like JSON (already handled above)
        if query and not query.startswith('{') and query not in result["web_search"]:
            # Clean up common prefixes
            if query.lower().startswith('web_search:'):
                query = query[11:].strip()
            if query:
                print(f"[Tools] Detected native WEB_SEARCH (text): {query[:50]}...")
                result["web_search"].append(query)

    # Parse native LOCAL_RAG - try JSON first, then plain text
    native_rag_json = RE_NATIVE_LOCAL_RAG_JSON.findall(response)
    for json_str in native_rag_json:
        query = _extract_query_from_json(json_str)
        if query and query not in result["local_rag"]:
            print(f"[Tools] Detected native LOCAL_RAG (JSON): {query[:50]}...")
            result["local_rag"].append(query)

    native_rag_text = RE_NATIVE_LOCAL_RAG_TEXT.findall(response)
    for text in native_rag_text:
        query = text.strip().strip('"').strip("'")
        if query and not query.startswith('{') and query not in result["local_rag"]:
            if query.lower().startswith('local_rag:'):
                query = query[10:].strip()
            if query:
                print(f"[Tools] Detected native LOCAL_RAG (text): {query[:50]}...")
                result["local_rag"].append(query)

    # Parse native GET_CONTEXT - try JSON first, then plain text
    native_context_json = RE_NATIVE_GET_CONTEXT_JSON.findall(response)
    for json_str in native_context_json:
        msg_id = _extract_query_from_json(json_str)
        if msg_id and msg_id not in result["get_context"]:
            print(f"[Tools] Detected native GET_CONTEXT (JSON): {msg_id[:20]}...")
            result["get_context"].append(msg_id)

    native_context_text = RE_NATIVE_GET_CONTEXT_TEXT.findall(response)
    for text in native_context_text:
        msg_id = text.strip().strip('"').strip("'")
        if msg_id and not msg_id.startswith('{') and msg_id not in result["get_context"]:
            if msg_id.lower().startswith('get_context:'):
                msg_id = msg_id[12:].strip()
            if msg_id:
                print(f"[Tools] Detected native GET_CONTEXT (text): {msg_id[:20]}...")
                result["get_context"].append(msg_id)

    # ===== GPT-OSS Harmony format: to=functions.xxx <|message|>{...} =====
    harmony_matches = RE_HARMONY_FUNCTION_CALL.findall(response)
    for func_name, args_json in harmony_matches:
        try:
            args = json.loads(args_json)

            # Map harmony function names to our tool types
            if func_name == "web_search":
                query = args.get("query", "")
                if query and query not in result["web_search"]:
                    print(f"[Tools] Detected harmony web_search: {query[:50]}...")
                    result["web_search"].append(query)

            elif func_name == "local_rag":
                query = args.get("query", "")
                if query and query not in result["local_rag"]:
                    print(f"[Tools] Detected harmony local_rag: {query[:50]}...")
                    result["local_rag"].append(query)

            elif func_name == "get_context":
                msg_id = args.get("message_id", "")
                if msg_id and msg_id not in result["get_context"]:
                    print(f"[Tools] Detected harmony get_context: {msg_id[:20]}...")
                    result["get_context"].append(msg_id)

            elif func_name == "get_long_context":
                print(f"[Tools] Detected harmony get_long_context")
                result["get_long_context"] = True

            elif func_name.startswith("mcp_"):
                # MCP tools: mcp_toolname -> toolname
                mcp_tool_name = func_name[4:]
                result["mcp"].append({"tool": mcp_tool_name, "args": args})
                print(f"[Tools] Detected harmony MCP tool: {mcp_tool_name}")

        except json.JSONDecodeError:
            print(f"[Tools] Invalid harmony function args: {args_json[:50]}...")

    # ===== MCP format: [MCP:tool_name:{"args": "value"}] =====
    mcp_matches = RE_MCP_TOOL.findall(response)
    seen_mcp_calls = set()  # Deduplicate by (tool_name, args_json) tuple
    for tool_name, args_json in mcp_matches:
        # Skip duplicates
        call_key = (tool_name, args_json)
        if call_key in seen_mcp_calls:
            continue
        seen_mcp_calls.add(call_key)

        try:
            args = json.loads(args_json)
            result["mcp"].append({"tool": tool_name, "args": args})
            print(f"[Tools] Detected MCP tool call: {tool_name}")
        except json.JSONDecodeError:
            print(f"[Tools] Invalid MCP args JSON: {args_json}")

    return result


def remove_tool_calls(response: str) -> str:
    """Remove tool call markers from response text (both standard and native formats)."""
    # Remove standard format
    cleaned = RE_GET_CONTEXT_TOOL.sub("", response)
    cleaned = RE_GET_LONG_CONTEXT_TOOL.sub("", cleaned)
    cleaned = RE_WEB_SEARCH_TOOL.sub("", cleaned)
    cleaned = RE_LOCAL_RAG_TOOL.sub("", cleaned)

    # Remove MCP tool calls
    cleaned = RE_MCP_TOOL.sub("", cleaned)

    # Remove native format tool calls (both JSON and text variants)
    cleaned = RE_NATIVE_WEB_SEARCH_JSON.sub("", cleaned)
    cleaned = RE_NATIVE_WEB_SEARCH_TEXT.sub("", cleaned)
    cleaned = RE_NATIVE_LOCAL_RAG_JSON.sub("", cleaned)
    cleaned = RE_NATIVE_LOCAL_RAG_TEXT.sub("", cleaned)
    cleaned = RE_NATIVE_GET_CONTEXT_JSON.sub("", cleaned)
    cleaned = RE_NATIVE_GET_CONTEXT_TEXT.sub("", cleaned)

    return cleaned.strip()