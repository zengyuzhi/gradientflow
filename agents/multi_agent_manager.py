# -*- coding: utf-8 -*-
"""
Multi-Agent Manager

Manages multiple AI agents running concurrently in the group chat.
Each agent runs in its own thread with independent state and configuration.
"""
import time
import threading
import requests
from typing import Dict, List, Optional

from core import API_BASE, AGENT_TOKEN


def get_agent_service_class():
    """Get the AgentService class."""
    from agent_service import AgentService
    return AgentService


# Agent sync interval for hot-reload
AGENT_SYNC_INTERVAL = 3  # seconds


class MultiAgentManager:
    """
    Manages multiple agent instances running concurrently.

    Features:
    - Start/stop individual agents
    - Auto-start all active agents
    - Hot-reload: automatically detect and start new agents
    - Auto-stop deactivated or deleted agents

    Usage:
        manager = MultiAgentManager()
        manager.login("root@example.com", "password")
        manager.start_all_agents()  # Start all active agents from config
        # or
        manager.start_agent("agent-id-1")  # Start specific agent
    """

    def __init__(
        self,
        api_base: str = API_BASE,
        agent_token: str = AGENT_TOKEN,
        auto_sync: bool = True,
    ):
        """
        Initialize the multi-agent manager.

        Args:
            api_base: Backend API base URL
            agent_token: Agent authentication token
            auto_sync: Enable automatic agent sync (hot-reload)
        """
        self.api_base = api_base
        self.agent_token = agent_token
        self.jwt_token: Optional[str] = None
        self.auto_sync = auto_sync

        # Credentials for starting new agents
        self._login_email: Optional[str] = None
        self._login_password: Optional[str] = None

        # Get the service class
        self._agent_service_class = get_agent_service_class()

        # Track running agents
        self._agents: Dict[str, object] = {}  # agent_id -> AgentService instance
        self._agent_threads: Dict[str, threading.Thread] = {}
        self._running = False

        # Track known agent configs for change detection
        self._known_agent_configs: Dict[str, Dict] = {}

        # Shared HTTP session for manager-level operations
        self._session = requests.Session()

        print("[Manager] Initialized (auto_sync=%s)" % auto_sync)

    def login(self, email: str, password: str) -> bool:
        """Login to get JWT token for fetching agent configs."""
        try:
            resp = self._session.post(
                f"{self.api_base}/auth/login",
                json={"email": email, "password": password},
                timeout=10,
            )
            if resp.status_code == 200:
                token = resp.cookies.get("token")
                if token:
                    self.jwt_token = token
                    # Store credentials for starting new agents later
                    self._login_email = email
                    self._login_password = password
                    print("[Manager] Login successful")
                    return True
            print(f"[Manager] Login failed: {resp.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[Manager] Login error: {e}")
            return False

    def fetch_all_agents(self) -> List[Dict]:
        """Fetch all agent configurations from backend."""
        if not self.jwt_token:
            print("[Manager] Not logged in")
            return []

        try:
            resp = self._session.get(
                f"{self.api_base}/agents",
                headers={"Authorization": f"Bearer {self.jwt_token}"},
                timeout=10,
            )
            if resp.status_code == 200:
                agents = resp.json().get("agents", [])
                print(f"[Manager] Found {len(agents)} agents")
                return agents
            print(f"[Manager] Failed to fetch agents: {resp.status_code}")
            return []
        except requests.RequestException as e:
            print(f"[Manager] Error fetching agents: {e}")
            return []

    def start_agent(
        self, agent_id: str, email: str = None, password: str = None
    ) -> bool:
        """Start a single agent by ID."""
        if agent_id in self._agents:
            print(f"[Manager] Agent {agent_id} is already running")
            return False

        # Create agent service instance
        agent = self._agent_service_class(
            api_base=self.api_base,
            agent_token=self.agent_token,
            agent_id=agent_id,
        )

        # Each agent needs its own session with JWT token
        if email and password:
            if not agent.login(email, password):
                print(f"[Manager] Agent {agent_id} login failed")
                return False
        elif self.jwt_token:
            agent.jwt_token = self.jwt_token
        else:
            print(f"[Manager] Agent {agent_id} has no auth credentials")
            return False

        # Fetch agent's config
        config = agent.fetch_agent_config()
        if not config:
            print(f"[Manager] Could not load config for agent {agent_id}")
            return False

        # Check if agent is active
        if config.get("status") == "inactive":
            print(f"[Manager] Agent {agent_id} is inactive, skipping")
            return False

        # Start agent in a separate thread
        def run_agent():
            try:
                agent.run()
            except Exception as e:
                import traceback
                print(f"[Manager] Agent {agent_id} crashed: {e}")
                traceback.print_exc()

        thread = threading.Thread(target=run_agent, daemon=True, name=f"Agent-{agent_id}")
        thread.start()

        self._agents[agent_id] = agent
        self._agent_threads[agent_id] = thread
        print(f"[Manager] Started agent: {agent_id} ({config.get('name')})")
        return True

    def stop_agent(self, agent_id: str) -> bool:
        """Stop a running agent."""
        if agent_id not in self._agents:
            print(f"[Manager] Agent {agent_id} is not running")
            return False

        agent = self._agents[agent_id]
        agent._running = False

        del self._agents[agent_id]
        if agent_id in self._agent_threads:
            del self._agent_threads[agent_id]

        print(f"[Manager] Stopped agent: {agent_id}")
        return True

    def start_all_agents(self) -> int:
        """Start all active agents from configuration."""
        agents = self.fetch_all_agents()
        started = 0

        for agent_config in agents:
            agent_id = agent_config.get("id")
            if not agent_id:
                continue

            if agent_config.get("status") == "inactive":
                print(f"[Manager] Skipping inactive agent: {agent_id}")
                continue

            if self.start_agent(agent_id):
                started += 1

        print(f"[Manager] Started {started}/{len(agents)} agents")
        return started

    def stop_all_agents(self):
        """Stop all running agents."""
        agent_ids = list(self._agents.keys())
        for agent_id in agent_ids:
            self.stop_agent(agent_id)
        print("[Manager] All agents stopped")

    def list_running_agents(self) -> List[str]:
        """Get list of running agent IDs."""
        return list(self._agents.keys())

    def get_agent_status(self) -> Dict[str, Dict]:
        """Get status of all agents."""
        status = {}
        for agent_id, agent in self._agents.items():
            thread = self._agent_threads.get(agent_id)
            status[agent_id] = {
                "id": agent_id,
                "name": agent.agent_config.get("name") if agent.agent_config else "Unknown",
                "running": thread.is_alive() if thread else False,
                "processed_messages": len(agent.processed_message_ids),
            }
        return status

    def sync_agents(self) -> Dict[str, int]:
        """
        Sync running agents with backend configuration.

        This method enables hot-reload:
        - Starts newly added agents
        - Stops deactivated or deleted agents

        Returns:
            Dict with counts: {"started": N, "stopped": N}
        """
        if not self._login_email or not self._login_password:
            print("[Manager] Cannot sync: no login credentials stored")
            return {"started": 0, "stopped": 0}

        agents = self.fetch_all_agents()
        if not agents:
            return {"started": 0, "stopped": 0}

        started = 0
        stopped = 0

        # Build set of active agent IDs from backend
        active_agent_ids = set()
        for agent_config in agents:
            agent_id = agent_config.get("id")
            if not agent_id:
                continue
            if agent_config.get("status") != "inactive":
                active_agent_ids.add(agent_id)

        # Start new agents (in backend but not running)
        for agent_config in agents:
            agent_id = agent_config.get("id")
            if not agent_id:
                continue

            # Skip inactive agents
            if agent_config.get("status") == "inactive":
                continue

            # Skip already running agents
            if agent_id in self._agents:
                continue

            # New agent detected - start it
            print(f"[Manager] Hot-reload: detected new agent '{agent_config.get('name', agent_id)}'")
            if self.start_agent(agent_id, self._login_email, self._login_password):
                started += 1

        # Stop agents that are no longer active (deactivated or deleted)
        running_agent_ids = list(self._agents.keys())
        for agent_id in running_agent_ids:
            if agent_id not in active_agent_ids:
                agent = self._agents.get(agent_id)
                agent_name = agent.agent_config.get("name", agent_id) if agent and agent.agent_config else agent_id
                print(f"[Manager] Hot-reload: stopping deactivated/deleted agent '{agent_name}'")
                self.stop_agent(agent_id)
                stopped += 1

        if started > 0 or stopped > 0:
            print(f"[Manager] Sync complete: started={started}, stopped={stopped}")

        return {"started": started, "stopped": stopped}

    def run_forever(self):
        """Run the manager, keeping all agents alive."""
        self._running = True
        last_sync_time = time.time()

        if self.auto_sync:
            print(f"[Manager] Running with hot-reload (sync every {AGENT_SYNC_INTERVAL}s)... Press Ctrl+C to stop")
        else:
            print("[Manager] Running... Press Ctrl+C to stop")

        try:
            while self._running:
                # Check agent health and restart if needed
                for agent_id, thread in list(self._agent_threads.items()):
                    if not thread.is_alive():
                        print(f"[Manager] Agent {agent_id} thread died, restarting...")
                        del self._agents[agent_id]
                        del self._agent_threads[agent_id]
                        self.start_agent(agent_id, self._login_email, self._login_password)

                # Periodic sync for hot-reload
                if self.auto_sync:
                    now = time.time()
                    if now - last_sync_time >= AGENT_SYNC_INTERVAL:
                        self.sync_agents()
                        last_sync_time = now

                time.sleep(5)  # Check every 5 seconds
        except KeyboardInterrupt:
            print("\n[Manager] Shutting down...")
            self.stop_all_agents()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Multi-Agent Manager")
    parser.add_argument("--email", default="root@example.com", help="Login email")
    parser.add_argument("--password", default="1234567890", help="Login password")
    parser.add_argument(
        "--agent-ids",
        nargs="*",
        help="Specific agent IDs to start (default: all active)",
    )
    parser.add_argument(
        "--no-auto-sync",
        action="store_true",
        help="Disable automatic agent sync (hot-reload)",
    )
    args = parser.parse_args()

    print("=" * 50)
    print("Multi-Agent Manager")
    print("=" * 50)

    manager = MultiAgentManager(auto_sync=not args.no_auto_sync)

    if manager.login(args.email, args.password):
        if args.agent_ids:
            for agent_id in args.agent_ids:
                manager.start_agent(agent_id, args.email, args.password)
        else:
            manager.start_all_agents()

        manager.run_forever()
    else:
        print("[Manager] Failed to login")