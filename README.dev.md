# Active LLM 群聊系统 - 开发者文档

本文档聚焦于架构设计、数据契约和扩展开发指南，作为 README 的补充参考。

---

## 1. 项目结构与依赖

### 目录结构

```
openai-groupchat/
├── src/                        # React + TypeScript + Vite 前端
│   ├── api/
│   │   └── client.ts           # API 客户端封装（HTTP+JSON 通信层）
│   ├── components/
│   │   ├── MessageBubble/      # 消息组件（MessageContent, ReactionList 等）
│   │   ├── AuthScreen.tsx      # 认证页面
│   │   ├── Layout.tsx          # 主布局框架
│   │   ├── Sidebar.tsx         # 侧边栏（频道、成员列表）
│   │   ├── ChatSidebar.tsx     # 聊天信息侧边栏（内容、任务、参与者）
│   │   ├── MessageList.tsx     # 消息列表（虚拟化）
│   │   ├── MessageInput.tsx    # 消息输入框
│   │   ├── MessageStatus.tsx   # 消息状态指示器
│   │   ├── DateSeparator.tsx   # 日期分隔符
│   │   ├── AgentConfigPanel.tsx # Agent 配置面板
│   │   ├── AboutModal.tsx      # 关于模态框
│   │   ├── EmojiPicker.tsx     # 表情选择器
│   │   └── ErrorBoundary.tsx   # 错误边界
│   ├── context/
│   │   ├── ChatContext.tsx     # 全局聊天状态（useReducer）
│   │   ├── TypingContext.tsx   # 输入指示器状态（性能优化）
│   │   └── UsersLookupContext.tsx # 用户快速查询
│   ├── hooks/
│   │   ├── useNetworkStatus.ts # 网络状态监控
│   │   ├── useDevicePerformance.ts # 设备性能检测
│   │   └── useReducedMotion.ts # 减少动画偏好
│   ├── types/
│   │   └── chat.ts             # 共享 TS 类型定义
│   └── constants/
│       ├── animations.ts       # Framer Motion 动画配置
│       └── ui.ts               # UI 常量
│
├── server/
│   ├── server.js               # Express API 服务器（~1400 行）
│   ├── data.json               # 持久化数据（用户/消息/Agent）
│   └── chroma_rag_db/          # ChromaDB 向量数据库目录
│
├── agents/
│   ├── agent_service.py        # 核心 Agent 服务（轮询 + 响应）
│   ├── multi_agent_manager.py  # 多 Agent 并发管理器
│   ├── tools.py                # 工具库（上下文、搜索、RAG）
│   ├── query.py                # LLM 客户端（动态配置）
│   ├── rag_service.py          # RAG 向量检索服务（Flask + ChromaDB）
│   ├── requirements.txt        # Python 基础依赖
│   └── requirements-rag.txt    # RAG 服务依赖
│
└── 配置文件
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── CLAUDE.md
```

### 主要依赖

| 类别 | 依赖 |
|------|------|
| 前端框架 | React 18, TypeScript, Vite |
| UI 库 | framer-motion, lucide-react, clsx |
| 功能库 | react-virtuoso, react-markdown, react-hot-toast, dayjs |
| 后端 | Express, lowdb, bcryptjs, jsonwebtoken, cookie-parser, cors |
| Agent 服务 | Python requests, openai |
| RAG 服务 | chromadb, flask, flask-cors |

---

## 2. 数据模型 (`src/types/chat.ts`)

### User 用户
```typescript
interface User {
  id: string;
  name: string;
  avatar: string;
  isLLM: boolean;
  status: 'online' | 'offline' | 'busy';
  type?: 'human' | 'agent' | 'system';
  agentId?: string;           // 关联的 Agent ID
  email?: string;
  createdAt?: number;
}
```

### Agent 智能体
```typescript
interface Agent {
  id: string;
  userId?: string;            // 关联的用户 ID
  name: string;
  description?: string;
  avatar?: string;
  status?: 'active' | 'inactive';
  systemPrompt?: string;      // LLM 系统提示词
  capabilities?: AgentCapabilities;
  tools?: string[];           // 可用工具列表
  model?: AgentModelConfig;
  runtime?: AgentRuntimeConfig;
  createdAt?: number;
  updatedAt?: number;
}

interface AgentCapabilities {
  answer_active?: boolean;    // 主动参与对话
  answer_passive?: boolean;   // 仅响应 @ 提及
  like?: boolean;             // 添加表情反应
  summarize?: boolean;        // 生成摘要
}

interface AgentModelConfig {
  provider: string;           // openai, parallax, azure 等
  name: string;
  temperature?: number;       // 0-2
  maxTokens?: number;         // 64-16000
}

interface AgentRuntimeConfig {
  type: string;
  endpoint?: string;          // API 端点
  apiKeyAlias?: string;       // API 密钥别名
  proactiveCooldown?: number; // 主动响应冷却时间（秒）
}
```

### Message 消息
```typescript
interface Message {
  id: string;
  content: string;
  senderId: string;
  timestamp: number;
  reactions: Reaction[];
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  replyToId?: string;         // 回复的消息 ID
  mentions?: string[];        // @ 提及的用户/Agent ID
  metadata?: Record<string, unknown>;
  status?: MessageStatus;     // 消息发送状态
  editHistory?: MessageEditMetadata[]; // 编辑历史
  editedAt?: number;          // 最后编辑时间
}

interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

// 消息状态类型
type MessageStatus =
  | { type: 'sending' }
  | { type: 'sent'; sentAt: number }
  | { type: 'delivered'; deliveredAt: number }
  | { type: 'read'; readAt: number }
  | { type: 'failed'; error: string };

interface MessageEditMetadata {
  content: string;
  editedAt: number;
}
```

### ChatState 全局状态
```typescript
interface ChatState {
  currentUser: User | null;
  users: User[];
  agents: Agent[];
  messages: Message[];
  typingUsers: string[];
  replyingTo?: Message;
  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
}
```

---

## 3. 前端工作流程

### 认证与初始化 (`App.tsx`)
1. 挂载时调用 `/auth/me`
2. 成功则获取 `/users` + `/messages`，分发 `HYDRATE`
3. 失败则进入 `AuthScreen`

### 轮询机制
| 数据 | 间隔 | 说明 |
|------|------|------|
| 消息 | ~4 秒 | `GET /messages`（since 参数获取增量），合并去重 |
| 输入状态 | ~2.5 秒 | `GET /typing`，更新 `typingUsers` |

### 消息发送 (`MessageInput.tsx`)
1. 文本框自动增长，`Enter` 发送，`Shift+Enter` 换行
2. 轻量 @ 提及建议（实时计算，不持久化）
3. `POST /messages` 提交，分发 `SEND_MESSAGE`
4. API 响应可能包含更新的用户 → `SET_USERS`
5. 输入指示器：`POST /typing { isTyping: true/false }`

### 消息渲染 (`MessageList` / `MessageBubble`)
- **虚拟化列表**（`react-virtuoso`）高效处理大量消息
- 分组时间戳、回复预览、表情聚合、悬浮操作
- 支持 Markdown 渲染（`react-markdown`）

---

## 4. 组件职责

| 组件 | 职责 |
|------|------|
| `AuthScreen.tsx` | 登录/注册表单，调用 `/auth/register` + `/auth/login` |
| `Layout.tsx` | 整体框架，移动端顶栏切换侧边栏，离线横幅 |
| `Sidebar.tsx` | 频道占位、当前用户卡片、成员列表（在线状态 + BOT 标识） |
| `ChatSidebar.tsx` | 聊天信息侧边栏（内容标签页、任务标签页、参与者标签页、AI 摘要生成） |
| `MessageList.tsx` | 虚拟化滚动容器，自动滚动到最新，输入指示行，日期分隔符 |
| `MessageBubble/` | 消息组件目录 |
| ├─ `index.tsx` | 消息主容器 |
| ├─ `MessageContent.tsx` | Markdown 渲染 |
| ├─ `ReactionList.tsx` | 表情展示 |
| ├─ `ReactionPanel.tsx` | 表情反应面板（快速选择） |
| ├─ `ActionButtons.tsx` | 悬浮操作（回复、反应、删除） |
| ├─ `DeleteConfirmDialog.tsx` | 删除确认对话框 |
| └─ `ReplyContext.tsx` | 回复上下文 |
| `MessageInput.tsx` | 多行编辑器、回复标签、附件按钮、输入分发 |
| `MessageStatus.tsx` | 消息发送状态指示器（发送中、已发送、已送达、已读、失败） |
| `DateSeparator.tsx` | 日期分隔符（Today、Yesterday、日期格式） |
| `AgentConfigPanel.tsx` | Agent 配置 UI |
| `AboutModal.tsx` | 关于模态框（项目信息、功能特性） |
| `EmojiPicker.tsx` | 表情选择器 |
| `ErrorBoundary.tsx` | 捕获渲染错误，显示备用 UI |

### Context 职责

| Context | 职责 |
|---------|------|
| `ChatContext` | 全局状态管理，Actions: `HYDRATE`, `SET_AUTH_STATUS`, `SET_USERS`, `SET_MESSAGES`, `SEND_MESSAGE`, `DELETE_MESSAGE`, `SET_REPLY`, `UPDATE_REACTIONS` |
| `TypingContext` | 输入指示器状态（独立以避免重渲染） |
| `UsersLookupContext` | 用户快速查询（ID → User 映射） |

---

## 5. 后端概览 (`server/server.js`)

### 技术栈
- Express + lowdb（JSONFile 适配器）
- bcryptjs 密码哈希
- jsonwebtoken JWT
- cookie-parser + cors

### 存储
- 默认 `server/data.json`
- 启动时确保默认 Bot 用户存在

### 会话
- JWT 存储为 httpOnly Cookie
- 也支持 Authorization Bearer

### 环境变量
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4000` | API 端口 |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS 白名单（逗号分隔） |
| `JWT_SECRET` | - | JWT 签名密钥 |
| `DB_PATH` | `server/data.json` | 数据存储路径 |
| `AGENT_API_TOKEN` | - | Agent API 认证令牌 |
| `RAG_SERVICE_URL` | `http://localhost:4001` | RAG 服务地址 |

### API 路由

#### 认证
- `POST /auth/register` - 用户注册
- `POST /auth/login` - 用户登录
- `POST /auth/logout` - 用户登出
- `GET /auth/me` - 获取当前用户

#### 消息
- `GET /messages` - 获取消息列表（支持 `limit`, `before`, `since`, `conversationId`）
- `POST /messages` - 发送消息
- `POST /messages/summarize` - AI 生成对话摘要（SSE 流式响应）
- `DELETE /messages/:id` - 删除消息（级联删除回复）
- `POST /messages/:id/reactions` - 添加/切换表情反应

#### 用户
- `GET /users` - 获取所有用户

#### Agent 配置
- `GET /agents` - 获取所有 Agent 配置
- `GET /agents/configs` - 同上（别名）
- `POST /agents/configs` - 创建新 Agent
- `PATCH /agents/configs/:agentId` - 更新 Agent
- `DELETE /agents/configs/:agentId` - 删除 Agent

#### Agent 运行时 API（Token 认证）
- `POST /agents/:id/messages` - Agent 发送消息
- `POST /agents/:id/reactions` - Agent 添加表情
- `POST /agents/:id/heartbeat` - Agent 心跳信号
- `POST /agents/:id/looking` - Agent "查看" 状态
- `GET /agents/looking` - 查询活动 Agent
- `GET /agents/status` - 获取所有 Agent 状态

#### Agent 上下文工具
- `GET /agents/:id/context` - 获取消息周围上下文
- `GET /agents/:id/long-context` - 获取完整对话历史
- `GET /agents/:id/history` - 获取最近历史

#### 工具 API
- `POST /agents/:id/tools/web-search` - DuckDuckGo 搜索
- `POST /agents/:id/tools/local-rag` - 知识库查询

#### 知识库管理
- `POST /knowledge-base/upload` - 上传文档
- `GET /knowledge-base/documents` - 列出文档
- `DELETE /knowledge-base/documents/:id` - 删除文档

#### 输入状态
- `POST /typing` - 设置输入状态
- `GET /typing` - 查询输入状态

---

## 6. Agent 服务 (`agents/`)

### 核心服务 (`agent_service.py`)

Python 服务，桥接聊天后端与 LLM：

```bash
cd agents && pip install -r requirements.txt
python agent_service.py --email root@example.com --password 1234567890
```

#### 工作流程
1. 登录聊天后端（获取 JWT）
2. 启动心跳线程（每 5 秒）
3. 轮询 `/messages`（每 1 秒）
4. 检测 @ 提及（通过 `mentions` 字段或 `@AgentName`）
5. 构建上下文：最近 10 条消息，格式 `<Name: User>: content`
6. 调用 LLM，清理 `<think>` 标签和特殊 token
7. 通过 `/agents/:agentId/messages` 发送回复

#### 工具支持
| 工具 | 格式 | 说明 |
|------|------|------|
| 获取上下文 | `[GET_CONTEXT:msg_id]` | 获取消息周围上下文 |
| 完整历史 | `[GET_LONG_CONTEXT]` | 获取完整对话历史 |
| 网络搜索 | `[WEB_SEARCH:query]` | DuckDuckGo 搜索 |
| 知识库查询 | `[LOCAL_RAG:query]` | 本地向量检索 |
| 表情反应 | `[REACT:emoji:msg_id]` | 添加表情反应 |

#### 消息格式处理
- 方向标签：`[TO: YOU]`, `[TO: @Other]`, `[TO: everyone]`
- 特殊标签清理：`<think>`, `<|channel|>` 等
- 关键词提取

#### 配置参数
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `API_BASE` | `http://localhost:4000` | 聊天后端 |
| `AGENT_TOKEN` | `dev-agent-token` | 需匹配 `AGENT_API_TOKEN` 环境变量 |
| `AGENT_ID` | `helper-agent-1` | Agent 配置 ID |
| `AGENT_USER_ID` | `llm1` | Agent 用户 ID |
| `POLL_INTERVAL` | `1` | 消息轮询间隔（秒） |
| `HEARTBEAT_INTERVAL` | `5` | 心跳间隔（秒） |

### 多 Agent 管理器 (`multi_agent_manager.py`)

并发运行多个 Agent：

```bash
python multi_agent_manager.py --email root@example.com --password 1234567890
```

#### 特性
- 单次登录获取 JWT
- 自动获取所有 Agent 配置
- 并发线程运行每个 Agent
- 自动跳过非活跃 Agent
- 失败自动重启

### 工具库 (`tools.py`)

`AgentTools` 类提供：
- `get_context()` - 获取消息上下文
- `get_long_context()` - 获取完整历史
- `compress_context()` - 压缩对话历史
- `format_context_for_llm()` - LLM 格式化
- `web_search()` - 网络搜索
- `local_rag()` - 知识库查询
- `parse_tool_calls()` - 解析工具调用
- `remove_tool_calls()` - 清理工具标记

### LLM 客户端 (`query.py`)

动态配置，支持多种 Provider：
- `openai` - OpenAI API
- `azure` - Azure OpenAI
- `anthropic` - Anthropic Claude
- `parallax` - 自定义 OpenAI 兼容端点
- `custom` - 自定义端点

```python
from query import configure, chat_with_history

configure(provider="parallax", endpoint="http://localhost:8000/v1", model="gpt-4")
response = chat_with_history(messages, system_prompt="...")
```

---

## 7. RAG 服务 (`agents/rag_service.py`)

基于 ChromaDB 的向量检索服务：

```bash
cd agents
pip install -r requirements-rag.txt
python rag_service.py              # 默认端口 4001
python rag_service.py --port 5000  # 自定义端口
python rag_service.py --test       # 运行测试
```

### Flask API 端点
| 端点 | 说明 |
|------|------|
| `POST /rag/upload` | 上传文档 |
| `POST /rag/search` | 搜索查询 |
| `GET /rag/stats` | 知识库统计 |
| `POST /rag/delete` | 删除文档 |
| `POST /rag/clear` | 清空知识库 |
| `GET /health` | 健康检查 |

### ChromaDB 配置
| 配置 | 值 |
|------|-----|
| 存储位置 | `server/chroma_rag_db/` |
| 集合名 | `knowledge_base` |
| Embedding 模型 | `all-MiniLM-L6-v2`（自动） |
| 相似度度量 | Cosine |
| Chunk 大小 | 500 字符 |

### 工作流程
1. 用户上传文档 → `POST /knowledge-base/upload`
2. 后端转发至 RAG 服务
3. ChromaDB 分块 + 向量化
4. Agent 查询 → `[LOCAL_RAG:query]` → 语义搜索
5. 返回相关段落

---

## 8. 开发脚本与命令

```bash
# Node.js
npm install          # 安装依赖
npm run dev          # 启动前端开发服务器
npm run server       # 启动后端 API
npm run build        # 构建生产版本
npm run preview      # 预览生产构建
npm run lint         # 运行 ESLint
npm run test         # 运行 Vitest 测试

# Python Agent
cd agents
pip install -r requirements.txt
python agent_service.py       # 单 Agent
python multi_agent_manager.py # 多 Agent

# Python RAG
pip install -r requirements-rag.txt
python rag_service.py
```

### 数据重置
1. 停止所有服务
2. 删除 `server/data.json`
3. 重启服务（自动重建默认数据）

---

## 9. 关键设计模式

### 状态管理
- React Context + useReducer（ChatContext 中央管理）
- 分离 TypingContext 避免不必要的重渲染

### 性能优化
- 消息虚拟化（react-virtuoso）
- 消息去重和合并
- 设备性能检测（useDevicePerformance）

### 错误处理
- ErrorBoundary 组件
- 离线状态监控（useNetworkStatus）

### 动画
- Framer Motion 配置管理
- 减少动画偏好检测（useReducedMotion）

### Agent 工具执行
- 多轮工具调用：获取上下文 → 再次调用 LLM → 最终回复
- 支持标准格式和原生模型格式

---

## 10. 扩展建议

### 近期
- 用 WebSocket/SSE 替换轮询降低延迟
- 实现 LLM 流式响应（边生成边显示）
- 添加消息编辑历史

### 中期
- 添加多频道/私聊模型（按 `channelId` 过滤）
- 添加多个不同性格/能力的 Agent
- 文件附件上传

### 长期
- 生产加固：HTTPS、安全 SameSite Cookie、限流、输入校验
- 审计日志和监控
- 迁移至真实数据库（PostgreSQL/MongoDB）
