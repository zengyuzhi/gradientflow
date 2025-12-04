# -*- coding: utf-8 -*-
"""
Agent API Client

HTTP API wrapper for backend communication.
Provides a unified interface for all agent-backend interactions.
"""

import requests
from typing import Optional, Dict, List, Tuple

from .config import (
    API_BASE,
    AGENT_TOKEN,
    CONVERSATION_ID,
    REQUEST_TIMEOUT,
    LLM_TIMEOUT,
)


class AgentAPIClient:
    """
    HTTP API client for agent-backend communication.

    Handles:
    - Authentication (login, JWT token management)
    - Message operations (fetch, send)
    - Heartbeat signals
    - Reaction management
    - Agent looking status

    Usage:
        client = AgentAPIClient(agent_id="my-agent")
        client.login("user@example.com", "password")
        messages, users = client.fetch_messages()
        client.send_message("Hello!")
    """

    def __init__(
        self,
        api_base: str = API_BASE,
        agent_token: str = AGENT_TOKEN,
        agent_id: str = "helper-agent-1",
        conversation_id: str = CONVERSATION_ID,
    ):
        """
        Initialize the API client.

        Args:
            api_base: Backend API base URL
            agent_token: Agent authentication token
            agent_id: Unique agent identifier
            conversation_id: Conversation/channel ID
        """
        self.api_base = api_base
        self.agent_token = agent_token
        self.agent_id = agent_id
        self.conversation_id = conversation_id
        self.jwt_token: Optional[str] = None

        # Reusable HTTP session for connection pooling
        self._session = requests.Session()

        # Agent-specific headers
        self._agent_headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": self.agent_token,
        }

    @property
    def agent_headers(self) -> Dict[str, str]:
        """Get agent API headers."""
        return self._agent_headers.copy()

    @property
    def session(self) -> requests.Session:
        """Get the HTTP session for direct use if needed."""
        return self._session

    def _get_auth_headers(self) -> Dict[str, str]:
        """Get JWT authentication headers."""
        if self.jwt_token:
            return {"Authorization": f"Bearer {self.jwt_token}"}
        return {}

    # =========================================================================
    # Authentication
    # =========================================================================

    def login(self, email: str, password: str) -> Optional[str]:
        """
        Login to get JWT token.

        Args:
            email: User email
            password: User password

        Returns:
            JWT token if successful, None otherwise
        """
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
                    print(f"[API] Login successful")
                    return token
            print(f"[API] Login failed: {resp.status_code}")
            return None
        except requests.RequestException as e:
            print(f"[API] Login error: {e}")
            return None

    # =========================================================================
    # Agent Configuration
    # =========================================================================

    def fetch_agent_config(self) -> Optional[Dict]:
        """
        Fetch agent configuration from backend.

        Returns:
            Agent config dict if found, None otherwise
        """
        try:
            resp = self._session.get(
                f"{self.api_base}/agents",
                headers=self._get_auth_headers(),
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code != 200:
                print(f"[API] Failed to fetch agent config: {resp.status_code}")
                return None

            agents = resp.json().get("agents", [])
            agent = next((a for a in agents if a.get("id") == self.agent_id), None)
            if not agent:
                print(f"[API] Agent not found: {self.agent_id}")
                return None

            return agent
        except requests.RequestException as e:
            print(f"[API] Fetch config error: {e}")
            return None

    def fetch_all_agents(self) -> List[Dict]:
        """
        Fetch all agent configurations.

        Returns:
            List of agent config dicts
        """
        try:
            resp = self._session.get(
                f"{self.api_base}/agents",
                headers=self._get_auth_headers(),
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                agents = resp.json().get("agents", [])
                print(f"[API] Found {len(agents)} agents")
                return agents
            print(f"[API] Failed to fetch agents: {resp.status_code}")
            return []
        except requests.RequestException as e:
            print(f"[API] Error fetching agents: {e}")
            return []

    # =========================================================================
    # Messages
    # =========================================================================

    def fetch_messages(
        self, since: Optional[int] = None
    ) -> Tuple[List[Dict], List[Dict]]:
        """
        Fetch messages from the server.

        Args:
            since: Optional timestamp to fetch messages after

        Returns:
            Tuple of (messages list, users list)
        """
        params = {"conversationId": self.conversation_id}
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
                return data.get("messages", []), data.get("users", [])
            elif resp.status_code == 401:
                print("[API] Unauthorized, please login first")
            else:
                print(f"[API] Fetch messages failed: {resp.status_code}")
            return [], []
        except requests.RequestException as e:
            print(f"[API] Fetch messages error: {e}")
            return [], []

    def send_message(
        self, content: str, reply_to_id: Optional[str] = None
    ) -> bool:
        """
        Send a message via Agent API.

        Args:
            content: Message content
            reply_to_id: Optional message ID to reply to

        Returns:
            True if successful, False otherwise
        """
        payload = {"content": content, "conversationId": self.conversation_id}
        if reply_to_id:
            payload["replyToId"] = reply_to_id

        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/messages",
                json=payload,
                headers=self._agent_headers,
                timeout=LLM_TIMEOUT,
            )
            if resp.status_code == 200:
                print(f"[API] Message sent: {content[:50]}...")
                return True
            print(f"[API] Send failed: {resp.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[API] Send error: {e}")
            return False

    # =========================================================================
    # Heartbeat
    # =========================================================================

    def send_heartbeat(self) -> bool:
        """
        Send heartbeat signal.

        Returns:
            True if successful, False otherwise
        """
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/heartbeat",
                headers=self._agent_headers,
                timeout=5,
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False

    # =========================================================================
    # Reactions
    # =========================================================================

    def add_reaction(self, message_id: str, emoji: str) -> bool:
        """
        Add emoji reaction to a message.

        Args:
            message_id: Target message ID
            emoji: Emoji to add

        Returns:
            True if successful, False otherwise
        """
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/reactions",
                json={"messageId": message_id, "emoji": emoji},
                headers=self._agent_headers,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                print(f"[API] Reaction added: {emoji} -> {message_id[:8]}...")
                return True
            print(f"[API] Add reaction failed: {resp.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[API] Add reaction error: {e}")
            return False

    # =========================================================================
    # Agent Status
    # =========================================================================

    def set_looking(self, is_looking: bool) -> bool:
        """
        Set agent's looking status.

        Args:
            is_looking: True if agent is looking at messages

        Returns:
            True if successful, False otherwise
        """
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/looking",
                json={"isLooking": is_looking},
                headers=self._agent_headers,
                timeout=5,
            )
            if resp.status_code == 200:
                return True
            return False
        except requests.RequestException:
            return False

    # =========================================================================
    # Context Tools (for agent tools)
    # =========================================================================

    def get_context(
        self, message_id: str, before: int = 5, after: int = 4
    ) -> Optional[Dict]:
        """
        Get context around a specific message.

        Args:
            message_id: Target message ID
            before: Number of messages before
            after: Number of messages after

        Returns:
            Context data dict or None
        """
        try:
            resp = self._session.get(
                f"{self.api_base}/agents/{self.agent_id}/context",
                params={
                    "messageId": message_id,
                    "before": before,
                    "after": after,
                    "conversationId": self.conversation_id,
                },
                headers=self._agent_headers,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.RequestException:
            return None

    def get_long_context(self, max_messages: int = 50) -> Optional[Dict]:
        """
        Get full conversation history.

        Args:
            max_messages: Maximum messages to retrieve

        Returns:
            Context data dict or None
        """
        try:
            resp = self._session.get(
                f"{self.api_base}/agents/{self.agent_id}/long-context",
                params={
                    "maxMessages": min(max_messages, 200),
                    "conversationId": self.conversation_id,
                    "includeSystemPrompt": "false",
                },
                headers=self._agent_headers,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.RequestException:
            return None

    def web_search(self, query: str, max_results: int = 5) -> Optional[Dict]:
        """
        Execute web search via backend.

        Args:
            query: Search query
            max_results: Maximum results

        Returns:
            Search results dict or None
        """
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/tools/web-search",
                json={"query": query, "maxResults": max_results},
                headers=self._agent_headers,
                timeout=30,
            )
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.RequestException:
            return None

    def local_rag(self, query: str, top_k: int = 5) -> Optional[Dict]:
        """
        Search local knowledge base.

        Args:
            query: Search query
            top_k: Number of results

        Returns:
            RAG results dict or None
        """
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/tools/local-rag",
                json={"query": query, "topK": top_k},
                headers=self._agent_headers,
                timeout=15,
            )
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.RequestException:
            return None

    def execute_mcp_tool(
        self, mcp_config: Dict, tool_name: str, arguments: Dict
    ) -> Optional[Dict]:
        """
        Execute an MCP tool via backend proxy.

        Args:
            mcp_config: MCP server configuration
            tool_name: Tool name to execute
            arguments: Tool arguments

        Returns:
            Tool result or None
        """
        server_url = mcp_config.get("endpoint") or mcp_config.get("url", "")
        api_key = mcp_config.get("apiKey", "")
        transport = mcp_config.get("transport")

        if not server_url:
            print(f"[API] MCP: No server URL configured")
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

            resp = self._session.post(
                f"{self.api_base}/mcp/execute",
                json=payload,
                headers=self._agent_headers,
                timeout=30,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("result") or data.get("data") or data.get("content")
            return None
        except requests.RequestException as e:
            print(f"[API] MCP error: {e}")
            return None