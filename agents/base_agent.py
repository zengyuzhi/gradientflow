# -*- coding: utf-8 -*-
"""
Base Agent Class

Abstract base class for agent services, providing common functionality
for message processing, context building, and main loop management.
"""

import time
import threading
from abc import ABC, abstractmethod
from typing import Optional, Dict, List, Set, Tuple

from core import (
    API_BASE,
    AGENT_TOKEN,
    DEFAULT_AGENT_ID,
    DEFAULT_AGENT_USER_ID,
    POLL_INTERVAL,
    HEARTBEAT_INTERVAL,
    DEFAULT_PROACTIVE_COOLDOWN,
    CONVERSATION_ID,
    CONTEXT_LIMIT,
    strip_special_tags,
    RE_MENTION,
    AgentAPIClient,
    MentionDetector,
)


class BaseAgentService(ABC):
    """
    Abstract base class for Agent Services.

    Provides common functionality:
    - API client management
    - Mention detection
    - Heartbeat management
    - Main loop structure
    - Message processing framework

    Subclasses must implement:
    - generate_reply(): LLM response generation
    - build_system_prompt(): System prompt construction
    - _init_llm(): LLM client initialization
    """

    def __init__(
        self,
        api_base: str = API_BASE,
        agent_token: str = AGENT_TOKEN,
        agent_id: str = DEFAULT_AGENT_ID,
        agent_user_id: str = DEFAULT_AGENT_USER_ID,
    ):
        """
        Initialize the base agent service.

        Args:
            api_base: Backend API base URL
            agent_token: Agent authentication token
            agent_id: Unique agent identifier
            agent_user_id: Agent's user ID in the system
        """
        self.agent_id = agent_id
        self.agent_user_id = agent_user_id

        # API client
        self.api_client = AgentAPIClient(
            api_base=api_base,
            agent_token=agent_token,
            agent_id=agent_id,
            conversation_id=CONVERSATION_ID,
        )

        # Mention detector
        self.mention_detector = MentionDetector(agent_user_id)

        # State tracking
        self.last_seen_timestamp = int(time.time() * 1000)
        self.processed_message_ids: Set[str] = set()
        self.reacted_message_ids: Set[str] = set()
        self.last_proactive_time: float = 0
        self.agent_config: Optional[Dict] = None
        self._running = False

        # Message cancellation support
        self._pending_message_id: Optional[str] = None
        self._cancel_requested = False
        self._processing_lock = threading.Lock()

    # =========================================================================
    # Properties for backward compatibility
    # =========================================================================

    @property
    def api_base(self) -> str:
        return self.api_client.api_base

    @property
    def jwt_token(self) -> Optional[str]:
        return self.api_client.jwt_token

    @jwt_token.setter
    def jwt_token(self, value: Optional[str]):
        self.api_client.jwt_token = value

    @property
    def _session(self):
        return self.api_client.session

    @property
    def _agent_headers(self) -> Dict[str, str]:
        return self.api_client.agent_headers

    @property
    def _user_map_cache(self) -> Dict[str, str]:
        return self.mention_detector.get_user_map()

    @property
    def _agent_name_cache(self) -> Optional[str]:
        return self.mention_detector.agent_name

    # =========================================================================
    # Authentication
    # =========================================================================

    def login(self, email: str, password: str) -> Optional[str]:
        """Login and get JWT token."""
        return self.api_client.login(email, password)

    # =========================================================================
    # Configuration
    # =========================================================================

    def fetch_agent_config(self) -> Optional[Dict]:
        """Fetch and apply agent configuration."""
        config = self.api_client.fetch_agent_config()
        if not config:
            return None

        self.agent_config = config

        # Update agent_user_id from config
        if config.get("userId"):
            self.agent_user_id = config["userId"]
            self.mention_detector.agent_user_id = config["userId"]
            print(f"[Agent] Updated agent_user_id: {self.agent_user_id}")

        # Initialize LLM (subclass-specific)
        self._init_llm(config)

        return config

    @abstractmethod
    def _init_llm(self, config: Dict) -> None:
        """
        Initialize LLM client based on config.
        Must be implemented by subclasses.
        """
        pass

    # =========================================================================
    # Message Operations
    # =========================================================================

    def fetch_messages(
        self, since: Optional[int] = None
    ) -> Tuple[List[Dict], List[Dict]]:
        """Fetch messages and update user cache."""
        messages, users = self.api_client.fetch_messages(since)
        if users:
            self.mention_detector.update_user_cache(users)
        return messages, users

    def send_message(
        self, content: str, reply_to_id: Optional[str] = None
    ) -> bool:
        """Send a message."""
        return self.api_client.send_message(content, reply_to_id)

    def send_heartbeat(self) -> bool:
        """Send heartbeat signal."""
        return self.api_client.send_heartbeat()

    def add_reaction(self, message_id: str, emoji: str) -> bool:
        """Add reaction to a message."""
        return self.api_client.add_reaction(message_id, emoji)

    def set_looking(self, is_looking: bool) -> bool:
        """Set agent looking status."""
        return self.api_client.set_looking(is_looking)

    # =========================================================================
    # Mention Detection
    # =========================================================================

    def is_mentioned(self, message: Dict, users: List[Dict]) -> bool:
        """Check if this agent was mentioned."""
        return self.mention_detector.is_mentioned(message, users)

    def mentions_another_agent(self, message: Dict, users: List[Dict]) -> bool:
        """Check if message mentions another agent."""
        return self.mention_detector.mentions_another_agent(message, users)

    # =========================================================================
    # Follow-up Detection
    # =========================================================================

    def check_for_followup_messages(
        self, sender_id: str, after_timestamp: int
    ) -> Optional[Dict]:
        """
        Check if sender has sent follow-up messages.

        Used to detect "split message" problem where user sends
        multiple messages in succession.
        """
        try:
            messages, _ = self.fetch_messages(since=after_timestamp)
            followups = [
                m
                for m in messages
                if m.get("senderId") == sender_id
                and m.get("timestamp", 0) > after_timestamp
                and m.get("id") not in self.processed_message_ids
            ]
            if followups:
                return max(followups, key=lambda m: m.get("timestamp", 0))
            return None
        except Exception as e:
            print(f"[Agent] Error checking follow-up: {e}")
            return None

    def should_cancel_response(
        self, original_msg: Dict
    ) -> Tuple[bool, Optional[Dict]]:
        """Check if response should be cancelled due to follow-up."""
        sender_id = original_msg.get("senderId")
        msg_timestamp = original_msg.get("timestamp", 0)

        followup = self.check_for_followup_messages(sender_id, msg_timestamp)
        if followup:
            print(f"[Agent] Detected follow-up, cancelling response...")
            return True, followup

        return False, None

    # =========================================================================
    # Context Building
    # =========================================================================

    def build_context(
        self, messages: List[Dict], users: List[Dict], current_msg: Dict
    ) -> List[Dict]:
        """
        Build conversation context for LLM.

        Returns list of messages formatted for LLM input.
        """
        user_map = self.mention_detector.get_user_map()
        # Add any missing users
        for u in users:
            if u["id"] not in user_map:
                user_map[u["id"]] = u.get("name", "User")

        # Get agent user IDs
        agent_user_ids = self.mention_detector.get_agent_user_ids(users)

        # Take recent messages as context
        recent = messages[-CONTEXT_LIMIT:]
        context_messages = []

        for msg in recent:
            sender_id = msg.get("senderId", "")
            msg_id = msg.get("id", "")
            mentions = msg.get("mentions", [])
            reply_to_id = msg.get("replyToId")

            # Clean content
            content = strip_special_tags(msg.get("content", ""))
            content = RE_MENTION.sub("", content).strip()

            # Determine direction
            directed_to = None
            directed_to_me = False

            # Check mentions
            for mentioned_id in mentions:
                if mentioned_id in agent_user_ids:
                    if mentioned_id == self.agent_user_id:
                        directed_to_me = True
                        directed_to = "YOU"
                    else:
                        directed_to = agent_user_ids[mentioned_id]
                    break

            # Check reply target
            if reply_to_id and not directed_to:
                replied_msg = next(
                    (m for m in messages if m.get("id") == reply_to_id), None
                )
                if replied_msg:
                    replied_sender = replied_msg.get("senderId")
                    if replied_sender in agent_user_ids:
                        if replied_sender == self.agent_user_id:
                            directed_to_me = True
                            directed_to = "YOU"
                        else:
                            directed_to = agent_user_ids[replied_sender]

            if sender_id == self.agent_user_id:
                context_messages.append({"role": "assistant", "content": content})
            else:
                sender_name = user_map.get(sender_id, "User")

                if directed_to_me:
                    formatted = f"[msg:{msg_id}] {sender_name} (to you): {content}"
                elif directed_to:
                    formatted = f"[msg:{msg_id}] {sender_name} (to @{directed_to}): {content}"
                else:
                    formatted = f"[msg:{msg_id}] {sender_name}: {content}"
                context_messages.append({"role": "user", "content": formatted})

        return context_messages

    # =========================================================================
    # System Prompt Building
    # =========================================================================

    @abstractmethod
    def build_system_prompt(
        self, mode: str = "passive", users: List[Dict] = None
    ) -> str:
        """
        Build system prompt for LLM.
        Must be implemented by subclasses.
        """
        pass

    def _build_base_system_prompt(
        self, mode: str = "passive", users: List[Dict] = None
    ) -> str:
        """
        Build the common parts of system prompt.

        Includes:
        - Current date/time
        - Agent name and other AI awareness
        - Mode-specific instructions
        """
        import datetime

        current_date = datetime.datetime.now().strftime("%Y年%m月%d日")
        current_datetime = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        default_prompt = (
            "You are a helpful AI assistant in GradientFlow. "
            "Respond directly and concisely to the user's message. "
            "Do NOT include any prefix like '[GPT-4]:' or your name in responses. "
            "Be friendly and helpful. You may respond in the user's language."
        )
        config_prompt = (
            self.agent_config.get("systemPrompt") if self.agent_config else None
        )
        base_prompt = config_prompt or default_prompt

        # Add date/time context
        base_prompt = f"**Current date: {current_date} ({current_datetime})**\n\n{base_prompt}"

        # Agent awareness
        my_name = self.mention_detector.agent_name or "Assistant"
        ai_agents = []
        if users:
            for u in users:
                if (
                    u.get("type") == "agent" or u.get("isLLM")
                ) and u.get("id") != self.agent_user_id:
                    ai_agents.append(u.get("name", "Unknown AI"))

        ai_awareness = f"\n\n## GradientFlow Info\n"
        ai_awareness += f"**Your Name:** {my_name}\n"
        if ai_agents:
            ai_awareness += f"**Other AI Agents:** {', '.join(ai_agents)}\n"

        ai_awareness += "\n**Important:** Messages with `(to @SomeAgent)` are directed at that specific agent. "
        ai_awareness += "If a message is `(to @OtherAgent)` and NOT `(to you)`, output `[SKIP]` - it's not your question to answer.\n"
        ai_awareness += "- Reply when the message is (to you) or is open to everyone.\n"
        ai_awareness += "- Use the existing conversation history when answering general questions; do not ignore prior context.\n"

        base_prompt += ai_awareness

        return base_prompt

    # =========================================================================
    # Response Generation
    # =========================================================================

    @abstractmethod
    def generate_reply(
        self,
        context: List[Dict],
        current_msg: Dict,
        mode: str = "passive",
        users: List[Dict] = None,
    ) -> Tuple[bool, str]:
        """
        Generate a reply using LLM.
        Must be implemented by subclasses.

        Returns:
            Tuple of (only_tools, reply_text)
        """
        pass

    # =========================================================================
    # Message Processing
    # =========================================================================

    def process_message(
        self,
        message: Dict,
        messages: List[Dict],
        users: List[Dict],
        check_followup: bool = True,
    ):
        """
        Process a single message that mentioned this agent.
        """
        msg_id = message.get("id")
        sender_id = message.get("senderId")

        # Skip own messages
        if sender_id == self.agent_user_id:
            return

        # Skip already processed
        if msg_id in self.processed_message_ids:
            return

        # Check if mentioned
        if not self.is_mentioned(message, users):
            return

        print(f"[Agent] Processing mention: {message.get('content', '')[:50]}...")

        # Follow-up check before processing
        if check_followup:
            should_cancel, _ = self.should_cancel_response(message)
            if should_cancel:
                print(f"[Agent] Skipping due to follow-up")
                self.processed_message_ids.add(msg_id)
                return

        self.set_looking(True)

        try:
            # Refresh config
            self.fetch_agent_config()

            # Refresh messages
            fresh_messages, fresh_users = self.fetch_messages()
            if fresh_messages:
                messages = fresh_messages
                users = fresh_users

            # Build context
            context = self.build_context(messages, users, message)

            # Generate reply
            only_tools, reply = self.generate_reply(
                context, message, mode="passive", users=users
            )

            # Follow-up check after processing
            should_cancel_after, _ = self.should_cancel_response(message)
            if should_cancel_after and not only_tools:
                print(f"[Agent] Response cancelled - user sent follow-up")
                self.processed_message_ids.add(msg_id)
                return

            if only_tools:
                print(f"[Agent] Only tool actions, no text reply")
            elif reply:
                self.send_message(reply, reply_to_id=msg_id)

            self.processed_message_ids.add(msg_id)
        finally:
            self.set_looking(False)

    def try_proactive_response(
        self, message: Dict, messages: List[Dict], users: List[Dict]
    ) -> bool:
        """
        Try to respond proactively (AI decides).

        Returns True if responded, False if skipped.
        """
        msg_id = message.get("id")
        sender_id = message.get("senderId")

        # Skip own messages
        if sender_id == self.agent_user_id:
            return False

        # Skip already handled
        if msg_id in self.reacted_message_ids:
            return False

        # Skip messages from other agents
        agent_user_ids = set()
        for u in users:
            if u.get("type") == "agent" or u.get("isLLM"):
                agent_user_ids.add(u.get("id"))

        if sender_id in agent_user_ids:
            self.reacted_message_ids.add(msg_id)
            return False

        # Skip if mentions another agent
        if self.mentions_another_agent(message, users):
            self.reacted_message_ids.add(msg_id)
            return False

        # Check capabilities
        capabilities = (
            self.agent_config.get("capabilities", {}) if self.agent_config else {}
        )
        if not capabilities.get("answer_active") and not capabilities.get("like"):
            return False

        # Check cooldown
        runtime = self.agent_config.get("runtime", {}) if self.agent_config else {}
        cooldown = runtime.get("proactiveCooldown", DEFAULT_PROACTIVE_COOLDOWN)
        now = time.time()
        if now - self.last_proactive_time < cooldown:
            return False

        # Follow-up check
        should_cancel, _ = self.should_cancel_response(message)
        if should_cancel:
            self.reacted_message_ids.add(msg_id)
            return False

        print(f"[Agent] Proactive mode: {message.get('content', '')[:50]}...")

        self.set_looking(True)
        try:
            self.fetch_agent_config()

            fresh_messages, fresh_users = self.fetch_messages()
            if fresh_messages:
                messages = fresh_messages
                users = fresh_users

            context = self.build_context(messages, users, message)
            only_tools, response = self.generate_reply(
                context, message, mode="proactive", users=users
            )

            if "[SKIP]" in response:
                self.reacted_message_ids.add(msg_id)
                return False

            # Follow-up check after
            should_cancel_after, _ = self.should_cancel_response(message)
            if should_cancel_after and not only_tools:
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

    # =========================================================================
    # Heartbeat Loop
    # =========================================================================

    def _heartbeat_loop(self) -> None:
        """Heartbeat thread function."""
        while self._running:
            self.send_heartbeat()
            time.sleep(HEARTBEAT_INTERVAL)

    # =========================================================================
    # Main Loop
    # =========================================================================

    def run(self):
        """Main loop."""
        agent_name = (
            self.agent_config.get("name", self.agent_id)
            if self.agent_config
            else self.agent_id
        )
        print(f"[Agent] Starting service: {agent_name}")
        print(f"[Agent] API: {self.api_base}")
        print(f"[Agent] Agent ID: {self.agent_id}")
        print(f"[Agent] Poll interval: {POLL_INTERVAL}s")
        print(f"[Agent] Heartbeat interval: {HEARTBEAT_INTERVAL}s")
        print("-" * 40)

        # Start heartbeat thread
        self._running = True
        self.send_heartbeat()
        heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, daemon=True
        )
        heartbeat_thread.start()
        print("[Agent] Heartbeat thread started")

        while self._running:
            try:
                messages, users = self.fetch_messages()

                if messages:
                    # Filter new messages
                    new_messages = [
                        m
                        for m in messages
                        if m.get("timestamp", 0) > self.last_seen_timestamp
                        and m.get("id") not in self.processed_message_ids
                    ]

                    for msg in new_messages:
                        if self.is_mentioned(msg, users):
                            self.process_message(msg, messages, users)
                        else:
                            self.try_proactive_response(msg, messages, users)

                    # Update timestamp
                    if messages:
                        latest_ts = max(m.get("timestamp", 0) for m in messages)
                        self.last_seen_timestamp = max(
                            self.last_seen_timestamp, latest_ts
                        )

            except Exception as e:
                print(f"[Agent] Loop error: {e}")
                import traceback
                traceback.print_exc()

            time.sleep(POLL_INTERVAL)

    def stop(self):
        """Stop the agent."""
        self._running = False
