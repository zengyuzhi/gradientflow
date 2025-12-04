# -*- coding: utf-8 -*-
"""
Unified Tool Definitions

Single source of truth for all tool definitions.
Different formatters convert these to various formats (Harmony, Text, etc.)
"""
from typing import Dict, List, Any, Optional


# =============================================================================
# Tool Definition Structure
# =============================================================================

"""
Tool definition format:
{
    "name": str,                    # Function name for calling
    "description": str,             # What the tool does
    "parameters": {                 # Parameter definitions
        "param_name": {
            "type": str,            # "string", "number", "boolean", etc.
            "description": str,     # Parameter description
            "optional": bool,       # Default False
            "default": Any,         # Default value (optional)
            "enum": List[str],      # Enum values (optional)
        }
    },
    "enabled_key": str,             # Key in config.tools list
    "category": str,                # "context", "search", "reaction", "mcp"
    "text_format": str,             # Text format template: [TOOL_NAME:param]
    "text_example": str,            # Example usage in text format
    "usage_hint": str,              # When to use this tool
    "important_note": str,          # Important note (optional)
}
"""


# =============================================================================
# Built-in Tool Definitions
# =============================================================================

TOOL_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    # -------------------------------------------------------------------------
    # Context Tools
    # -------------------------------------------------------------------------
    "get_context": {
        "name": "get_context",
        "description": "Get messages around a specific message for context understanding",
        "parameters": {
            "message_id": {
                "type": "string",
                "description": "The ID of the target message (from [msg:xxx] prefix)",
            }
        },
        "enabled_key": "chat.get_context",
        "category": "context",
        "text_format": "[GET_CONTEXT:message_id]",
        "text_example": "[GET_CONTEXT:abc-123-def]",
        "usage_hint": "Use when you need to understand the context of a specific message",
    },

    "get_long_context": {
        "name": "get_long_context",
        "description": "Get the full conversation history for summarization or full context",
        "parameters": {},
        "enabled_key": "chat.get_long_context",
        "category": "context",
        "text_format": "[GET_LONG_CONTEXT]",
        "text_example": "[GET_LONG_CONTEXT]",
        "usage_hint": "Use when you need to summarize or understand the entire conversation",
    },

    # -------------------------------------------------------------------------
    # Search Tools
    # -------------------------------------------------------------------------
    "web_search": {
        "name": "web_search",
        "description": "Search the web for current information. MUST use for: current events, news, sports scores, recent developments, real-time data. DO NOT guess or hallucinate answers about current events - search first!",
        "parameters": {
            "query": {
                "type": "string",
                "description": "Search query",
            }
        },
        "enabled_key": "tools.web_search",
        "category": "search",
        "text_format": "[WEB_SEARCH:query]",
        "text_example": "[WEB_SEARCH:latest news about AI]",
        "usage_hint": "MUST search for: today/current/latest/now, weather, prices, scores, news, events after 2024",
        "important_note": "DO NOT guess or hallucinate answers about current events - search first!",
    },

    "local_rag": {
        "name": "local_rag",
        "description": "Search the knowledge base for documents. MUST use when message has '📎 [附件:' or asks about uploaded files, company policies, rules, procedures. DO NOT guess document contents - search first!",
        "parameters": {
            "query": {
                "type": "string",
                "description": "Search query for knowledge base",
            }
        },
        "enabled_key": "tools.local_rag",
        "category": "search",
        "text_format": "[LOCAL_RAG:query]",
        "text_example": "[LOCAL_RAG:company work hours]",
        "usage_hint": "MUST search when: message contains '📎 [附件:', asks about documents/files/policies/rules",
        "important_note": "DO NOT guess answers about document contents - search first!",
    },

    # -------------------------------------------------------------------------
    # Reaction Tools
    # -------------------------------------------------------------------------
    "react": {
        "name": "react",
        "description": "Add an emoji reaction to a message. Use ONLY reaction (no text reply) for: 'thanks/thank you' → thumbs_up, 'got it/ok/understood' → thumbs_up, 'haha/lol/funny' → laughing, 'great/awesome/nice' → fire or clap, 'love it' → heart. When reacting without text reply, output [SKIP] in the final channel.",
        "parameters": {
            "emoji": {
                "type": "string",
                "description": "Emoji to react with (e.g., thumbs_up, heart, fire, clap, laughing, celebration)",
            },
            "message_id": {
                "type": "string",
                "description": "The ID of the message to react to (from [msg:xxx] prefix)",
            }
        },
        "enabled_key": "capability.like",  # Special: enabled by capability, not tools
        "category": "reaction",
        "text_format": "[REACT:emoji:message_id]",
        "text_example": "[REACT:thumbs_up:abc-123-def]",
        "usage_hint": "React-only scenarios: acknowledgments (thanks, ok, got it), appreciation (great, nice), humor (haha, lol). Output [SKIP] in final channel when no text needed.",
        "important_note": "For simple social responses that don't need explanation, just react and [SKIP] the text reply.",
    },
}


def get_tool_definition(tool_name: str) -> Optional[Dict[str, Any]]:
    """Get a tool definition by name."""
    return TOOL_DEFINITIONS.get(tool_name)


def get_tools_by_category(category: str) -> List[Dict[str, Any]]:
    """Get all tool definitions in a category."""
    return [
        tool for tool in TOOL_DEFINITIONS.values()
        if tool.get("category") == category
    ]


def get_enabled_tools(
    enabled_keys: List[str],
    has_like_capability: bool = False
) -> List[Dict[str, Any]]:
    """
    Get tool definitions that are enabled.

    Args:
        enabled_keys: List of enabled tool keys from config (e.g., ["chat.get_context", "tools.web_search"])
        has_like_capability: Whether the like capability is enabled

    Returns:
        List of enabled tool definitions
    """
    enabled_tools = []

    for tool in TOOL_DEFINITIONS.values():
        enabled_key = tool.get("enabled_key", "")

        # Special handling for reaction tool (capability-based)
        if enabled_key == "capability.like":
            if has_like_capability:
                enabled_tools.append(tool)
        elif enabled_key in enabled_keys:
            enabled_tools.append(tool)

    return enabled_tools


# =============================================================================
# MCP Tool Helper
# =============================================================================

def convert_mcp_tool_to_definition(mcp_tool: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert an MCP tool definition to our internal format.

    Args:
        mcp_tool: MCP tool definition from config

    Returns:
        Tool definition in our internal format
    """
    tool_name = mcp_tool.get("name", "unknown")
    description = mcp_tool.get("description", "No description")
    input_schema = mcp_tool.get("inputSchema", {}) or mcp_tool.get("parameters", {})

    # Convert input schema to our parameter format
    parameters = {}
    properties = input_schema.get("properties", {})
    required_list = input_schema.get("required", [])

    for param_name, param_info in properties.items():
        param_type = param_info.get("type", "string")
        param_desc = param_info.get("description", "")
        is_required = param_name in required_list

        parameters[param_name] = {
            "type": param_type,
            "description": param_desc,
            "optional": not is_required,
        }

    # Build text format example
    if parameters:
        first_param = list(parameters.keys())[0]
        example_args = {first_param: f"<{first_param}>"}
        import json
        text_example = f"[MCP:{tool_name}:{json.dumps(example_args)}]"
    else:
        text_example = f"[MCP:{tool_name}:{{}}]"

    return {
        "name": f"mcp_{tool_name}",
        "original_name": tool_name,  # Keep original name for execution
        "description": f"[MCP] {description}",
        "parameters": parameters,
        "enabled_key": f"mcp.{tool_name}",
        "category": "mcp",
        "text_format": f'[MCP:{tool_name}:{{"...":"..."}}]',
        "text_example": text_example,
        "usage_hint": description,
    }


def get_enabled_mcp_tools(mcp_config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Get enabled MCP tool definitions.

    Args:
        mcp_config: MCP configuration from agent config

    Returns:
        List of MCP tool definitions in our internal format
    """
    enabled_tools = mcp_config.get("enabledTools", [])
    available_tools = mcp_config.get("availableTools", [])

    if not enabled_tools or not available_tools:
        return []

    mcp_tools = []
    for tool in available_tools:
        tool_name = tool.get("name", "")
        if tool_name in enabled_tools:
            mcp_tools.append(convert_mcp_tool_to_definition(tool))

    return mcp_tools