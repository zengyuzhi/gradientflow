# -*- coding: utf-8 -*-
"""
Built-in Tools for Agent Service

Provides context retrieval tools that agents can use to get more information
about the conversation history.
"""
import re
import time
import requests
from typing import Optional, Dict, List

# Tool patterns for parsing LLM responses
RE_GET_CONTEXT_TOOL = re.compile(r"\[GET_CONTEXT:([^\]]+)\]")
RE_GET_LONG_CONTEXT_TOOL = re.compile(r"\[GET_LONG_CONTEXT\]")
RE_MENTION = re.compile(r"@[\w\-\.]+\s*")

# Constants
DEFAULT_CONTEXT_BEFORE = 5
DEFAULT_CONTEXT_AFTER = 4
DEFAULT_LONG_CONTEXT_MAX = 50
DEFAULT_COMPRESS_MAX_CHARS = 4000


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


def parse_tool_calls(response: str) -> Dict[str, List]:
    """
    Parse tool calls from LLM response.

    Returns:
        Dict with 'get_context' (list of message_ids) and 'get_long_context' (bool)
    """
    result = {
        "get_context": [],
        "get_long_context": False,
    }

    # Find [GET_CONTEXT:message_id] calls
    context_matches = RE_GET_CONTEXT_TOOL.findall(response)
    result["get_context"] = [mid.strip() for mid in context_matches]

    # Find [GET_LONG_CONTEXT] calls
    if RE_GET_LONG_CONTEXT_TOOL.search(response):
        result["get_long_context"] = True

    return result


def remove_tool_calls(response: str) -> str:
    """Remove tool call markers from response text."""
    cleaned = RE_GET_CONTEXT_TOOL.sub("", response)
    cleaned = RE_GET_LONG_CONTEXT_TOOL.sub("", cleaned)
    return cleaned.strip()
