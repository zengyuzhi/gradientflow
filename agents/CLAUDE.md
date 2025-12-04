# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Python-based multi-agent service that connects to the GradientFlow chat backend (`localhost:4000`). Agents poll for messages, detect @ mentions, and respond using LLM backends with support for GPT-OSS Harmony format function calling.

## Quick Start

```bash
# 1. Ensure backend is running (from project root)
npm run server

# 2. Start agents
pip install -r requirements.txt
python multi_agent_manager.py --email root@example.com --password 1234567890

# Single agent mode (for debugging)
python agent_service.py --agent-id helper-agent-1
```

## Dependencies

```bash
pip install -r requirements.txt       # Base: openai, requests
pip install -r requirements-rag.txt   # RAG: chromadb, flask
pip install -r requirements-mcp.txt   # MCP: fastmcp, beautifulsoup4
```

## Architecture

```
multi_agent_manager.py    # Manages multiple concurrent agents
    ↓
agent_service.py          # Main agent implementation (extends BaseAgentService)
    ↓
base_agent.py             # Abstract base class with polling loop, mention detection
    ↓
core/                     # Shared modules
├── config.py             # Constants (API_BASE, intervals, timeouts)
├── api_client.py         # AgentAPIClient - HTTP wrapper for backend
├── mention_detector.py   # MentionDetector - @ mention parsing
├── harmony_parser.py     # GPT-OSS Harmony format parser/builder
├── tool_definitions.py   # Unified tool definitions (single source of truth)
├── tool_formatters.py    # Convert definitions to Harmony/Text prompts
├── llm_client.py         # LLM client wrapper (OpenAI SDK)
└── tool_executor.py      # AgentTools - GET_CONTEXT, WEB_SEARCH, LOCAL_RAG, MCP
```

## Key Patterns

**Adding/Modifying Tools**: All tool definitions live in `core/tool_definitions.py`. The formatters automatically generate both Harmony (GPT-OSS) and text prompt formats from this single source.

**LLM Provider Detection**: When `provider == "parallax"`, harmony format is auto-enabled (`agent_service.py:112`). Standard text format used otherwise.

**Message Processing Flow**:
1. `multi_agent_manager.py` spawns agent threads
2. `base_agent.py::run()` polls messages, checks mentions via `MentionDetector`
3. `agent_service.py::generate_reply()` builds prompts, calls LLM, executes tools
4. Tool results trigger second LLM round if needed (`max_tool_rounds=2`)

**Tool Result Handling** (OpenAI-style separation):
- Tool results are passed as a separate `[Tool Results]` section in a user message
- Original chat history remains unchanged (not polluted with tool calls)
- Round 2 prompt structure:
  ```
  [0] system: <system prompt>
  [1-N] user/assistant: <original chat history>
  [N+1] user: [Tool Results]
              **web_search**: {results...}

              Now provide your response based on the tool results above.
  ```

**Tool Formats**:
- Standard: `[WEB_SEARCH:query]`, `[LOCAL_RAG:query]`, `[GET_CONTEXT:msg-id]`
- Harmony: `<|channel|>commentary to=functions.web_search <|message|>{"query":"..."}<|call|>`

## Configuration

Agents are configured via the web UI (stored in backend). Key fields:
- `model.provider`: `parallax` | `openai` | `azure` | `anthropic`
- `model.name`: Model identifier
- `runtime.endpoint`: LLM API URL (for parallax)
- `capabilities.answer_active`: Enable proactive mode
- `tools`: Array of enabled tool keys (`web_search`, `local_rag`, etc.)
- `reasoning`: GPT-OSS reasoning level (`low`/`medium`/`high`)

## Optional Services

**RAG Service** (`rag_service.py`):
```bash
python rag_service.py --port 4001
```
Provides ChromaDB-based document search at `/rag/search`.

**MCP Research Server** (`mcp_research_server.py`):
```bash
python mcp_research_server.py --transport sse --port 3001
```
Academic paper search via Semantic Scholar and arXiv.

## Extending

Create a custom agent by extending `BaseAgentService`:

```python
from base_agent import BaseAgentService

class MyAgent(BaseAgentService):
    def _init_llm(self, config):
        # Configure LLM client
        pass

    def build_system_prompt(self, mode, users):
        return self._build_base_system_prompt(mode, users) + "\n[Custom instructions]"

    def generate_reply(self, context, current_msg, mode, users):
        # Return (only_tools: bool, response_text: str)
        return False, "Hello!"
```