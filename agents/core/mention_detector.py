# -*- coding: utf-8 -*-
"""
Mention Detector

Logic for detecting @ mentions in messages and determining if an agent
should respond to a message.
"""

import re
from typing import Dict, List, Optional, Set

from .response_cleaner import log_text


class MentionDetector:
    """
    Detects @ mentions in messages and manages user cache.

    Handles:
    - Checking if a message mentions a specific agent
    - Checking if a message mentions another agent (not this one)
    - User name caching for efficient lookups

    Usage:
        detector = MentionDetector(agent_user_id="llm1")
        detector.update_user_cache(users)
        if detector.is_mentioned(message, users):
            # Handle mention
        if detector.mentions_another_agent(message, users):
            # Skip - message is for another agent
    """

    def __init__(self, agent_user_id: str):
        """
        Initialize the mention detector.

        Args:
            agent_user_id: The user ID of this agent
        """
        self.agent_user_id = agent_user_id
        self._user_map_cache: Dict[str, str] = {}
        self._agent_name_cache: Optional[str] = None

    @property
    def agent_name(self) -> Optional[str]:
        """Get the cached agent name."""
        return self._agent_name_cache

    def update_user_cache(self, users: List[Dict]) -> None:
        """
        Update the user name cache.

        Args:
            users: List of user objects with 'id' and 'name' fields
        """
        for user in users:
            user_id = user.get("id")
            if user_id:
                self._user_map_cache[user_id] = user.get("name", "User")
                # Cache agent's own name
                if user_id == self.agent_user_id:
                    self._agent_name_cache = user.get("name")

    def get_user_name(self, user_id: str) -> str:
        """
        Get user name from cache.

        Args:
            user_id: User ID to look up

        Returns:
            User name or "User" if not found
        """
        return self._user_map_cache.get(user_id, "User")

    def get_user_map(self) -> Dict[str, str]:
        """Get a copy of the user map cache."""
        return self._user_map_cache.copy()

    def is_mentioned(self, message: Dict, users: List[Dict]) -> bool:
        """
        Check if this agent was mentioned in the message.

        Args:
            message: Message object with 'mentions' and 'content' fields
            users: List of user objects

        Returns:
            True if this agent was mentioned
        """
        my_agent_name = self._agent_name_cache or self.agent_user_id
        mentions = message.get("mentions", [])
        content = message.get("content", "")

        # Debug logging
        print(f"[{my_agent_name}] is_mentioned check:")
        print(f"  - my user_id: {self.agent_user_id}")
        print(f"  - mentions list: {mentions}")
        print(f"  - content: {log_text(content)}")

        # Quick check: mentions list
        if self.agent_user_id in mentions:
            print(f"  - RESULT: True (found in mentions list)")
            return True

        # Check content for @AgentName
        agent_name = self._agent_name_cache
        if not agent_name:
            # Try to find from users list
            for user in users:
                if user.get("id") == self.agent_user_id:
                    agent_name = user.get("name", "")
                    self._agent_name_cache = agent_name
                    break

        result = bool(agent_name and f"@{agent_name}" in content)
        print(f"  - my name: {agent_name}")
        print(
            f"  - RESULT: {result} (name in content: {f'@{agent_name}' in content if agent_name else 'N/A'})"
        )
        return result

    def mentions_another_agent(self, message: Dict, users: List[Dict]) -> bool:
        """
        Check if message mentions another agent (not this one).

        If a message explicitly mentions another agent, this agent should not
        respond proactively.

        Args:
            message: Message object
            users: List of user objects

        Returns:
            True if another agent was mentioned
        """
        mentions = message.get("mentions", [])
        content = message.get("content", "")

        my_agent_name = self._agent_name_cache or self.agent_user_id
        print(f"[{my_agent_name}] mentions_another_agent check:")
        print(f"  - mentions list: {mentions}")
        print(f"  - content: {log_text(content)}")
        print(f"  - my user_id: {self.agent_user_id}")

        # Get all agent-type users
        agent_users = [
            u for u in users if u.get("type") == "agent" or u.get("isLLM")
        ]
        print(f"  - Found {len(agent_users)} agent users:")
        for u in agent_users:
            print(
                f"    - {u.get('name')} (id={u.get('id')}, type={u.get('type')}, isLLM={u.get('isLLM')})"
            )

        for user in agent_users:
            user_id = user.get("id")
            user_name = user.get("name", "")

            # Skip self
            if user_id == self.agent_user_id:
                print(f"  - Skipping self: {user_name}")
                continue

            # Check mentions list
            if user_id in mentions:
                print(
                    f"  - MATCH: {user_name} (id={user_id}) is in mentions list!"
                )
                return True

            # Check content for @Name
            if user_name and f"@{user_name}" in content:
                print(f"  - MATCH: @{user_name} found in content!")
                return True

        # Fallback: check for @something pattern that isn't @me
        at_mentions = re.findall(r"@(\S+)", content)
        for mentioned_name in at_mentions:
            if mentioned_name != my_agent_name and mentioned_name:
                # Check if this is a known agent
                known_user = next(
                    (u for u in users if u.get("name") == mentioned_name), None
                )
                if known_user and (
                    known_user.get("type") == "agent" or known_user.get("isLLM")
                ):
                    print(f"  - FALLBACK MATCH: @{mentioned_name} found via regex!")
                    return True
                elif not known_user:
                    # Unknown user mentioned - could be an agent we don't know
                    print(
                        f"  - WARNING: Unknown @{mentioned_name} mentioned, skipping to be safe"
                    )
                    return True

        print(f"  - No other agent mentioned, returning False")
        return False

    def get_agent_user_ids(self, users: List[Dict]) -> Dict[str, str]:
        """
        Get a mapping of agent user IDs to their names.

        Args:
            users: List of user objects

        Returns:
            Dict mapping user ID to agent name
        """
        agent_ids = {}
        for u in users:
            if u.get("type") == "agent" or u.get("isLLM"):
                agent_ids[u["id"]] = u.get("name", "Agent")
        return agent_ids

    def get_all_agent_names(self, users: List[Dict]) -> Set[str]:
        """
        Get all agent names from users list.

        Args:
            users: List of user objects

        Returns:
            Set of agent names
        """
        names = set()
        for u in users:
            if u.get("type") == "agent" or u.get("isLLM"):
                name = u.get("name", "")
                if name:
                    names.add(name)
        return names