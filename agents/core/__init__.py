# -*- coding: utf-8 -*-
"""
Core modules for Agent Service

This package contains shared utilities and base classes:
- config: Unified configuration constants
- response_cleaner: Response cleaning and regex patterns
- api_client: HTTP API wrapper for backend communication
- mention_detector: @ mention detection logic
- harmony_parser: GPT-OSS harmony format parser and builder
- tool_definitions: Unified tool definitions (single source of truth)
- tool_formatters: Convert tool definitions to different prompt formats
- llm_client: OpenAI-compatible LLM client wrapper
- tool_executor: Tool execution and parsing utilities
"""

from .config import (
    # Logging
    LOG_TRUNCATE,
    LOG_MAX_LENGTH,
    # API
    API_BASE,
    AGENT_TOKEN,
    AGENT_LOGIN_EMAIL,
    AGENT_LOGIN_PASSWORD,
    DEFAULT_AGENT_ID,
    DEFAULT_AGENT_USER_ID,
    POLL_INTERVAL,
    HEARTBEAT_INTERVAL,
    DEFAULT_PROACTIVE_COOLDOWN,
    DEFAULT_MAX_TOOL_ROUNDS,
    CONVERSATION_ID,
    CONTEXT_LIMIT,
    REQUEST_TIMEOUT,
    LLM_TIMEOUT,
)

from .response_cleaner import (
    log_text,
    strip_special_tags,
    extract_final_response,
    RE_MENTION,
    RE_REACT_TOOL,
)

from .api_client import AgentAPIClient

from .mention_detector import MentionDetector

from .harmony_parser import (
    # Response parsing
    HarmonyResponse,
    parse_harmony_response,
    clean_harmony_response,
    extract_final_answer,
    # Prompt building
    HarmonyPromptBuilder,
    create_chat_prompt_builder,
    # Tool result building
    build_tool_result_message,
    build_multi_tool_results,
    # Predefined tools (legacy, use tool_definitions instead)
    CHAT_TOOLS,
    get_tool_definition,
)

from .tool_definitions import (
    TOOL_DEFINITIONS,
    get_tool_definition as get_unified_tool_definition,
    get_tools_by_category,
    get_enabled_tools,
    get_enabled_mcp_tools,
    convert_mcp_tool_to_definition,
)

from .tool_formatters import (
    add_tools_to_harmony_builder,
    build_tools_text_prompt,
    build_mcp_text_prompt,
    build_reaction_text_prompt,
)

from .llm_client import (
    configure as configure_llm,
    get_client as get_llm_client,
    chat,
    chat_with_history,
)

from .tool_executor import (
    AgentTools,
    parse_tool_calls,
    remove_tool_calls,
)

__all__ = [
    # Logging
    "LOG_TRUNCATE",
    "LOG_MAX_LENGTH",
    # Config
    "API_BASE",
    "AGENT_TOKEN",
    "AGENT_LOGIN_EMAIL",
    "AGENT_LOGIN_PASSWORD",
    "DEFAULT_AGENT_ID",
    "DEFAULT_AGENT_USER_ID",
    "POLL_INTERVAL",
    "HEARTBEAT_INTERVAL",
    "DEFAULT_PROACTIVE_COOLDOWN",
    "DEFAULT_MAX_TOOL_ROUNDS",
    "CONVERSATION_ID",
    "CONTEXT_LIMIT",
    "REQUEST_TIMEOUT",
    "LLM_TIMEOUT",
    # Response cleaner
    "log_text",
    "strip_special_tags",
    "extract_final_response",
    "RE_MENTION",
    "RE_REACT_TOOL",
    # API Client
    "AgentAPIClient",
    # Mention detector
    "MentionDetector",
    # Harmony parser (GPT-OSS)
    "HarmonyResponse",
    "parse_harmony_response",
    "clean_harmony_response",
    "extract_final_answer",
    "HarmonyPromptBuilder",
    "create_chat_prompt_builder",
    "build_tool_result_message",
    "build_multi_tool_results",
    "CHAT_TOOLS",
    "get_tool_definition",
    # Unified tool definitions
    "TOOL_DEFINITIONS",
    "get_unified_tool_definition",
    "get_tools_by_category",
    "get_enabled_tools",
    "get_enabled_mcp_tools",
    "convert_mcp_tool_to_definition",
    # Tool formatters
    "add_tools_to_harmony_builder",
    "build_tools_text_prompt",
    "build_mcp_text_prompt",
    "build_reaction_text_prompt",
    # LLM client
    "configure_llm",
    "get_llm_client",
    "chat",
    "chat_with_history",
    # Tool executor
    "AgentTools",
    "parse_tool_calls",
    "remove_tool_calls",
]
