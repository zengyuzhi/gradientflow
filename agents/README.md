# Agent Service

Python-based multi-agent service that connects to the chat backend and responds to @ mentions with intelligent context awareness.

## Architecture

```
                      poll messages
                  ←─────────────────────
  Chat Backend                             Multi-Agent Manager
  (Express.js)   ─────────────────────→    (Python)
  localhost:4000      send replies              │
       ↑                                        ├── Agent 1 Thread
       │                                        ├── Agent 2 Thread
       │    fetch agent configs                 └── Agent N Thread
       └────────────────────────────────────────────→│
                                                     ↓
                                                LLM Backend
                                              (parallax/openai/custom)
```

## Files

| File | Description |
|------|-------------|
| `agent_service.py` | Core agent service - handles polling, mentions detection, context building, LLM calls |
| `multi_agent_manager.py` | Multi-agent orchestrator - runs multiple agents concurrently with auto-restart |
| `tools.py` | Built-in tools - context retrieval tools (GET_CONTEXT, GET_LONG_CONTEXT) |
| `query.py` | LLM client - handles communication with model backends (supports dynamic configuration) |
| `requirements.txt` | Python dependencies |

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure agent in the frontend (Agent 配置中心):
   - Set Provider to `parallax` (or other)
   - Set Endpoint URL in "Endpoint / MCP URL" field
   - Set model name, temperature, max tokens
   - Set system prompt

3. Ensure the chat backend is running:
```bash
# In project root
npm run server
```

## Usage

### Single Agent Mode

Start a single agent:
```bash
python agent_service.py
```

With specific agent ID:
```bash
python agent_service.py --agent-id helper-agent-1
```

With custom credentials:
```bash
python agent_service.py --email user@example.com --password yourpassword --agent-id my-agent
```

### Multi-Agent Mode (Recommended)

Start all active agents concurrently:
```bash
python multi_agent_manager.py
```

Start specific agents:
```bash
python multi_agent_manager.py --agent-ids agent-1 agent-2 agent-3
```

Features:
- Runs each agent in its own thread
- Auto-restarts crashed agents
- Skips inactive agents automatically
- Single login for all agents

## Configuration

### Frontend Configuration (Recommended)

Configure your agent via the web UI (Agent 配置中心). The agent service will automatically fetch:

| Setting | Description |
|---------|-------------|
| System Prompt | The system message sent to the LLM |
| Provider | `parallax`, `openai`, `azure`, `anthropic`, `custom` |
| Model Name | Model identifier (e.g., `default`, `gpt-4o-mini`) |
| Temperature | Response randomness (0.0 - 2.0) |
| Max Tokens | Maximum response length |
| Endpoint | LLM API endpoint URL (for parallax provider) |
| API Key Alias | Optional API key identifier |

### Environment Variables (agent_service.py)

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `http://localhost:4000` | Chat backend URL |
| `AGENT_TOKEN` | `dev-agent-token` | Agent API authentication token |
| `AGENT_ID` | `helper-agent-1` | Agent ID (must exist in backend) |
| `AGENT_USER_ID` | `llm1` | User ID associated with the agent |
| `POLL_INTERVAL` | `3` | Seconds between message polls |
| `HEARTBEAT_INTERVAL` | `5` | Seconds between heartbeat signals |

## How It Works

1. **Login**: Authenticates with the chat backend to get JWT token
2. **Fetch Config**: Retrieves agent configuration from `/agents` API
3. **Configure LLM**: If provider is `parallax`, configures LLM client with endpoint URL
4. **Heartbeat**: Sends periodic heartbeat to signal the service is online (sets "looking" indicator)
5. **Poll**: Fetches new messages every `POLL_INTERVAL` seconds
6. **Detect @**: Checks if messages mention this agent (via `mentions` field or `@AgentName` in content)
7. **Follow-up Check**: Detects if user sent additional messages (avoids responding to incomplete thoughts)
8. **Build Context**: Collects recent messages with direction tags ([TO: YOU], [TO: @other], [TO: everyone])
9. **Generate Reply**: Sends context to LLM, supports multi-round tool calls
10. **Execute Tools**: Processes tool calls (reactions, context retrieval) before sending response
11. **Send**: Posts reply via `/agents/:agentId/messages` API

## Message Format

### Input to LLM

Messages are formatted with direction tags to help the agent understand who each message is addressed to:

```python
[
    {"role": "system", "content": "You are a helpful AI assistant..."},
    {"role": "user", "content": "[msg:abc-123] <Alice> [TO: everyone]: Hello everyone!"},
    {"role": "user", "content": "[msg:def-456] <Bob> [TO: @MOSS, not you]: Hey MOSS, what's up?"},
    {"role": "assistant", "content": "Hello! How can I help?"},
    {"role": "user", "content": "[msg:ghi-789] <Charlie> [TO: YOU]: What is 1+1?"},
]
```

**Direction Tags:**
- `[TO: YOU]` - Message is addressed to this agent (must respond)
- `[TO: @OtherAgent, not you]` - Message is for another agent (should not respond)
- `[TO: everyone]` - General message to the group (may respond if helpful)

### Response Processing

The service automatically strips special tags from LLM responses:
- `<think>...</think>` - Thinking/reasoning blocks
- `<|channel|>analysis<|message|>...<|end|>` - Analysis channels
- Extracts content from `<|channel|>final<|message|>...` if present
- `[REACT:emoji:msg_id]` - Emoji reaction tool calls
- `[GET_CONTEXT:msg_id]` / `[GET_LONG_CONTEXT]` - Context tool calls

## Agent Modes

### Passive Mode (Default)

Agent only responds when explicitly @ mentioned. Configured when `capabilities.answer_active` is false.

### Proactive Mode

Agent can proactively participate in conversations. Enable by setting `capabilities.answer_active: true`.

In proactive mode, the agent:
- Monitors all messages (not just @ mentions)
- Decides whether to respond based on context
- Can use `[SKIP]` to decline responding
- Respects cooldown period (`runtime.proactiveCooldown`, default 30s)
- Won't respond to messages directed at other agents

**Proactive Decision Flow:**
1. Check if message @ mentions another agent → Skip
2. Check cooldown period → Skip if too recent
3. Check for follow-up messages → Skip if user still typing
4. Let LLM decide: respond, react, or `[SKIP]`

## Built-in Tools

Agents have access to built-in tools for enhanced capabilities:

### Reaction Tool
Add emoji reactions to messages:
```
[REACT:👍:message-id-here]
[REACT:❤️:abc-123-def]
```

### Context Retrieval Tools
Get more conversation history when needed:

```
[GET_CONTEXT:message-id]     # Get 10 messages around a specific message
[GET_LONG_CONTEXT]           # Get full conversation history (up to 50 messages)
```

These tools enable multi-round LLM calls:
1. Agent requests context → Tool executes → Context returned
2. Agent generates informed response with additional context

### Follow-up Detection

The agent detects "split messages" (when users send multiple messages in quick succession):

```
User: Hey guys!          # Message 1
User: You know what?     # Message 2
User: I saw a star!      # Message 3 (with @Agent)
```

Instead of responding to Message 3 immediately, the agent:
1. Checks if the sender has newer messages
2. If yes, skips the current message
3. Waits for the complete thought before responding

## Logging

The service logs detailed information including full prompts and responses:

```
[Agent] 启动服务...
[Agent] API: http://localhost:4000
[Agent] Agent ID: helper-agent-1
[Agent] 已配置 parallax provider: https://your-endpoint/v1
[Agent] 已加载配置:
  - 名称: AI助手
  - Provider: parallax
  - Model: default
  - System Prompt: You are a helpful AI assistant...
----------------------------------------
[Agent] 收到 @ 消息: who are you...

[Agent] ===== 发送给模型的提示词 =====
[Agent] Model: default, Temp: 0.6, MaxTokens: 1024
[0] system:
    You are a helpful AI assistant...
[1] user:
    <Name: Yuzhi> [asking you]: who are you
[Agent] ===== 提示词结束 =====

[Agent] ===== 原始响应 =====
<think>The user is asking...</think>
Hi! I'm your friendly AI assistant.
[Agent] ===== 原始响应结束 =====

[Agent] 过滤后: Hi! I'm your friendly AI assistant....
[Agent] 消息已发送: Hi! I'm your friendly AI assistant....
```

## Parallax Provider

The `parallax` provider is designed for custom OpenAI-compatible LLM endpoints:

1. In frontend, select Provider: `parallax`
2. Set Endpoint URL: `https://your-llm-endpoint/v1`
3. Model name defaults to `default` (can be customized)
4. API key is optional (defaults to `not-needed`)

The agent service will automatically configure the LLM client with these settings.

## API Endpoints

The agent service uses these backend endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | Login to get JWT token |
| `/agents` | GET | Fetch all agent configurations |
| `/agents/:id/heartbeat` | POST | Send heartbeat signal |
| `/agents/:id/messages` | POST | Send a message as the agent |
| `/agents/:id/reactions` | POST | Add emoji reaction to a message |
| `/agents/:id/looking` | POST | Set "looking at messages" status |
| `/agents/:id/context` | GET | Get messages around a specific message |
| `/agents/:id/long-context` | GET | Get full conversation history |
| `/messages` | GET | Fetch messages (with `since` parameter) |

## Extending

### Context Window Size

Change the number of recent messages in context (default: 10):

```python
# In agent_service.py
CONTEXT_LIMIT = 20  # Increase to 20 messages
```

### Custom LLM Configuration

For programmatic configuration, use `query.py`:

```python
from query import configure, chat_with_history

# Configure endpoint
configure(base_url="https://your-endpoint/v1", api_key="your-key")

# Use the client
response = chat_with_history(messages, model="your-model", temperature=0.7)
```

### Adding Custom Tools

Extend `tools.py` to add new agent tools:

```python
# Add new tool pattern
RE_MY_TOOL = re.compile(r"\[MY_TOOL:([^\]]+)\]")

# Add to parse_tool_calls()
def parse_tool_calls(response: str) -> Dict[str, List]:
    result = {
        "get_context": [],
        "get_long_context": False,
        "my_tool": [],  # Add new tool
    }
    # ... parse logic
    return result
```

### Capabilities Reference

Configure these in the frontend under "Agent Capabilities":

| Capability | Description |
|------------|-------------|
| `answer_passive` | Respond when @ mentioned |
| `answer_active` | Proactively participate in conversations |
| `like` | Add emoji reactions to messages |
| `summarize` | Generate conversation summaries |