# -*- coding: utf-8 -*-
"""
Built-in Tools for Agent Service

Provides tools that agents can use:
- Context retrieval (get_context, get_long_context)
- Web search (web_search)
- Local RAG (local_rag)
"""
import re
import time
import os
import json
import requests
from typing import Optional, Dict, List

# Tool patterns for parsing LLM responses
# Standard format: [TOOL:argument]
RE_GET_CONTEXT_TOOL = re.compile(r"\[GET_CONTEXT:([^\]]+)\]")
RE_GET_LONG_CONTEXT_TOOL = re.compile(r"\[GET_LONG_CONTEXT\]")
RE_WEB_SEARCH_TOOL = re.compile(r"\[WEB_SEARCH:([^\]]+)\]")
RE_LOCAL_RAG_TOOL = re.compile(r"\[LOCAL_RAG:([^\]]+)\]")
RE_MENTION = re.compile(r"@[\w\-\.]+\s*")

# Native model format: <|channel|>commentary to=TOOL <|constrain|>json<|message|>{"query":"..."}
# Some models (e.g., parallax models) use their own tool-calling format
RE_NATIVE_WEB_SEARCH = re.compile(
    r"<\|channel\|>(?:commentary|tool)\s+to=WEB_SEARCH[^<]*<\|(?:constrain\|>json)?<?\|?message\|>\s*(\{[^}]+\})",
    re.IGNORECASE
)
RE_NATIVE_LOCAL_RAG = re.compile(
    r"<\|channel\|>(?:commentary|tool)\s+to=LOCAL_RAG[^<]*<\|(?:constrain\|>json)?<?\|?message\|>\s*(\{[^}]+\})",
    re.IGNORECASE
)
RE_NATIVE_GET_CONTEXT = re.compile(
    r"<\|channel\|>(?:commentary|tool)\s+to=GET_CONTEXT[^<]*<\|(?:constrain\|>json)?<?\|?message\|>\s*(\{[^}]+\})",
    re.IGNORECASE
)

# Constants
DEFAULT_CONTEXT_BEFORE = 5
DEFAULT_CONTEXT_AFTER = 4
DEFAULT_LONG_CONTEXT_MAX = 50
DEFAULT_COMPRESS_MAX_CHARS = 4000
DEFAULT_RAG_TOP_K = 5


def strip_special_tags(text: str) -> str:
    """Clean model output of special tags, keeping only final answer"""
    if not text:
        return ""

    # Remove <think>...</think>
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # Remove channel blocks
    text = re.sub(r"<\|[^>]+\|>", "", text)
    # Clean multiple newlines
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


class AgentTools:
    """
    Built-in tools for agent context retrieval.

    Usage:
        tools = AgentTools(api_base, agent_id, headers, session)
        context = tools.get_context(message_id)
        long_context = tools.get_long_context()
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

        Converts full chat history into a compact text format, preserving
        key information while reducing token usage.

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
            url = result.get("url", "")
            snippet = result.get("snippet", "No description")
            formatted.append(f"{i}. **{title}**\n   URL: {url}\n   {snippet}")

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

    Supports both standard format [TOOL:argument] and native model format
    <|channel|>commentary to=TOOL <|constrain|>json<|message|>{"query":"..."}

    Returns:
        Dict with tool names as keys and their arguments as values:
        - 'get_context': list of message_ids
        - 'get_long_context': bool
        - 'web_search': list of search queries
        - 'local_rag': list of RAG queries
    """
    result = {
        "get_context": [],
        "get_long_context": False,
        "web_search": [],
        "local_rag": [],
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
    # Some models (e.g., parallax/deepseek) use their own tool-calling format

    # Parse native WEB_SEARCH
    native_search_matches = RE_NATIVE_WEB_SEARCH.findall(response)
    for json_str in native_search_matches:
        query = _extract_query_from_json(json_str)
        if query and query not in result["web_search"]:
            print(f"[Tools] Detected native WEB_SEARCH format: {query[:50]}...")
            result["web_search"].append(query)

    # Parse native LOCAL_RAG
    native_rag_matches = RE_NATIVE_LOCAL_RAG.findall(response)
    for json_str in native_rag_matches:
        query = _extract_query_from_json(json_str)
        if query and query not in result["local_rag"]:
            print(f"[Tools] Detected native LOCAL_RAG format: {query[:50]}...")
            result["local_rag"].append(query)

    # Parse native GET_CONTEXT
    native_context_matches = RE_NATIVE_GET_CONTEXT.findall(response)
    for json_str in native_context_matches:
        msg_id = _extract_query_from_json(json_str)
        if msg_id and msg_id not in result["get_context"]:
            print(f"[Tools] Detected native GET_CONTEXT format: {msg_id[:20]}...")
            result["get_context"].append(msg_id)

    return result


def remove_tool_calls(response: str) -> str:
    """Remove tool call markers from response text (both standard and native formats)."""
    # Remove standard format
    cleaned = RE_GET_CONTEXT_TOOL.sub("", response)
    cleaned = RE_GET_LONG_CONTEXT_TOOL.sub("", cleaned)
    cleaned = RE_WEB_SEARCH_TOOL.sub("", cleaned)
    cleaned = RE_LOCAL_RAG_TOOL.sub("", cleaned)

    # Remove native format tool calls
    cleaned = RE_NATIVE_WEB_SEARCH.sub("", cleaned)
    cleaned = RE_NATIVE_LOCAL_RAG.sub("", cleaned)
    cleaned = RE_NATIVE_GET_CONTEXT.sub("", cleaned)

    return cleaned.strip()
