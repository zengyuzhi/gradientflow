# -*- coding: utf-8 -*-
"""
LLM Client

OpenAI-compatible LLM client wrapper for agent services.
Supports custom endpoints (gpt-oss, Azure, etc.) via base_url configuration.
"""
from openai import OpenAI
from typing import Optional

from .config import (
    DEFAULT_LLM_BASE_URL,
    DEFAULT_LLM_MODEL,
    DEFAULT_LLM_API_KEY,
)


# Global client instance (will be initialized on first use or via configure)
_client: Optional[OpenAI] = None
_current_config = {
    "base_url": DEFAULT_LLM_BASE_URL,
    "api_key": DEFAULT_LLM_API_KEY,
}


def configure(base_url: str = None, api_key: str = None) -> OpenAI:
    """
    Configure the LLM client with custom endpoint.

    Args:
        base_url: OpenAI-compatible API endpoint URL
        api_key: API key (may be "not-needed" for local models)

    Returns:
        Configured OpenAI client instance
    """
    global _client, _current_config

    if base_url:
        _current_config["base_url"] = base_url
    if api_key:
        _current_config["api_key"] = api_key

    _client = OpenAI(
        base_url=_current_config["base_url"],
        api_key=_current_config["api_key"],
    )
    return _client


def get_client() -> OpenAI:
    """Get or create the OpenAI client."""
    global _client
    if _client is None:
        _client = OpenAI(
            base_url=_current_config["base_url"],
            api_key=_current_config["api_key"],
        )
    return _client


def chat(
    message: str,
    model: str = DEFAULT_LLM_MODEL,
    max_tokens: int = 1024,
) -> str:
    """
    Send a single message and get response.

    Args:
        message: User message content
        model: Model identifier
        max_tokens: Maximum tokens in response

    Returns:
        Model's response text
    """
    client = get_client()
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": message}],
    )
    return response.choices[0].message.content


def chat_with_history(
    messages: list,
    model: str = DEFAULT_LLM_MODEL,
    max_tokens: int = 1024,
    temperature: float = 0.6,
) -> str:
    """
    Chat with message history.

    Args:
        messages: List of message dicts with role and content
        model: Model identifier
        max_tokens: Maximum tokens in response
        temperature: Sampling temperature (0.0 - 1.0)

    Returns:
        Model's response text

    Raises:
        ValueError: If the API returns an invalid or empty response
    """
    client = get_client()
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=messages,
    )

    # Validate response structure
    if response is None:
        raise ValueError("LLM API returned None response")

    if not hasattr(response, 'choices') or response.choices is None:
        raise ValueError(f"LLM API returned response without choices: {response}")

    if len(response.choices) == 0:
        raise ValueError("LLM API returned empty choices list")

    choice = response.choices[0]
    if not hasattr(choice, 'message') or choice.message is None:
        raise ValueError(f"LLM API returned choice without message: {choice}")

    content = choice.message.content
    if content is None:
        # Some models return None content with function_call or tool_calls
        # Check if there's a function_call or tool_calls we can extract
        if hasattr(choice.message, 'function_call') and choice.message.function_call:
            fc = choice.message.function_call
            return f"<|channel|>commentary to=functions.{fc.name}<|message|>{fc.arguments}<|call|>"
        if hasattr(choice.message, 'tool_calls') and choice.message.tool_calls:
            # Convert tool_calls to harmony format
            parts = []
            for tc in choice.message.tool_calls:
                if tc.function:
                    parts.append(f"<|channel|>commentary to=functions.{tc.function.name}<|message|>{tc.function.arguments}<|call|>")
            if parts:
                return "\n".join(parts)
        raise ValueError("LLM API returned None content without function_call or tool_calls")

    return content


if __name__ == "__main__":
    result = chat("1+1=?")
    print(result)