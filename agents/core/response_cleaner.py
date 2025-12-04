# -*- coding: utf-8 -*-
"""
Response Cleaner

Utilities for cleaning LLM responses, removing special tags, and extracting final content.
Contains all precompiled regex patterns used across the agent services.
"""

import re
from .config import LOG_TRUNCATE, LOG_MAX_LENGTH


def log_text(text: str, max_len: int = None) -> str:
    """
    Prepare text for logging, optionally truncating based on config.

    Args:
        text: Text to prepare for logging
        max_len: Override max length (uses LOG_MAX_LENGTH if None)

    Returns:
        Full text if LOG_TRUNCATE is False, otherwise truncated with "..."
    """
    if not text:
        return ""
    if not LOG_TRUNCATE:
        return text
    limit = max_len if max_len is not None else LOG_MAX_LENGTH
    if len(text) <= limit:
        return text
    return text[:limit] + "..."

# =============================================================================
# Precompiled Regex Patterns
# =============================================================================

# Final channel extraction
RE_FINAL_CHANNEL = re.compile(
    r"<\|channel\|>final<\|message\|>(.*?)(?:<\|end\|>|$)", re.DOTALL
)

# Think tags
RE_THINK_TAG = re.compile(r"<think>.*?</think>", re.DOTALL)

# Channel blocks
RE_START_BLOCK = re.compile(r"<\|start\|>.*?(?=<\|start\|>|$)", re.DOTALL)
RE_CHANNEL_BLOCK = re.compile(
    r"<\|channel\|>[^<]*<\|message\|>.*?(?:<\|end\|>|<\|start\|>|$)", re.DOTALL
)

# Special tags
RE_SPECIAL_TAG = re.compile(r"<\|[^>]+\|>")

# Keywords at line start
RE_KEYWORDS = re.compile(
    r"^(analysis|commentary|thinking|final)\s*", re.IGNORECASE | re.MULTILINE
)

# JSON patterns
RE_JSON_REACTION = re.compile(r'\{[^}]*"(?:reaction|emoji)"[^}]*\}')
RE_JSON_TOOL_CALL = re.compile(r'\{"(?:query|id|search)[^}]*\}')

# Whitespace cleanup
RE_MULTI_NEWLINES = re.compile(r"\n{3,}")

# Message prefix pattern
RE_MSG_PREFIX = re.compile(
    r"\[msg:[a-f0-9\-]+\]\s*<[^>]+>\s*(?:\[TO:[^\]]+\]\s*)?:?\s*"
)

# Mention pattern
RE_MENTION = re.compile(r"@[\w\-\.]+\s*")

# React tool pattern
RE_REACT_TOOL = re.compile(r"\[REACT:([^:]+):([^\]]+)\]")

# Native model format patterns for tool calls
RE_NATIVE_CHANNEL_BLOCK = re.compile(
    r"<\|channel\|>(?:analysis|commentary|tool)[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>.*?(?:<\|end\|>|<\|call\|>|<\|start\|>|$)",
    re.DOTALL | re.IGNORECASE,
)

RE_NATIVE_TOOL_CALL = re.compile(
    r"<\|channel\|>(?:commentary|analysis|tool)\s+to=\w+[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\{[^}]*\}(?:<\|call\|>)?",
    re.DOTALL | re.IGNORECASE,
)

# Native Harmony COT tool call patterns
RE_TOOL_PATTERNS = [
    # Most specific: with <|constrain|>
    re.compile(
        r"<\|channel\|>(?:commentary|analysis)\s+to=\s*(\w+)[^<]*<\|constrain\|>[^<]*<\|message\|>(\{[^}]*\})(?:<\|call\|>)?",
        re.DOTALL | re.IGNORECASE,
    ),
    # Without <|constrain|>: to=TOOL ...code/other...<|message|>
    re.compile(
        r"<\|channel\|>(?:commentary|analysis)\s+to=\s*(\w+)[^<]*<\|message\|>(\{[^}]*\})(?:<\|call\|>)?",
        re.DOTALL | re.IGNORECASE,
    ),
    # Fallback: any "to=TOOL" followed by JSON in <|message|>
    re.compile(
        r"to=\s*(\w+)[^{]*(\{[^}]+\})",
        re.DOTALL | re.IGNORECASE,
    ),
]


# =============================================================================
# Response Cleaning Functions
# =============================================================================


def strip_special_tags(text: str) -> str:
    """
    Clean model output of special tags, keeping only final answer.

    Handles:
    - Harmony COT format (<|channel|>...<|message|>...)
    - Think tags (<think>...</think>)
    - JSON tool call residuals
    - Multiple newlines cleanup

    Args:
        text: Raw model output text

    Returns:
        Cleaned text with only the final response content
    """
    if not text:
        return ""

    # 1. Try to extract final channel content
    final_match = RE_FINAL_CHANNEL.search(text)
    if final_match:
        text = final_match.group(1)
    else:
        # Remove all analysis/commentary blocks
        text = RE_NATIVE_TOOL_CALL.sub("", text)
        text = RE_NATIVE_CHANNEL_BLOCK.sub("", text)

    # 2. Remove <think>...</think>
    text = RE_THINK_TAG.sub("", text)

    # 3. Remove complete channel blocks
    text = RE_START_BLOCK.sub("", text)
    text = RE_CHANNEL_BLOCK.sub("", text)

    # 4. Remove remaining special tags
    text = RE_SPECIAL_TAG.sub("", text)

    # 5. Clean residual keywords at line start
    text = RE_KEYWORDS.sub("", text)

    # 6. Remove JSON tool call residuals
    text = RE_JSON_REACTION.sub("", text)
    text = RE_JSON_TOOL_CALL.sub("", text)

    # 7. Remove LLM miscopied message prefix format
    text = RE_MSG_PREFIX.sub("", text)

    # 8. Clean excess newlines
    text = RE_MULTI_NEWLINES.sub("\n\n", text)

    return text.strip()


def extract_final_response(response: str) -> str:
    """
    Extract the final response from Harmony COT format.

    Looks for: <|channel|>final<|message|>CONTENT
    Falls back to strip_special_tags if not found.

    Args:
        response: Raw model response

    Returns:
        Extracted final response text
    """
    final_match = RE_FINAL_CHANNEL.search(response)
    if final_match:
        return final_match.group(1).strip()

    # Fallback: clean all special tags
    return strip_special_tags(response)


def remove_mentions(text: str) -> str:
    """
    Remove @ mentions from text.

    Args:
        text: Text containing @ mentions

    Returns:
        Text with @ mentions removed
    """
    return RE_MENTION.sub("", text).strip()