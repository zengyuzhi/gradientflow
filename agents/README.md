# Agent 服务

基于 Python 的多智能体服务，连接到聊天后端并智能响应 @ 提及，具备上下文感知能力。

## 目录

- [快速开始](#快速开始)
- [架构](#架构)
- [文件结构](#文件结构)
- [安装](#安装)
- [Agent 服务](#agent-服务)
- [GPT-OSS Harmony 格式](#gpt-oss-harmony-格式)
- [RAG 服务](#rag-服务)
- [MCP 研究服务器](#mcp-研究服务器)
- [配置参考](#配置参考)
- [API 参考](#api-参考)
- [扩展开发](#扩展开发)

---

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 确保后端运行中（在项目根目录）
npm run server

# 3. 启动多 Agent 管理器
python multi_agent_manager.py --email root@example.com --password 1234567890
```

---

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
                                          (gpt-oss/openai/自定义)
```

### 模块化架构

```
agents/
├── core/                          # 核心模块
│   ├── __init__.py               # 导出所有公共接口
│   ├── config.py                 # 统一配置常量
│   ├── response_cleaner.py       # 响应清理 + 正则表达式
│   ├── api_client.py             # HTTP API 封装 (AgentAPIClient)
│   ├── mention_detector.py       # @ 提及检测 (MentionDetector)
│   ├── harmony_parser.py         # GPT-OSS Harmony 格式解析/构建
│   ├── tool_definitions.py       # 统一工具定义（单一数据源）
│   ├── tool_formatters.py        # 工具格式化器（Harmony/Text）
│   ├── llm_client.py             # LLM 客户端（OpenAI SDK 封装）
│   └── tool_executor.py          # 工具执行器（AgentTools）
│
├── base_agent.py                  # Agent 基类 (BaseAgentService)
├── agent_service.py               # Agent 服务实现 (支持 Harmony)
├── multi_agent_manager.py         # 多 Agent 管理器
│
├── rag_service.py                 # RAG 服务
└── mcp_research_server.py         # MCP 研究服务器
```

---

## 文件结构

### 核心模块 (core/)

| 文件 | 描述 |
|------|------|
| `core/config.py` | 统一配置常量（API_BASE, AGENT_TOKEN 等） |
| `core/response_cleaner.py` | LLM 响应清理、正则表达式模式 |
| `core/api_client.py` | HTTP API 封装类 (AgentAPIClient) |
| `core/mention_detector.py` | @ 提及检测逻辑 (MentionDetector) |
| `core/harmony_parser.py` | GPT-OSS Harmony 格式解析器和提示词构建器 |
| `core/tool_definitions.py` | 统一工具定义（单一数据源） |
| `core/tool_formatters.py` | 工具格式化器（Harmony/Text 格式转换） |
| `core/llm_client.py` | LLM 客户端（OpenAI SDK 封装） |
| `core/tool_executor.py` | 工具执行器（AgentTools 类） |

### 服务文件

| 文件 | 描述 |
|------|------|
| `base_agent.py` | Agent 服务抽象基类，包含公共逻辑 |
| `agent_service.py` | Agent 服务实现（支持 Harmony 格式） |
| `multi_agent_manager.py` | 多 Agent 管理器 |
| `rag_service.py` | RAG 服务 - 基于 ChromaDB 的文档向量检索 |
| `mcp_research_server.py` | MCP 研究服务器 - 学术论文搜索（FastMCP） |

### 依赖文件

| 文件 | 描述 |
|------|------|
| `requirements.txt` | 基础依赖 |
| `requirements-rag.txt` | RAG 服务依赖（chromadb, flask） |
| `requirements-mcp.txt` | MCP 服务器依赖（fastmcp, feedparser） |

### 文档

| 文件 | 描述 |
|------|------|
| `GPT_OSS_FUNCTION_CALLING.md` | gpt-oss 模型 Function Calling 提示词构建指南 |

---

## 安装

```bash
# 基础依赖（必需）
pip install -r requirements.txt

# RAG 服务依赖（可选）
pip install -r requirements-rag.txt

# MCP 服务器依赖（可选）
pip install -r requirements-mcp.txt
```

---

## Agent 服务

Agent 服务负责监听聊天消息并智能响应。

### 启动方式

```bash
# 单 Agent
python agent_service.py --agent-id helper-agent-1

# 多 Agent（推荐）
python multi_agent_manager.py --email root@example.com --password 1234567890

# 指定特定 Agent
python multi_agent_manager.py --agent-ids agent-1 agent-2
```

### 工作流程

1. 登录后端获取 JWT 令牌
2. 获取 Agent 配置（system prompt、model 等）
3. 周期性发送心跳信号
4. 轮询新消息，检测 @ 提及
5. 构建上下文，调用 LLM 生成回复
6. 执行工具调用（表情、搜索等）
7. 发送回复消息

### Agent 模式

| 模式 | 说明 |
|------|------|
| **被动模式**（默认） | 仅在被 @ 提及时响应 |
| **主动模式** | 自动参与对话，可使用 `[SKIP]` 跳过 |

主动模式通过 `capabilities.answer_active: true` 启用。

### 内置工具

| 工具 | 格式 | 说明 |
|------|------|------|
| 表情反应 | `[REACT:👍:msg-id]` | 给消息添加表情 |
| 上下文检索 | `[GET_CONTEXT:msg-id]` | 获取消息周围 10 条消息 |
| 完整历史 | `[GET_LONG_CONTEXT]` | 获取最多 50 条历史消息 |
| 网络搜索 | `[WEB_SEARCH:关键词]` | DuckDuckGo 搜索 |
| 知识库查询 | `[LOCAL_RAG:查询]` | 检索本地 RAG 知识库 |

---

## GPT-OSS Harmony 格式

当使用 `parallax` provider（自托管 gpt-oss 模型）时，Agent 服务会自动启用 Harmony 格式进行 Function Calling。

### 自动检测

```python
# agent_service.py 中自动检测
if provider == "parallax":
    self._use_harmony_format = True
    print("[Agent] Harmony format enabled for GPT-OSS")
```

### Harmony 格式特点

- **特殊令牌**: `<|channel|>`, `<|message|>`, `<|call|>`, `<|return|>`, `<|end|>`
- **通道类型**: `analysis`（思考）、`commentary`（工具调用）、`final`（最终回复）
- **工具定义**: TypeScript namespace 风格

### 生成的系统提示词格式

```
You are ChatGPT, a large language model trained by OpenAI.
Knowledge cutoff: 2024-06
Current date: 2025-01-15

Reasoning: low

# Valid channels: analysis, commentary, final. Channel must be included for every message.
Calls to these tools must go to the commentary channel: 'functions'.

# Instructions
{你的系统提示词}

# Tools
## functions

namespace functions {

// Search the web for current information
type web_search = (_: {
// Search query
query: string,
}) => any;

// [MCP] Search for academic papers
type mcp_search_papers = (_: {
// Search query
query: string,
// Maximum results
limit?: number,
}) => any;

} // namespace functions
```

### 模型输出格式

```
<|channel|>analysis<|message|>用户在问天气，我需要调用搜索工具<|end|>
<|channel|>commentary to=functions.web_search <|constrain|>json<|message|>{"query":"北京天气"}<|call|>
```

### MCP 工具集成

MCP 工具会自动添加到 Harmony 格式中：
- 工具名添加 `mcp_` 前缀（如 `mcp_search_papers`）
- 描述添加 `[MCP]` 标记
- 参数自动转换为 Harmony 格式

详细说明参见 `GPT_OSS_FUNCTION_CALLING.md`。

---

## RAG 服务

基于 ChromaDB 的文档向量检索服务，为 Agent 提供知识库能力。

### 启动

```bash
pip install -r requirements-rag.txt
python rag_service.py --port 4001
```

### API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/rag/upload` | POST | 上传文档 |
| `/rag/search` | POST | 语义搜索 |
| `/rag/stats` | GET | 知识库统计 |
| `/rag/delete` | POST | 删除文档 |
| `/rag/clear` | POST | 清空知识库 |
| `/health` | GET | 健康检查 |

### 示例

```python
import requests

# 上传文档
requests.post("http://localhost:4001/rag/upload", json={
    "content": "文档内容...",
    "filename": "doc.txt"
})

# 搜索
requests.post("http://localhost:4001/rag/search", json={
    "query": "搜索关键词",
    "topK": 5
})
```

---

## MCP 研究服务器

基于 FastMCP 的学术论文搜索服务，支持 Semantic Scholar 和 arXiv。

### 启动

```bash
pip install -r requirements-mcp.txt

# SSE 模式（HTTP 访问）
python mcp_research_server.py --transport sse --port 3001

# 带认证
python mcp_research_server.py --transport sse --port 3001 --auth

# stdio 模式（Claude Desktop）
python mcp_research_server.py --transport stdio
```

### API Key 管理

```bash
# 生成 Key
python mcp_research_server.py --generate-keys 3

# 查看 Key
python mcp_research_server.py --list-keys
```

### 可用工具

| 工具 | 说明 |
|------|------|
| `search_papers` | Semantic Scholar 论文搜索 |
| `search_arxiv` | arXiv 预印本搜索 |
| `get_paper_details` | 论文详情（支持 arXiv ID、DOI） |
| `find_similar_papers` | 相似论文推荐 |
| `get_citations` | 获取引用该论文的文献 |
| `get_references` | 获取参考文献 |
| `search_author` | 作者搜索 |
| `fetch_webpage` | 网页内容抓取 |
| `format_citation` | 引用格式化（APA/MLA/BibTeX） |

### REST API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/tools/list` | GET | 列出工具 |
| `/tools/execute` | POST | 执行工具 |
| `/health` | GET | 健康检查 |

### 示例

```python
import requests

# 搜索论文
resp = requests.post("http://localhost:3001/tools/execute", json={
    "tool": "search_papers",
    "arguments": {"query": "transformer attention", "limit": 5}
})

# 获取论文详情
resp = requests.post("http://localhost:3001/tools/execute", json={
    "tool": "get_paper_details",
    "arguments": {"paper_id": "2103.14030"}
})
```

---

## 配置参考

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `API_BASE` | `http://localhost:4000` | 后端地址 |
| `AGENT_TOKEN` | `dev-agent-token` | Agent API 令牌 |
| `AGENT_ID` | `helper-agent-1` | Agent ID |
| `POLL_INTERVAL` | `1` | 轮询间隔（秒） |
| `HEARTBEAT_INTERVAL` | `5` | 心跳间隔（秒） |

### 前端配置

在 Web UI 的 Agent 配置中心设置：

| 设置项 | 说明 |
|--------|------|
| System Prompt | LLM 系统提示词 |
| Provider | `parallax` / `openai` / `azure` / `anthropic` |
| Model Name | 模型标识符 |
| Temperature | 响应随机性（0.0-2.0） |
| Max Tokens | 最大响应长度 |
| Endpoint | LLM API 端点（parallax 模式） |
| Reasoning Level | GPT-OSS 推理深度：`low` / `medium` / `high`（仅 parallax） |

#### Reasoning Level 说明

当使用 `parallax` provider 时，可以配置 Reasoning Level 控制模型思考深度：

| 级别 | 说明 |
|------|------|
| `low` | 快速响应，适合简单问答 |
| `medium` | 平衡模式，适合一般任务 |
| `high` | 深度思考，适合复杂推理 |

### Agent 能力

| 能力 | 说明 |
|------|------|
| `answer_passive` | 被 @ 时响应 |
| `answer_active` | 主动参与对话 |
| `like` | 表情反应 |
| `summarize` | 对话摘要 |

---

## API 参考

Agent 服务使用的后端端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/auth/login` | POST | 登录 |
| `/agents` | GET | 获取配置 |
| `/agents/:id/heartbeat` | POST | 心跳 |
| `/agents/:id/messages` | POST | 发送消息 |
| `/agents/:id/reactions` | POST | 添加表情 |
| `/agents/:id/looking` | POST | 查看状态 |
| `/agents/:id/context` | GET | 获取上下文 |
| `/agents/:id/long-context` | GET | 获取完整历史 |
| `/agents/:id/tools/web-search` | POST | 网络搜索 |
| `/agents/:id/tools/local-rag` | POST | 知识库查询 |
| `/messages` | GET | 获取消息 |

---

## 扩展开发

### 创建自定义 Agent

继承 `BaseAgentService` 并实现抽象方法：

```python
from base_agent import BaseAgentService

class MyCustomAgent(BaseAgentService):
    def _init_llm(self, config):
        # 初始化 LLM 客户端
        pass

    def build_system_prompt(self, mode, users):
        # 构建系统提示词
        base = self._build_base_system_prompt(mode, users)
        return base + "\n你是一个专业的助手..."

    def generate_reply(self, context, current_msg, mode, users):
        # 生成回复
        # 返回 (only_tools: bool, response_text: str)
        return False, "Hello!"
```

### 修改配置常量

```python
# 在 core/config.py 中修改
CONTEXT_LIMIT = 20  # 默认 10
POLL_INTERVAL = 2   # 默认 1
```

### 自定义 LLM

```python
from core import configure_llm, chat_with_history

configure_llm(base_url="https://your-endpoint/v1", api_key="your-key")
response = chat_with_history(messages, model="your-model")
```

### 添加自定义工具

工具使用统一定义架构，在 `core/tool_definitions.py` 中添加：

```python
# core/tool_definitions.py

TOOL_DEFINITIONS = {
    # ... 现有工具 ...

    "my_custom_tool": {
        "name": "my_custom_tool",
        "description": "自定义工具描述",
        "parameters": {
            "query": {
                "type": "string",
                "description": "查询参数",
            }
        },
        "enabled_key": "tools.my_custom_tool",  # 对应 config 中的 tools 列表
        "category": "custom",
        "text_format": "[MY_TOOL:query]",       # 文本格式
        "text_example": "[MY_TOOL:example query]",
        "usage_hint": "使用场景描述",
    },
}
```

格式化器会自动处理：
- **Harmony 格式**: 通过 `add_tools_to_harmony_builder()` 添加
- **Text 格式**: 通过 `build_tools_text_prompt()` 生成文档

### 统一工具定义架构

```
┌─────────────────────────────────────────────────────────────┐
│                    tool_definitions.py                       │
│                     (单一数据源)                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  TOOL_DEFINITIONS = {                                │    │
│  │    "web_search": { name, desc, params, ... },       │    │
│  │    "local_rag": { name, desc, params, ... },        │    │
│  │    "react": { name, desc, params, ... },            │    │
│  │  }                                                   │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐
│   tool_formatters.py  │       │   tool_formatters.py  │
│  (Harmony 格式)       │       │  (Text 格式)          │
│                       │       │                       │
│ add_tools_to_harmony_ │       │ build_tools_text_     │
│ builder()             │       │ prompt()              │
│                       │       │                       │
│ 输出: TypeScript      │       │ 输出: [TOOL:args]     │
│ namespace 风格        │       │ 文档风格              │
└───────────────────────┘       └───────────────────────┘
```

优势：
- **单一数据源**: 工具定义只需维护一处
- **格式自动转换**: Harmony 和 Text 格式使用相同定义
- **易于扩展**: 添加新工具只需更新 `TOOL_DEFINITIONS`

### Parallax Provider

兼容 OpenAI 的自定义端点：

1. Provider 选择 `parallax`
2. 设置 Endpoint URL
3. Model 默认 `default`
4. API Key 可选

---

## 日志示例

```
[Agent] 启动服务...
[Agent] API: http://localhost:4000
[Agent] Agent ID: helper-agent-1
----------------------------------------
[Agent] 收到 @ 消息: who are you...
[Agent] ===== 发送给模型的提示词 =====
[0] system: You are a helpful AI assistant...
[1] user: <Alice> [TO: YOU]: who are you
[Agent] ===== 提示词结束 =====
[Agent] 消息已发送: Hi! I'm your friendly AI assistant.
```