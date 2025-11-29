# Agent 服务

基于 Python 的多智能体服务，连接到聊天后端并智能响应 @ 提及，具备上下文感知能力。

## 架构

```
                      轮询消息
                  ←─────────────────────
  聊天后端                                多 Agent 管理器
  (Express.js)   ─────────────────────→    (Python)
  localhost:4000      发送回复                  │
       ↑                                       ├── Agent 1 线程
       │                                       ├── Agent 2 线程
       │    获取 agent 配置                    └── Agent N 线程
       └────────────────────────────────────────→│
                                                 ↓
                                             LLM 后端
                                          (parallax/openai/自定义)
```

## 文件结构

| 文件 | 描述 |
|------|------|
| `agent_service.py` | 核心 agent 服务 - 处理轮询、提及检测、上下文构建、LLM 调用 |
| `multi_agent_manager.py` | 多 agent 协调器 - 并发运行多个 agent，支持自动重启 |
| `tools.py` | 内置工具 - 上下文检索、网络搜索、知识库查询 |
| `query.py` | LLM 客户端 - 处理与模型后端的通信（支持动态配置） |
| `rag_service.py` | RAG 服务 - 基于 ChromaDB 的文档向量检索服务 |
| `requirements.txt` | Python 依赖 |
| `requirements-rag.txt` | RAG 服务额外依赖 |

## 安装

### 基础依赖

```bash
pip install -r requirements.txt
```

### RAG 服务依赖（可选）

```bash
pip install -r requirements-rag.txt
```

## 配置

### 前端配置（推荐）

在 Web UI（Agent 配置中心）中配置你的 agent，服务会自动获取以下设置：

| 设置项 | 描述 |
|--------|------|
| System Prompt | 发送给 LLM 的系统提示词 |
| Provider | `parallax`、`openai`、`azure`、`anthropic`、`custom` |
| Model Name | 模型标识符（如 `default`、`gpt-4o-mini`） |
| Temperature | 响应随机性（0.0 - 2.0） |
| Max Tokens | 最大响应长度 |
| Endpoint | LLM API 端点 URL（用于 parallax provider） |
| API Key Alias | 可选的 API 密钥标识符 |

### 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `API_BASE` | `http://localhost:4000` | 聊天后端 URL |
| `AGENT_TOKEN` | `dev-agent-token` | Agent API 认证令牌 |
| `AGENT_ID` | `helper-agent-1` | Agent ID（必须在后端存在） |
| `AGENT_USER_ID` | `llm1` | 与 agent 关联的用户 ID |
| `POLL_INTERVAL` | `1` | 消息轮询间隔（秒） |
| `HEARTBEAT_INTERVAL` | `5` | 心跳信号间隔（秒） |

## 使用方法

### 前置条件

确保聊天后端正在运行：
```bash
# 在项目根目录
npm run server
```

### 单 Agent 模式

启动单个 agent：
```bash
python agent_service.py
```

指定 agent ID：
```bash
python agent_service.py --agent-id helper-agent-1
```

使用自定义凭据：
```bash
python agent_service.py --email user@example.com --password yourpassword --agent-id my-agent
```

### 多 Agent 模式（推荐）

并发启动所有活跃的 agent：
```bash
python multi_agent_manager.py
```

启动指定的 agent：
```bash
python multi_agent_manager.py --agent-ids agent-1 agent-2 agent-3
```

多 Agent 模式特性：
- 每个 agent 在独立线程中运行
- 崩溃的 agent 自动重启
- 自动跳过未激活的 agent
- 所有 agent 共享单次登录

### RAG 服务

启动 RAG API 服务器：
```bash
python rag_service.py --port 4001
```

运行快速测试：
```bash
python rag_service.py --test
```

## 工作原理

1. **登录**：向聊天后端认证获取 JWT 令牌
2. **获取配置**：从 `/agents` API 获取 agent 配置
3. **配置 LLM**：如果 provider 是 `parallax`，使用端点 URL 配置 LLM 客户端
4. **心跳**：周期性发送心跳信号表示服务在线（设置"正在查看"指示器）
5. **轮询**：每隔 `POLL_INTERVAL` 秒获取新消息
6. **检测 @**：检查消息是否提及此 agent（通过 `mentions` 字段或内容中的 `@AgentName`）
7. **追问检测**：检测用户是否发送了后续消息（避免响应不完整的想法）
8. **构建上下文**：收集带有方向标签的最近消息（[TO: YOU]、[TO: @other]、[TO: everyone]）
9. **生成回复**：发送上下文给 LLM，支持多轮工具调用
10. **执行工具**：在发送响应前处理工具调用（表情、上下文检索）
11. **发送**：通过 `/agents/:agentId/messages` API 发送回复

## 消息格式

### 发送给 LLM 的输入

消息带有方向标签格式化，帮助 agent 理解每条消息是发给谁的：

```python
[
    {"role": "system", "content": "你是一个有帮助的 AI 助手..."},
    {"role": "user", "content": "[msg:abc-123] <Alice> [TO: everyone]: 大家好！"},
    {"role": "user", "content": "[msg:def-456] <Bob> [TO: @MOSS, not you]: 嘿 MOSS，最近怎么样？"},
    {"role": "assistant", "content": "你好！有什么可以帮助你的？"},
    {"role": "user", "content": "[msg:ghi-789] <Charlie> [TO: YOU]: 1+1 等于多少？"},
]
```

**方向标签说明：**
- `[TO: YOU]` - 消息是发给此 agent 的（必须响应）
- `[TO: @OtherAgent, not you]` - 消息是发给其他 agent 的（不应响应）
- `[TO: everyone]` - 发给群组的通用消息（如有帮助可响应）

### 响应处理

服务自动从 LLM 响应中剥离特殊标签：
- `<think>...</think>` - 思考/推理块
- `<|channel|>analysis<|message|>...<|end|>` - 分析通道
- 如果存在则提取 `<|channel|>final<|message|>...` 中的内容
- `[REACT:emoji:msg_id]` - 表情反应工具调用
- `[GET_CONTEXT:msg_id]` / `[GET_LONG_CONTEXT]` - 上下文工具调用

## Agent 模式

### 被动模式（默认）

Agent 只在被明确 @ 提及时响应。当 `capabilities.answer_active` 为 false 时配置。

### 主动模式

Agent 可以主动参与对话。通过设置 `capabilities.answer_active: true` 启用。

主动模式下，agent：
- 监控所有消息（不仅是 @ 提及）
- 根据上下文决定是否响应
- 可以使用 `[SKIP]` 拒绝响应
- 遵守冷却期（`runtime.proactiveCooldown`，默认 30 秒）
- 不会响应发给其他 agent 的消息

**主动决策流程：**
1. 检查消息是否 @ 提及其他 agent → 跳过
2. 检查冷却期 → 如果太近则跳过
3. 检查是否有后续消息 → 如果用户仍在输入则跳过
4. 让 LLM 决定：响应、反应或 `[SKIP]`

## 内置工具

Agent 可以使用内置工具增强能力：

### 表情反应工具
给消息添加表情反应：
```
[REACT:👍:message-id-here]
[REACT:❤️:abc-123-def]
```

### 上下文检索工具
需要时获取更多对话历史：
```
[GET_CONTEXT:message-id]     # 获取特定消息周围的 10 条消息
[GET_LONG_CONTEXT]           # 获取完整对话历史（最多 50 条消息）
```

### 网络搜索工具
使用 DuckDuckGo 搜索网络信息：
```
[WEB_SEARCH:搜索关键词]
```

### 知识库查询工具
从本地 RAG 知识库检索相关文档：
```
[LOCAL_RAG:查询内容]
```

这些工具支持多轮 LLM 调用：
1. Agent 请求工具 → 工具执行 → 返回结果
2. Agent 利用额外信息生成知情的响应

### 追问检测

Agent 检测"分段消息"（用户快速连续发送多条消息时）：

```
用户: 大家好！         # 消息 1
用户: 你们知道吗？     # 消息 2
用户: 我看到一颗星星！ # 消息 3（带 @Agent）
```

Agent 不会立即响应消息 3，而是：
1. 检查发送者是否有更新的消息
2. 如果有，跳过当前消息
3. 等待完整的想法后再响应

## RAG 服务

RAG（检索增强生成）服务提供基于向量嵌入的文档检索能力：

### 功能特性
- 文档上传，自动分块和嵌入
- 使用向量相似度进行语义搜索
- 所有 agent 共享知识库
- 使用 ChromaDB 进行持久化存储
- 内置嵌入模型（all-MiniLM-L6-v2）

### API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/rag/upload` | POST | 上传文档到知识库 |
| `/rag/search` | POST | 语义搜索知识库 |
| `/rag/stats` | GET | 获取知识库统计信息 |
| `/rag/delete` | POST | 通过文档哈希删除文档 |
| `/rag/clear` | POST | 清空整个知识库 |
| `/health` | GET | 健康检查 |

### 使用示例

上传文档：
```python
import requests

response = requests.post("http://localhost:4001/rag/upload", json={
    "content": "文档内容...",
    "filename": "document.txt",
    "type": "text"
})
```

搜索文档：
```python
response = requests.post("http://localhost:4001/rag/search", json={
    "query": "搜索关键词",
    "topK": 5,
    "threshold": 0.3
})
```

### 配置参数

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `CHUNK_SIZE` | 500 | 每个分块的字符数 |
| `CHUNK_OVERLAP` | 50 | 分块之间的重叠字符数 |
| `COLLECTION_NAME` | `knowledge_base` | ChromaDB 集合名称 |

## 日志

服务记录详细信息，包括完整的提示词和响应：

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

## API 端点

Agent 服务使用以下后端端点：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/auth/login` | POST | 登录获取 JWT 令牌 |
| `/agents` | GET | 获取所有 agent 配置 |
| `/agents/:id/heartbeat` | POST | 发送心跳信号 |
| `/agents/:id/messages` | POST | 以 agent 身份发送消息 |
| `/agents/:id/reactions` | POST | 给消息添加表情反应 |
| `/agents/:id/looking` | POST | 设置"正在查看消息"状态 |
| `/agents/:id/context` | GET | 获取特定消息周围的消息 |
| `/agents/:id/long-context` | GET | 获取完整对话历史 |
| `/agents/:id/tools/web-search` | POST | 网络搜索（DuckDuckGo） |
| `/agents/:id/tools/local-rag` | POST | 知识库查询 |
| `/messages` | GET | 获取消息（带 `since` 参数） |

## Parallax Provider

`parallax` provider 专为兼容 OpenAI 的自定义 LLM 端点设计：

1. 在前端选择 Provider: `parallax`
2. 设置端点 URL: `https://your-llm-endpoint/v1`
3. 模型名称默认为 `default`（可自定义）
4. API key 可选（默认为 `not-needed`）

Agent 服务会自动使用这些设置配置 LLM 客户端。

## 扩展开发

### 上下文窗口大小

修改上下文中最近消息的数量（默认：10）：

```python
# 在 agent_service.py 中
CONTEXT_LIMIT = 20  # 增加到 20 条消息
```

### 自定义 LLM 配置

使用 `query.py` 进行编程配置：

```python
from query import configure, chat_with_history

# 配置端点
configure(base_url="https://your-endpoint/v1", api_key="your-key")

# 使用客户端
response = chat_with_history(messages, model="your-model", temperature=0.7)
```

### 添加自定义工具

扩展 `tools.py` 添加新的 agent 工具：

```python
# 添加新工具模式
RE_MY_TOOL = re.compile(r"\[MY_TOOL:([^\]]+)\]")

# 添加到 parse_tool_calls()
def parse_tool_calls(response: str) -> Dict[str, List]:
    result = {
        "get_context": [],
        "get_long_context": False,
        "my_tool": [],  # 添加新工具
    }
    # ... 解析逻辑
    return result
```

### 能力参考

在前端"Agent 能力"下配置这些选项：

| 能力 | 描述 |
|------|------|
| `answer_passive` | 被 @ 提及时响应 |
| `answer_active` | 主动参与对话 |
| `like` | 给消息添加表情反应 |
| `summarize` | 生成对话摘要 |