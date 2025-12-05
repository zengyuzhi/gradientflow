# -*- coding: utf-8 -*-
"""
Agent Service Runner for Railway Deployment

Runs the multi-agent manager with a health check endpoint.
"""
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

from multi_agent_manager import MultiAgentManager
from core import API_BASE, AGENT_TOKEN, AGENT_LOGIN_EMAIL, AGENT_LOGIN_PASSWORD

# Health check state
health_state = {
    "status": "starting",
    "agents_running": 0,
    "manager": None
}


class HealthHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler for health checks."""

    def do_GET(self):
        if self.path == "/health":
            # Get current agent count
            agents_running = 0
            if health_state["manager"]:
                agents_running = len(health_state["manager"].list_running_agents())

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": health_state["status"],
                "service": "agent-manager",
                "agents_running": agents_running,
                "api_base": API_BASE,
            }).encode())
        elif self.path == "/status":
            # Detailed status endpoint
            status = {}
            if health_state["manager"]:
                status = health_state["manager"].get_agent_status()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": health_state["status"],
                "agents": status,
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def run_health_server(port: int):
    """Run the health check HTTP server."""
    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    print(f"[Health] Server running on port {port}")
    server.serve_forever()


def main():
    # Get port from environment (Railway sets this)
    port = int(os.environ.get("PORT", 8080))

    print("=" * 60)
    print("Agent Service - Railway Deployment")
    print("=" * 60)
    print(f"API_BASE: {API_BASE}")
    print(f"AGENT_LOGIN_EMAIL: {AGENT_LOGIN_EMAIL}")
    print(f"Health check port: {port}")
    print("=" * 60)

    # Start health check server in background
    health_thread = threading.Thread(target=run_health_server, args=(port,), daemon=True)
    health_thread.start()

    # Initialize manager
    manager = MultiAgentManager(
        api_base=API_BASE,
        agent_token=AGENT_TOKEN,
        auto_sync=True
    )
    health_state["manager"] = manager

    # Login
    if not manager.login(AGENT_LOGIN_EMAIL, AGENT_LOGIN_PASSWORD):
        print("[ERROR] Failed to login. Check credentials and API_BASE.")
        health_state["status"] = "login_failed"
        # Keep running for health checks to report error
        import time
        while True:
            time.sleep(60)

    health_state["status"] = "running"

    # Start all active agents
    started = manager.start_all_agents()
    health_state["agents_running"] = started

    print(f"[Manager] Started {started} agents")

    # Run forever with sync
    try:
        manager.run_forever()
    except KeyboardInterrupt:
        print("\n[Manager] Shutting down...")
        manager.stop_all_agents()


if __name__ == "__main__":
    main()
