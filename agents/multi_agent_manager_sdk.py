# -*- coding: utf-8 -*-
"""
Multi-Agent Manager (SDK Version)

Manages multiple AI agents running concurrently using the OpenAI Agents SDK.
Each agent runs in its own thread with independent state and configuration.
"""
import time
import threading
import requests
from typing import Dict, List, Optional
from agent_service_sdk import AgentServiceSDK, API_BASE, AGENT_TOKEN, POLL_INTERVAL


class MultiAgentManagerSDK:
    """
    Manages multiple SDK-based agent instances running concurrently.

    Usage:
        manager = MultiAgentManagerSDK()
        manager.login("root@example.com", "password")
        manager.start_all_agents()  # Start all active agents from config
    """

    def __init__(
        self,
        api_base: str = API_BASE,
        agent_token: str = AGENT_TOKEN,
    ):
        self.api_base = api_base
        self.agent_token = agent_token
        self.jwt_token: Optional[str] = None

        # Track running agents
        self._agents: Dict[str, AgentServiceSDK] = {}
        self._agent_threads: Dict[str, threading.Thread] = {}
        self._running = False

        # Shared HTTP session for manager-level operations
        self._session = requests.Session()

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
                    print("[Manager SDK] Login successful")
                    return True
            print(f"[Manager SDK] Login failed: {resp.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[Manager SDK] Login error: {e}")
            return False

    def fetch_all_agents(self) -> List[Dict]:
        """Fetch all agent configurations from backend."""
        if not self.jwt_token:
            print("[Manager SDK] Not logged in")
            return []

        try:
            resp = self._session.get(
                f"{self.api_base}/agents",
                headers={"Authorization": f"Bearer {self.jwt_token}"},
                timeout=10,
            )
            if resp.status_code == 200:
                agents = resp.json().get("agents", [])
                print(f"[Manager SDK] Found {len(agents)} agents")
                return agents
            print(f"[Manager SDK] Failed to fetch agents: {resp.status_code}")
            return []
        except requests.RequestException as e:
            print(f"[Manager SDK] Error fetching agents: {e}")
            return []

    def start_agent(self, agent_id: str, email: str = None, password: str = None) -> bool:
        """Start a single agent by ID using SDK service."""
        if agent_id in self._agents:
            print(f"[Manager SDK] Agent {agent_id} is already running")
            return False

        # Create SDK-based agent service instance
        agent = AgentServiceSDK(
            api_base=self.api_base,
            agent_token=self.agent_token,
            agent_id=agent_id,
        )

        # Each agent needs its own session with JWT token
        if email and password:
            if not agent.login(email, password):
                print(f"[Manager SDK] Agent {agent_id} login failed")
                return False
        elif self.jwt_token:
            agent.jwt_token = self.jwt_token
        else:
            print(f"[Manager SDK] Agent {agent_id} has no auth credentials")
            return False

        # Fetch agent's config (this also initializes SDK components)
        config = agent.fetch_agent_config()
        if not config:
            print(f"[Manager SDK] Could not load config for agent {agent_id}")
            return False

        # Check if agent is active
        if config.get("status") == "inactive":
            print(f"[Manager SDK] Agent {agent_id} is inactive, skipping")
            return False

        # Start agent in a separate thread
        def run_agent():
            try:
                agent.run()
            except Exception as e:
                import traceback
                print(f"[Manager SDK] Agent {agent_id} crashed: {e}")
                traceback.print_exc()

        thread = threading.Thread(target=run_agent, daemon=True, name=f"AgentSDK-{agent_id}")
        thread.start()

        self._agents[agent_id] = agent
        self._agent_threads[agent_id] = thread
        print(f"[Manager SDK] Started agent: {agent_id} ({config.get('name')})")
        return True

    def stop_agent(self, agent_id: str) -> bool:
        """Stop a running agent."""
        if agent_id not in self._agents:
            print(f"[Manager SDK] Agent {agent_id} is not running")
            return False

        agent = self._agents[agent_id]
        agent._running = False

        del self._agents[agent_id]
        if agent_id in self._agent_threads:
            del self._agent_threads[agent_id]

        print(f"[Manager SDK] Stopped agent: {agent_id}")
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
                print(f"[Manager SDK] Skipping inactive agent: {agent_id}")
                continue

            if self.start_agent(agent_id):
                started += 1

        print(f"[Manager SDK] Started {started}/{len(agents)} agents")
        return started

    def stop_all_agents(self):
        """Stop all running agents."""
        agent_ids = list(self._agents.keys())
        for agent_id in agent_ids:
            self.stop_agent(agent_id)
        print("[Manager SDK] All agents stopped")

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
                "sdk_version": True,  # Indicates this is using SDK
            }
        return status

    def run_forever(self):
        """Run the manager, keeping all agents alive."""
        self._running = True
        print("[Manager SDK] Running... Press Ctrl+C to stop")

        try:
            while self._running:
                # Check agent health and restart if needed
                for agent_id, thread in list(self._agent_threads.items()):
                    if not thread.is_alive():
                        print(f"[Manager SDK] Agent {agent_id} thread died, restarting...")
                        del self._agents[agent_id]
                        del self._agent_threads[agent_id]
                        self.start_agent(agent_id)

                time.sleep(5)
        except KeyboardInterrupt:
            print("\n[Manager SDK] Shutting down...")
            self.stop_all_agents()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Multi-Agent Manager (SDK Version)")
    parser.add_argument("--email", default="root@example.com", help="Login email")
    parser.add_argument("--password", default="1234567890", help="Login password")
    parser.add_argument("--agent-ids", nargs="*", help="Specific agent IDs to start (default: all active)")
    args = parser.parse_args()

    print("=" * 50)
    print("Multi-Agent Manager - OpenAI Agents SDK Version")
    print("=" * 50)

    manager = MultiAgentManagerSDK()

    if manager.login(args.email, args.password):
        if args.agent_ids:
            for agent_id in args.agent_ids:
                manager.start_agent(agent_id)
        else:
            manager.start_all_agents()

        manager.run_forever()
    else:
        print("[Manager SDK] Failed to login")
