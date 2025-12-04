# -*- coding: utf-8 -*-
"""
Unified Configuration Constants

All configuration constants for the agent services.
"""

# Logging Configuration
LOG_TRUNCATE = False  # Set to True to truncate long content in logs
LOG_MAX_LENGTH = 200  # Max characters when LOG_TRUNCATE is True

# API Configuration
API_BASE = "http://localhost:4000"
AGENT_TOKEN = "dev-agent-token"

# Default Agent Settings
DEFAULT_AGENT_ID = "helper-agent-1"
DEFAULT_AGENT_USER_ID = "llm1"

# Polling and Heartbeat
POLL_INTERVAL = 1  # seconds
HEARTBEAT_INTERVAL = 5  # seconds

# Proactive Mode
DEFAULT_PROACTIVE_COOLDOWN = 30  # seconds between proactive responses

# Conversation
CONVERSATION_ID = "global"
CONTEXT_LIMIT = 10  # number of messages in context

# Timeouts
REQUEST_TIMEOUT = 10  # seconds for HTTP requests
LLM_TIMEOUT = 30  # seconds for LLM calls

# LLM Provider Defaults
DEFAULT_LLM_BASE_URL = "https://7fjm4igmx7zj7f-3005.proxy.runpod.net/v1"
DEFAULT_LLM_MODEL = "default"
DEFAULT_LLM_API_KEY = "not-needed"
