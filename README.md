# Active LLM 群聊系统

一个基于 React + Vite 前端和 Express + lowdb 后端的智能群聊应用。支持用户认证、持久化消息、多 Agent 协作，以及集成 RAG 知识库检索和网络搜索功能。界面设计参考 Telegram/Discord，适合用作内部原型、演示项目，以及 "LLM 群聊" 实验。

> 项目包含一个 **Python Agent 服务** (`agents/`)，可连接真实的 LLM 后端。消息、用户和输入状态存储在本地 API 的 `server/data.json` 中。

---

## 功能特性

### 核心功能
- **用户认证**: 邮箱注册/登录，JWT 认证（httpOnly cookie + Bearer 令牌），DiceBear 头像
- **消息体验**: 支持 **Markdown** 的消息气泡、回复预览、@ 提及、表情反应、悬浮操作
- **实时同步**: 输入指示器（`/typing`）、消息轮询（`/messages`）
- **成员管理**: 频道占位 + 成员列表（在线状态、BOT 标识），移动端可折叠侧边栏
- **数据持久化**: 用户、消息、输入状态保存在 `server/data.json`

### 智能 Agent 功能
- **多 Agent 支持**: Python Agent 服务（`agents/`）支持多个 Agent 同时运行
- **@ 提及检测**: 自动响应用户的 @ 提及
- **心跳监控**: Agent 在线状态追踪
- **工具调用**: 支持上下文获取、网络搜索、知识库查询
- **级联消息删除**: 删除用户消息时自动删除 Agent 回复

### 高级功能
- **RAG 知识库**: 基于 ChromaDB 的向量检索服务（`agents/rag_service.py`）
- **网络搜索**: 集成 DuckDuckGo 搜索（无需 API 密钥）
- **虚拟化渲染**: 使用 react-virtuoso 高效处理大量消息历史
- **错误边界**: 渲染错误保护
- **网络状态监控**: 离线/在线状态检测

---

## 快速开始

### 环境要求
- Node.js 18+（推荐 18/20）
- npm 或兼容的包管理器
- Python 3.8+（用于 Agent 服务和 RAG 服务）

### 完整服务启动（4 个终端）

完整运行需要启动 4 个服务，建议按以下顺序：

```bash
# 终端 1: 后端 API 服务器
npm install              # 首次运行
npm run server           # http://localhost:4000

# 终端 2: RAG 知识库服务（推荐）
cd agents
pip install -r requirements-rag.txt  # 首次运行
python rag_service.py --port 4001    # http://localhost:4001

# 终端 3: Agent 服务
cd agents
pip install -r requirements.txt      # 首次运行
python multi_agent_manager.py --email root@example.com --password 1234567890

# 终端 4: 前端开发服务器
npm run dev              # http://localhost:5173
```

**启动顺序**: 后端 → RAG服务 → Agent服务 → 前端

### 最小化启动（仅前后端）

如果只需要基本聊天功能，不需要 AI Agent：

```bash
# 终端 1: 后端
npm run server

# 终端 2: 前端
npm run dev
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_URL` | `http://localhost:4000` | 前端 API 地址 |
| `PORT` | `4000` | 后端 API 端口 |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS 白名单（逗号分隔） |
| `JWT_SECRET` | - | JWT 签名密钥（生产必改） |
| `DB_PATH` | `server/data.json` | 数据存储路径 |
| `AGENT_API_TOKEN` | - | Agent API 认证令牌 |
| `RAG_SERVICE_URL` | `http://localhost:4001` | RAG 服务地址 |

### 建议体验流程
1. 注册或登录
2. 发送消息（尝试 **Markdown**）
3. 添加表情反应、引用回复
4. 输入 `@GPT-4` 或包含 `gpt` 触发 Bot
5. 缩小窗口测试响应式侧边栏

---

## 项目架构

```
groupchat/
├── src/                    # React 前端
│   ├── api/                # API 客户端
│   ├── components/         # UI 组件
│   ├── context/            # 状态管理（ChatContext, TypingContext）
│   ├── hooks/              # 自定义 Hooks
│   └── types/              # TypeScript 类型定义
├── server/                 # Express 后端
│   ├── server.js           # API 服务器
│   ├── data.json           # 数据存储（用户、消息、Agent配置）
│   └── chroma_rag_db/      # ChromaDB 向量数据库（自动创建）
└── agents/                 # Python Agent 服务
    ├── agent_service.py    # 单 Agent 服务
    ├── multi_agent_manager.py # 多 Agent 管理器
    ├── tools.py            # 工具库（解析工具调用）
    ├── query.py            # LLM 客户端（OpenAI/Azure/Anthropic）
    ├── rag_service.py      # RAG 向量检索服务（ChromaDB + Flask）
    ├── requirements.txt    # Agent 服务依赖
    └── requirements-rag.txt # RAG 服务依赖
```

---

## API 接口概览

### 认证
- `POST /auth/register` - 用户注册
- `POST /auth/login` - 用户登录
- `POST /auth/logout` - 用户登出
- `GET /auth/me` - 获取当前用户

### 消息
- `GET /messages` - 获取消息列表（支持分页、since 参数）
- `POST /messages` - 发送消息
- `DELETE /messages/:id` - 删除消息（级联删除回复）
- `POST /messages/:id/reactions` - 添加表情反应

### 用户
- `GET /users` - 获取所有用户

### Agent 配置
- `GET /agents` - 获取所有 Agent 配置
- `POST /agents/configs` - 创建 Agent
- `PATCH /agents/configs/:id` - 更新 Agent
- `DELETE /agents/configs/:id` - 删除 Agent

### Agent 运行时
- `POST /agents/:id/messages` - Agent 发送消息
- `POST /agents/:id/heartbeat` - Agent 心跳
- `POST /agents/:id/tools/web-search` - 网络搜索
- `POST /agents/:id/tools/local-rag` - 知识库查询

### 知识库
- `POST /knowledge-base/upload` - 上传文档
- `GET /knowledge-base/documents` - 获取文档列表
- `DELETE /knowledge-base/documents/:id` - 删除文档

---

## 技术栈

### 前端
- React 18 + TypeScript + Vite
- framer-motion（动画）、lucide-react（图标）、clsx（类名）
- react-virtuoso（虚拟列表）、react-markdown（Markdown 渲染）
- react-hot-toast（通知）、dayjs（日期处理）

### 后端
- Express + lowdb（JSON 文件存储）
- bcryptjs（密码加密）、jsonwebtoken（JWT）
- cookie-parser + cors（Cookie 和跨域处理）

### Agent 服务
- Python + requests + openai（LLM 客户端）
- ChromaDB + Flask（RAG 向量检索）

---

## 数据与重置

- **消息/用户存储**: `server/data.json`
- **知识库存储**: `server/chroma_rag_db/`（ChromaDB 向量数据库）
- **重置方法**:
  - 重置消息和用户：停止服务 → 删除 `server/data.json` → 重启
  - 重置知识库：停止服务 → 删除 `server/chroma_rag_db/` 目录 → 重启
- **生产建议**: 使用真实数据库、轮换 `JWT_SECRET`、添加 HTTPS、限流、日志监控

---

## 测试账户（仅开发环境）
- 邮箱: `root@example.com`
- 密码: `1234567890`

---

## 适用场景

- 需要 "开箱即用" 的聊天演示，包含登录、持久化和 LLM Bot
- 需要 React + TS + Vite + Express + lowdb 全栈脚手架，可接入真实后端/模型
- 产品讨论的交互式原型、工作坊演示

---

## 扩展方向

- 用 WebSocket/SSE 替换轮询以降低延迟
- 添加多频道/私聊模型（按 `channelId` 过滤）
- 实现 LLM 流式响应（边生成边显示）
- 添加多个不同性格/能力的 Agent
- 生产加固：HTTPS、安全 Cookie、限流、输入校验、日志告警
