# Agent 服务

基于 Python 的多智能体服务，连接到聊天后端并智能响应 @ 提及，具备上下文感知能力。

## 目录

- [快速开始](#快速开始)
- [架构](#架构)
- [文件结构](#文件结构)
- [安装](#安装)
- [Agent 服务](#agent-服务)
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
                                          (parallax/openai/自定义)
```

---

## 文件结构

### 核心服务

| 文件 | 描述 |
|------|------|
| `agent_service.py` | Agent 服务（标准版）- 轮询、提及检测、上下文构建、LLM 调用 |
| `agent_service_sdk.py` | Agent 服务（SDK 版）- 基于 OpenAI Agents SDK，原生工具支持 |
| `multi_agent_manager.py` | 多 Agent 管理器（标准版）- 并发运行多个 agent |
| `multi_agent_manager_sdk.py` | 多 Agent 管理器（SDK 版）- 管理 SDK 版 agent |
| `rag_service.py` | RAG 服务 - 基于 ChromaDB 的文档向量检索 |
| `mcp_research_server.py` | MCP 研究服务器 - 学术论文搜索（FastMCP） |

### 辅助模块

| 文件 | 描述 |
|------|------|
| `tools.py` | 内置工具库 - 上下文检索、网络搜索、知识库查询 |
| `query.py` | LLM 客户端 - 处理与模型后端的通信 |

### 依赖文件

| 文件 | 描述 |
|------|------|
| `requirements.txt` | 基础依赖 |
| `requirements-rag.txt` | RAG 服务依赖（chromadb, flask） |
| `requirements-mcp.txt` | MCP 服务器依赖（fastmcp, feedparser） |

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

Agent 服务负责监听聊天消息并智能响应。提供两个版本：

### 标准版

```bash
# 单 Agent
python agent_service.py --agent-id helper-agent-1

# 多 Agent（推荐）
python multi_agent_manager.py --email root@example.com --password 1234567890

# 指定特定 Agent
python multi_agent_manager.py --agent-ids agent-1 agent-2
```

### SDK 版（实验性）

基于 OpenAI Agents SDK，支持原生函数工具调用和 MCP 集成：

```bash
# 单 Agent
python agent_service_sdk.py --agent-id helper-agent-1

# 多 Agent
python multi_agent_manager_sdk.py --email root@example.com --password 1234567890
```

**SDK 版特性：**
- 原生 `@function_tool` 装饰器
- 自动工具循环处理
- Harmony COT 格式解析
- MCP 工具动态集成

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

### 修改上下文窗口

```python
# agent_service.py
CONTEXT_LIMIT = 20  # 默认 10
```

### 自定义 LLM

```python
from query import configure, chat_with_history

configure(base_url="https://your-endpoint/v1", api_key="your-key")
response = chat_with_history(messages, model="your-model")
```

### 添加自定义工具

```python
# tools.py
import re

RE_MY_TOOL = re.compile(r"\[MY_TOOL:([^\]]+)\]")

def parse_tool_calls(response: str):
    result = {
        "my_tool": RE_MY_TOOL.findall(response),
        # ...
    }
    return result
```

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