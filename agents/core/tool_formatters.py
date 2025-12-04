# -*- coding: utf-8 -*-
"""
Tool Formatters

Convert unified tool definitions to different prompt formats:
- Harmony format (GPT-OSS TypeScript namespace style)
- Text format (Standard [TOOL:args] style)
"""
from typing import List, Dict, Any

from .harmony_parser import HarmonyPromptBuilder
from .tool_definitions import (
    get_enabled_tools,
    get_enabled_mcp_tools,
    TOOL_DEFINITIONS,
)


# =============================================================================
# Harmony Format (GPT-OSS)
# =============================================================================

def add_tools_to_harmony_builder(
    builder: HarmonyPromptBuilder,
    enabled_keys: List[str],
    has_like_capability: bool = False,
    mcp_config: Dict[str, Any] = None,
) -> None:
    """
    Add tool definitions to a HarmonyPromptBuilder.

    Args:
        builder: HarmonyPromptBuilder instance
        enabled_keys: List of enabled tool keys from config
        has_like_capability: Whether the like capability is enabled
        mcp_config: MCP configuration (optional)
    """
    # Add built-in tools
    enabled_tools = get_enabled_tools(enabled_keys, has_like_capability)

    for tool in enabled_tools:
        # Combine description with important_note for Harmony format
        description = tool["description"]
        important_note = tool.get("important_note", "")
        if important_note:
            description = f"{description} {important_note}"

        builder.add_function(
            name=tool["name"],
            description=description,
            parameters=tool.get("parameters", {}),
        )

    # Add MCP tools
    if mcp_config:
        mcp_tools = get_enabled_mcp_tools(mcp_config)
        for tool in mcp_tools:
            builder.add_function(
                name=tool["name"],
                description=tool["description"],
                parameters=tool.get("parameters", {}),
            )


# =============================================================================
# Text Format (Standard)
# =============================================================================

def format_tool_as_text(tool: Dict[str, Any], tool_num: int) -> str:
    """
    Format a single tool definition as text documentation.

    Args:
        tool: Tool definition
        tool_num: Tool number for display

    Returns:
        Formatted tool documentation string
    """
    name = tool.get("name", "unknown")
    description = tool.get("description", "")
    text_format = tool.get("text_format", "")
    text_example = tool.get("text_example", "")
    usage_hint = tool.get("usage_hint", "")
    important_note = tool.get("important_note", "")

    # Build human-readable name
    display_name = name.replace("_", " ").title()

    lines = [f"{tool_num}. **{display_name}** - {description.split('.')[0]}:"]
    lines.append(f"   Format: {text_format}")

    if text_example:
        lines.append(f"   Example: {text_example}")

    if usage_hint:
        lines.append(f"   {usage_hint}")

    if important_note:
        lines.append(f"   **IMPORTANT**: {important_note}")

    return "\n".join(lines)


def format_mcp_tool_as_text(tool: Dict[str, Any]) -> str:
    """
    Format an MCP tool definition as text documentation.

    Args:
        tool: MCP tool definition

    Returns:
        Formatted MCP tool documentation string
    """
    import json

    original_name = tool.get("original_name", tool.get("name", "unknown"))
    description = tool.get("description", "").replace("[MCP] ", "")
    parameters = tool.get("parameters", {})

    lines = [f"**{original_name}** - {description}"]

    if parameters:
        lines.append("   Parameters:")
        for param_name, param_info in parameters.items():
            param_type = param_info.get("type", "any")
            param_desc = param_info.get("description", "")
            is_optional = param_info.get("optional", False)
            req_mark = "" if is_optional else " (required)"
            line = f"   - {param_name}: {param_type}{req_mark}"
            if param_desc:
                line += f" - {param_desc}"
            lines.append(line)

    # Build example
    example_args = {}
    for param_name, param_info in parameters.items():
        if not param_info.get("optional", False):
            param_type = param_info.get("type", "string")
            if param_type == "string":
                example_args[param_name] = f"your {param_name} here"
            elif param_type == "integer" or param_type == "number":
                example_args[param_name] = 5
            else:
                example_args[param_name] = f"<{param_name}>"

    if not example_args:
        example_args = {"query": "your search query"}

    example_json = json.dumps(example_args, ensure_ascii=False)
    lines.append(f"   Format: [MCP:{original_name}:{example_json}]")

    return "\n".join(lines)


def build_tools_text_prompt(
    enabled_keys: List[str],
    has_like_capability: bool = False,
) -> str:
    """
    Build text format tool documentation for system prompt.

    Args:
        enabled_keys: List of enabled tool keys from config
        has_like_capability: Whether the like capability is enabled

    Returns:
        Tool documentation string in text format
    """
    enabled_tools = get_enabled_tools(enabled_keys, has_like_capability)

    # Filter out reaction tool (handled separately in mode prompts)
    context_search_tools = [
        t for t in enabled_tools
        if t.get("category") in ("context", "search")
    ]

    if not context_search_tools:
        return ""

    sections = []
    for i, tool in enumerate(context_search_tools, 1):
        sections.append(format_tool_as_text(tool, i))

    return (
        "\n\n## Context Tools\n"
        "If you need more context to answer properly, you can use these tools:\n\n"
        + "\n\n".join(sections)
        + "\n\n**Tool Usage Rules:**\n"
        "- If you use these tools, they will be executed and results will be provided.\n"
        "- You can then provide a more informed response based on the tool results.\n"
    )


def build_mcp_text_prompt(mcp_config: Dict[str, Any]) -> str:
    """
    Build text format MCP tool documentation for system prompt.

    Args:
        mcp_config: MCP configuration from agent config

    Returns:
        MCP tool documentation string in text format
    """
    mcp_tools = get_enabled_mcp_tools(mcp_config)

    if not mcp_tools:
        return ""

    sections = []
    for tool in mcp_tools:
        sections.append(format_mcp_tool_as_text(tool))

    return (
        "\n\n## MCP External Tools\n"
        "You have access to the following external tools from MCP server:\n\n"
        + "\n\n".join(sections)
        + "\n\n**MCP Tool Usage:**\n"
        '- Use the exact format: [MCP:tool_name:{"arguments": "in JSON"}]\n'
        "- Results will be returned and you can use them to answer the user.\n"
    )


def build_reaction_text_prompt() -> str:
    """
    Build reaction tool text documentation.

    Returns:
        Reaction tool documentation string
    """
    react_tool = TOOL_DEFINITIONS.get("react", {})
    text_format = react_tool.get("text_format", "[REACT:emoji:message_id]")
    usage_hint = react_tool.get("usage_hint", "")

    return (
        "\n\n## Tools Available\n"
        f"You have access to a reaction tool. Format: {text_format}\n"
        "- emoji: Any emoji like thumbs_up, heart, laughing, fire, clap, etc.\n"
        "- message_id: Copy the exact id from [msg:xxx] prefix in messages\n\n"
        "Examples:\n"
        "- [REACT:thumbs_up:abc-123-def] - react to message with id abc-123-def\n"
        "- [REACT:heart:xyz-789] - react to message with id xyz-789\n\n"
        "Rules:\n"
        f"- {usage_hint}\n"
        "- You can combine reaction with text reply if needed\n"
        "- IMPORTANT: Use the exact message_id from [msg:xxx], not 'current'"
    )