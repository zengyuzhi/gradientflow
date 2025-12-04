# -*- coding: utf-8 -*-
"""
GPT-OSS Harmony Format Parser

Parses and generates harmony format messages for gpt-oss models.
See GPT_OSS_FUNCTION_CALLING.md for format specification.
"""
import re
import json
from datetime import datetime
from typing import Optional, Dict, List, Any, Tuple


# ============================================================================
# Harmony Format Constants
# ============================================================================

REASONING_LEVELS = ("low", "medium", "high")
DEFAULT_REASONING = "low"

# ============================================================================
# Harmony Response Parsing Patterns
# ============================================================================

# Channel patterns
RE_CHANNEL_ANALYSIS = re.compile(
    r'<\|channel\|>analysis<\|message\|>(.*?)(?:<\|end\|>|<\|call\|>|<\|return\|>|$)',
    re.DOTALL
)
RE_CHANNEL_FINAL = re.compile(
    r'<\|channel\|>final<\|message\|>(.*?)(?:<\|return\|>|<\|end\|>|$)',
    re.DOTALL
)

# Function call pattern: to=functions.xxx <|constrain|>json<|message|>{...}
# Note: Use non-greedy match up to <|call|> or <|end|> to handle nested JSON
RE_FUNCTION_CALL = re.compile(
    r'to=functions\.(\w+)\s*(?:<\|constrain\|>[^<]*)?<\|message\|>(\{.*?\})(?:<\|call\|>|<\|end\|>)',
    re.DOTALL
)

# Alternative pattern: some models output without <|constrain|>
# Match JSON until we hit a harmony token
RE_FUNCTION_CALL_ALT = re.compile(
    r'commentary\s+to=functions\.(\w+)[^<]*<\|message\|>(\{.*?\})(?=<\||$)',
    re.DOTALL
)

# Pattern to extract all special tokens for cleaning
RE_HARMONY_TOKENS = re.compile(
    r'<\|(?:start|end|channel|message|constrain|call|return)\|>',
    re.IGNORECASE
)

# Pattern to match entire analysis block (for removal)
# Must match truncated responses that end without proper closing tokens
RE_ANALYSIS_BLOCK = re.compile(
    r'<\|channel\|>analysis<\|message\|>.*?(?:<\|end\|>|<\|start\|>|<\|channel\|>|$)',
    re.DOTALL
)

# Pattern to match entire commentary block with function calls (for removal)
# Must match truncated responses that end without proper closing tokens
RE_COMMENTARY_BLOCK = re.compile(
    r'<\|channel\|>commentary[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>.*?(?:<\|call\|>|<\|end\|>|<\|start\|>|<\|channel\|>|$)',
    re.DOTALL
)

# Pattern to match <|start|>assistant or similar
RE_START_BLOCK = re.compile(
    r'<\|start\|>\w*',
    re.IGNORECASE
)


# ============================================================================
# Harmony Response Parser
# ============================================================================

class HarmonyResponse:
    """Parsed harmony format response."""

    def __init__(self):
        self.thinking: Optional[str] = None  # analysis channel content
        self.function_calls: List[Dict[str, Any]] = []  # list of {name, arguments}
        self.final_answer: Optional[str] = None  # final channel content
        self.raw_response: str = ""

    def has_function_calls(self) -> bool:
        """Check if response contains function calls."""
        return len(self.function_calls) > 0

    def has_final_answer(self) -> bool:
        """Check if response contains a final answer."""
        return self.final_answer is not None and len(self.final_answer.strip()) > 0

    def __repr__(self):
        return (
            f"HarmonyResponse("
            f"thinking={self.thinking[:50] if self.thinking else None}..., "
            f"function_calls={self.function_calls}, "
            f"final_answer={self.final_answer[:50] if self.final_answer else None}...)"
        )


def _extract_json_from_position(content: str, start: int) -> Optional[str]:
    """
    Extract a complete JSON object starting from a given position.
    Handles nested braces correctly.

    Args:
        content: The string containing JSON
        start: Starting position (should be at '{')

    Returns:
        The complete JSON string or None if invalid
    """
    if start >= len(content) or content[start] != '{':
        return None

    depth = 0
    in_string = False
    escape_next = False

    for i in range(start, len(content)):
        char = content[i]

        if escape_next:
            escape_next = False
            continue

        if char == '\\' and in_string:
            escape_next = True
            continue

        if char == '"' and not escape_next:
            in_string = not in_string
            continue

        if in_string:
            continue

        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                return content[start:i + 1]

    return None


def parse_harmony_response(content: str) -> HarmonyResponse:
    """
    Parse a gpt-oss harmony format response.

    Args:
        content: Raw response content from the model

    Returns:
        HarmonyResponse with parsed components
    """
    result = HarmonyResponse()
    result.raw_response = content

    # Extract thinking (analysis channel)
    analysis_match = RE_CHANNEL_ANALYSIS.search(content)
    if analysis_match:
        result.thinking = analysis_match.group(1).strip()

    # Extract function calls with proper JSON parsing
    # Pattern to find function call start positions
    func_start_pattern = re.compile(
        r'to=functions\.(\w+)\s*(?:<\|constrain\|>[^<]*)?<\|message\|>',
        re.DOTALL
    )

    for match in func_start_pattern.finditer(content):
        func_name = match.group(1)
        json_start = match.end()

        # Extract complete JSON using brace counting
        args_json = _extract_json_from_position(content, json_start)

        if args_json:
            try:
                arguments = json.loads(args_json)
                result.function_calls.append({
                    "name": func_name,
                    "arguments": arguments
                })
            except json.JSONDecodeError:
                # Store raw if JSON parsing fails
                result.function_calls.append({
                    "name": func_name,
                    "arguments": {"raw": args_json}
                })

    # Extract final answer
    final_match = RE_CHANNEL_FINAL.search(content)
    if final_match:
        result.final_answer = final_match.group(1).strip()
    else:
        # If no explicit final channel, try to extract clean text after removing harmony tokens
        # This handles cases where model outputs plain text mixed with harmony
        cleaned = clean_harmony_response(content)
        if cleaned:
            # Set final_answer even if there are function calls
            # (model might output both function calls and text)
            result.final_answer = cleaned

    return result


def clean_harmony_response(content: str) -> str:
    """
    Remove all harmony format tokens from response, keeping only clean text.

    Args:
        content: Raw response with harmony tokens

    Returns:
        Clean text without harmony tokens (empty string if [SKIP] detected)
    """
    # Check for [SKIP] marker - means tool-only response, no text reply
    if "[SKIP]" in content:
        return ""

    # Remove analysis blocks
    cleaned = RE_ANALYSIS_BLOCK.sub("", content)

    # Remove commentary blocks (function calls)
    cleaned = RE_COMMENTARY_BLOCK.sub("", cleaned)

    # Remove <|start|>assistant etc.
    cleaned = RE_START_BLOCK.sub("", cleaned)

    # Remove remaining special tokens
    cleaned = RE_HARMONY_TOKENS.sub("", cleaned)

    # Remove function call markers like to=functions.xxx
    cleaned = re.sub(r'to=functions\.\w+', '', cleaned)

    # Remove channel names that might be left over (analysis, commentary, final)
    cleaned = re.sub(r'\b(?:analysis|commentary|final)\b', '', cleaned)

    # Remove constrain markers like json
    cleaned = re.sub(r'\bjson\b', '', cleaned)

    # Clean up whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    return cleaned


def extract_final_answer(content: str) -> Optional[str]:
    """
    Extract only the final answer from harmony response.

    Args:
        content: Raw response content

    Returns:
        Final answer text or None
    """
    parsed = parse_harmony_response(content)
    return parsed.final_answer


# ============================================================================
# Harmony System Prompt Builder
# ============================================================================

class HarmonyPromptBuilder:
    """
    Builder for gpt-oss harmony format system prompts.

    Usage:
        builder = HarmonyPromptBuilder()
        builder.set_instructions("You are a helpful assistant.")
        builder.add_function("get_weather", "Get weather info", {"city": "string"})
        system_prompt = builder.build()
    """

    def __init__(
        self,
        reasoning: str = DEFAULT_REASONING,
        knowledge_cutoff: str = "2024-06",
    ):
        """
        Initialize the harmony prompt builder.

        Args:
            reasoning: Reasoning level (low/medium/high)
            knowledge_cutoff: Knowledge cutoff date
        """
        self.reasoning = reasoning if reasoning in REASONING_LEVELS else DEFAULT_REASONING
        self.knowledge_cutoff = knowledge_cutoff
        self.instructions: str = ""
        self.functions: List[Dict[str, Any]] = []

    def set_instructions(self, instructions: str) -> "HarmonyPromptBuilder":
        """Set the main instructions."""
        self.instructions = instructions
        return self

    def add_function(
        self,
        name: str,
        description: str,
        parameters: Dict[str, Any],
        required: List[str] = None,
    ) -> "HarmonyPromptBuilder":
        """
        Add a function definition.

        Args:
            name: Function name
            description: Function description
            parameters: Dict of {param_name: param_type_or_config}
                - Simple: {"city": "string", "limit": "number"}
                - With description: {"city": {"type": "string", "description": "City name"}}
                - Optional with default: {"limit": {"type": "number", "optional": True, "default": 5}}
                - Enum: {"unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}}
            required: List of required parameter names (optional, derived from params if not provided)

        Returns:
            self for chaining
        """
        self.functions.append({
            "name": name,
            "description": description,
            "parameters": parameters,
            "required": required,
        })
        return self

    def _format_param_type(self, param_config: Any) -> Tuple[str, str, bool, Optional[Any]]:
        """
        Format a parameter type definition.

        Returns:
            Tuple of (type_str, description, is_optional, default_value)
        """
        if isinstance(param_config, str):
            # Simple type: "string", "number", etc.
            return param_config, "", False, None

        if isinstance(param_config, dict):
            param_type = param_config.get("type", "any")
            description = param_config.get("description", "")
            is_optional = param_config.get("optional", False)
            default = param_config.get("default")
            enum_values = param_config.get("enum")

            # Build type string
            if enum_values:
                type_str = " | ".join(f'"{v}"' for v in enum_values)
            elif param_type == "array":
                item_type = param_config.get("items", "any")
                type_str = f"{item_type}[]"
            else:
                type_str = param_type

            return type_str, description, is_optional, default

        return "any", "", False, None

    def _build_function_def(self, func: Dict) -> str:
        """Build a single function definition in TypeScript format."""
        name = func["name"]
        description = func["description"]
        parameters = func.get("parameters", {})
        required_list = func.get("required")

        lines = []

        # Function description
        lines.append(f"// {description}")

        # Determine if function has parameters
        if not parameters:
            lines.append(f"type {name} = () => any;")
            return "\n".join(lines)

        # Function with parameters
        lines.append(f"type {name} = (_: {{")

        for param_name, param_config in parameters.items():
            type_str, desc, is_optional, default = self._format_param_type(param_config)

            # Determine if required
            if required_list is not None:
                is_required = param_name in required_list
            else:
                is_required = not is_optional

            # Build parameter line
            optional_mark = "?" if not is_required else ""
            param_line = f"// {desc}" if desc else f"// {param_name}"
            lines.append(param_line)

            type_line = f"{param_name}{optional_mark}: {type_str},"
            if default is not None:
                type_line = type_line.rstrip(",") + f", // default: {default}"
            lines.append(type_line)

        lines.append("}) => any;")

        return "\n".join(lines)

    def build(self) -> str:
        """
        Build the complete harmony format system prompt.

        Returns:
            Complete system prompt string
        """
        # Format: 2025-12-04 14:30
        current_datetime = datetime.now().strftime("%Y-%m-%d %H:%M")

        # Build header
        parts = [
            "You are ChatGPT, a large language model trained by OpenAI.",
            f"Knowledge cutoff: {self.knowledge_cutoff}",
            f"Current date: {current_datetime}",
            "",
            f"Reasoning: {self.reasoning}",
        ]

        # Add channel rules if we have functions
        if self.functions:
            parts.extend([
                "",
                "# Valid channels: analysis, commentary, final. Channel must be included for every message.",
                "Calls to these tools must go to the commentary channel: 'functions'.",
            ])

        # Add instructions
        if self.instructions:
            parts.extend([
                "",
                "# Instructions",
                "",
                self.instructions,
            ])

        # Add function definitions
        if self.functions:
            parts.extend([
                "",
                "# Tools",
                "",
                "## functions",
                "",
                "namespace functions {",
                "",
            ])

            for func in self.functions:
                parts.append(self._build_function_def(func))
                parts.append("")

            parts.append("} // namespace functions")

        # Add conversation heading (will be followed by actual messages)
        parts.extend([
            "",
            "# Conversation",
        ])

        return "\n".join(parts)


# ============================================================================
# Harmony Tool Result Builder
# ============================================================================

def build_tool_result_message(func_name: str, result: Any) -> str:
    """
    Build a harmony format tool result message.

    Args:
        func_name: Name of the function that was called
        result: Result from the function execution

    Returns:
        Harmony formatted tool result string
    """
    if isinstance(result, str):
        result_json = json.dumps({"result": result}, ensure_ascii=False)
    elif isinstance(result, (dict, list)):
        result_json = json.dumps(result, ensure_ascii=False)
    else:
        result_json = json.dumps({"result": str(result)}, ensure_ascii=False)

    return f"<|start|>functions.{func_name} to=assistant<|channel|>commentary<|message|>{result_json}<|end|>"


def build_multi_tool_results(results: List[Tuple[str, Any]]) -> str:
    """
    Build harmony format message for multiple tool results.

    Args:
        results: List of (func_name, result) tuples

    Returns:
        Combined harmony formatted tool results
    """
    parts = []
    for func_name, result in results:
        parts.append(build_tool_result_message(func_name, result))
    return "\n".join(parts)


# ============================================================================
# Predefined Tool Definitions
# ============================================================================

# Standard chat tools for GradientFlow
CHAT_TOOLS = {
    "get_context": {
        "name": "get_context",
        "description": "Get messages around a specific message for context",
        "parameters": {
            "message_id": {
                "type": "string",
                "description": "The ID of the target message (from [msg:xxx] prefix)"
            }
        }
    },
    "get_long_context": {
        "name": "get_long_context",
        "description": "Get the full conversation history",
        "parameters": {}
    },
    "web_search": {
        "name": "web_search",
        "description": "Search the web for current information. Use for news, recent events, real-time data.",
        "parameters": {
            "query": {
                "type": "string",
                "description": "Search query"
            }
        }
    },
    "local_rag": {
        "name": "local_rag",
        "description": "Search the local knowledge base for relevant documents",
        "parameters": {
            "query": {
                "type": "string",
                "description": "Search query for knowledge base"
            }
        }
    },
    "react": {
        "name": "react",
        "description": "Add an emoji reaction to a message",
        "parameters": {
            "emoji": {
                "type": "string",
                "description": "Emoji to react with (e.g., thumbs_up, heart, laughing)"
            },
            "message_id": {
                "type": "string",
                "description": "The ID of the message to react to"
            }
        }
    },
}


def get_tool_definition(tool_name: str) -> Optional[Dict]:
    """Get a predefined tool definition by name."""
    return CHAT_TOOLS.get(tool_name)


def create_chat_prompt_builder(
    instructions: str,
    enabled_tools: List[str] = None,
    reasoning: str = DEFAULT_REASONING,
) -> HarmonyPromptBuilder:
    """
    Create a HarmonyPromptBuilder with standard chat tools.

    Args:
        instructions: System instructions
        enabled_tools: List of tool names to enable (None = no tools)
        reasoning: Reasoning level

    Returns:
        Configured HarmonyPromptBuilder
    """
    builder = HarmonyPromptBuilder(reasoning=reasoning)
    builder.set_instructions(instructions)

    if enabled_tools:
        for tool_name in enabled_tools:
            tool_def = CHAT_TOOLS.get(tool_name)
            if tool_def:
                builder.add_function(
                    name=tool_def["name"],
                    description=tool_def["description"],
                    parameters=tool_def.get("parameters", {}),
                )

    return builder