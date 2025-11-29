# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供项目开发指南。

## 项目概述

Active LLM 群聊系统 - 基于 React + TypeScript 前端和 Express + lowdb 后端的智能群聊应用。支持多 Agent 协作、RAG 知识库检索、网络搜索等功能，界面设计参考 Telegram/Discord。

## 总体原则

- 偏好小的、聚焦的改动，除非明确要求大规模重构
- 保持 UX 与现代聊天应用（含 LLM Bot）风格一致
- 遵循现有 React + TypeScript 风格，避免引入不必要的复杂模式
- 设计功能时考虑 LLM 友好性（清晰的 API、结构化 JSON、稳定契约）

## 快速启动（完整服务）

启动完整服务需要运行 4 个终端：

```bash
# 终端 1: 前端开发服务器
npm run dev

# 终端 2: 后端 API 服务器
npm run server

# 终端 3: RAG 知识库服务（可选，但推荐）
cd agents
pip install -r requirements-rag.txt  # 首次运行
python rag_service.py --port 4001

# 终端 4: Agent 服务
cd agents
pip install -r requirements.txt  # 首次运行
python multi_agent_manager.py --email root@example.com --password 1234567890
```

**启动顺序**: 后端 → RAG服务 → Agent服务 → 前端

## 开发命令

### 前端 (React + Vite)
```bash
npm run dev          # 启动开发服务器 http://localhost:5173
npm run build        # 构建生产版本
npm run preview      # 预览生产构建
npm run lint         # 运行 ESLint
npm run test         # 运行 Vitest 测试
```

### 后端 (Express)
```bash
npm run server       # 启动 API 服务器 http://localhost:4000
```

### Agent 服务 (Python)
```bash
cd agents
pip install -r requirements.txt
python multi_agent_manager.py --email root@example.com --password 1234567890
```

### RAG 服务 (Python - ChromaDB)
```bash
cd agents
pip install -r requirements-rag.txt  # chromadb, flask, flask-cors
python rag_service.py --port 4001    # 启动 http://localhost:4001
python rag_service.py --test         # 运行快速测试
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_URL` | `http://localhost:4000` | 前端 API 地址 |
| `PORT` | `4000` | 后端端口 |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS 白名单（逗号分隔） |
| `JWT_SECRET` | - | JWT 签名密钥（生产必改） |
| `DB_PATH` | `server/data.json` | 数据存储路径 |
| `AGENT_API_TOKEN` | - | Agent API 认证令牌 |
| `RAG_SERVICE_URL` | `http://localhost:4001` | RAG 服务地址 |

## 架构与关键模式

### 前端架构
- **状态管理**: `ChatContext` (React Context + useReducer) 中央管理
- **性能优化**: `TypingContext` 独立管理输入状态，避免重渲染
- **API 通信**: 统一通过 `src/api/client.ts`
- **消息渲染**: react-virtuoso 虚拟化滚动
- **实时更新**: 轮询机制（消息 ~4s，输入状态 ~2.5s）

### 后端架构
- **技术栈**: Express + lowdb (JSON 存储)
- **认证**: JWT (httpOnly Cookie + Bearer 令牌)
- **数据存储**: `server/data.json`

### Agent 服务
- **核心**: `agents/agent_service.py` - 轮询消息、检测 @ 提及、调用 LLM
- **多 Agent**: `agents/multi_agent_manager.py` - 并发管理多个 Agent
- **工具库**: `agents/tools.py` - 上下文获取、网络搜索、RAG 查询
- **LLM 客户端**: `agents/query.py` - 支持 OpenAI/Azure/Anthropic/自定义端点

### RAG 服务
- **技术栈**: Flask + ChromaDB
- **功能**: 文档上传、向量化、语义检索
- **存储**: `server/chroma_rag_db/`

## API 路由概览

### 认证
- `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me`

### 消息
- `GET /messages` - 获取消息（支持 since、limit、conversationId）
- `POST /messages` - 发送消息
- `DELETE /messages/:id` - 删除消息（级联删除回复）
- `POST /messages/:id/reactions` - 表情反应

### Agent
- `GET /agents` - 获取配置
- `POST /agents/configs` - 创建 Agent
- `PATCH /agents/configs/:id` - 更新 Agent
- `POST /agents/:id/messages` - Agent 发送消息
- `POST /agents/:id/heartbeat` - 心跳
- `POST /agents/:id/tools/web-search` - 网络搜索
- `POST /agents/:id/tools/local-rag` - 知识库查询

### 知识库
- `POST /knowledge-base/upload` - 上传文档
- `GET /knowledge-base/documents` - 列出文档
- `DELETE /knowledge-base/documents/:id` - 删除文档

## 关键类型定义 (src/types/chat.ts)

- `User`: 包含 type (human/agent/system)、agentId
- `Agent`: 包含 capabilities、model、runtime、systemPrompt、tools
- `Message`: 包含 role、conversationId、reactions、mentions、replyToId
- `ChatState`: 全局状态（currentUser、users、agents、messages、typingUsers）

## 前端开发指南

### UI 风格
- **动画**: 流畅但快速，避免过长或分散注意力的过渡
- **视觉**: 极简风格，高质量细节（微妙阴影、渐变、悬浮状态）
- **布局**: 保持简洁，注重微交互和间距
- **组件**: 保持聚焦和可复用，跨领域逻辑抽取到 hooks

### 文件结构
- 组件: `src/components/`
- Hooks: `src/hooks/`
- 类型: `src/types/`
- API: `src/api/`
- 常量: `src/constants/`
- Context: `src/context/`

## 后端开发指南

- 设计 LLM 友好的功能（清晰 API、结构化 JSON、稳定契约）
- 保持聊天室逻辑对 LLM Bot 友好（可预测的消息结构、工具元数据）
- 避免破坏现有 API 契约，除非与前端协调

## 重要实现说明

1. **消息虚拟化**: MessageList 使用 react-virtuoso 处理大量消息历史
2. **Markdown 支持**: react-markdown 渲染消息内容
3. **输入指示器**: 轮询 + TTL 清理机制
4. **回复系统**: 通过 replyToId 引用其他消息
5. **表情反应**: 聚合反应 + 用户追踪
6. **错误边界**: ErrorBoundary 组件捕获渲染错误
7. **网络状态**: 离线/在线检测 + 横幅通知
8. **Agent 工具**: 支持 [GET_CONTEXT]、[WEB_SEARCH]、[LOCAL_RAG]、[REACT] 等

## 测试账户（仅开发环境）

- 邮箱: `root@example.com`
- 密码: `1234567890`

## 数据重置

1. 停止所有服务
2. 删除 `server/data.json`
3. 重启服务（自动重建默认数据）

## 当前功能状态

### 已完成
- 用户认证（注册/登录/登出）
- 消息收发、回复、表情反应
- Agent 配置管理 UI
- 多 Agent 并发运行
- Agent 心跳追踪
- 网络搜索工具（DuckDuckGo）
- RAG 知识库服务（ChromaDB）
- 消息虚拟化渲染
- 错误边界和网络状态监控

### 扩展方向
- WebSocket/SSE 替换轮询
- LLM 流式响应
- 多频道/私聊模型
- 消息编辑历史
