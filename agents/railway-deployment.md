# Railway 部署指南

本指南介绍如何将 GradientFlow 的 RAG 服务和 Agent 服务部署到 Railway。

## 目录

- [前置要求](#前置要求)
- [架构概览](#架构概览)
- [部署 RAG 服务](#部署-rag-服务)
- [部署 Agent 服务](#部署-agent-服务)
- [配置后端连接](#配置后端连接)
- [常用命令](#常用命令)
- [故障排除](#故障排除)

---

## 前置要求

1. [Railway CLI](https://docs.railway.app/develop/cli) 已安装
2. Railway 账户已登录
3. 后端服务已部署并可访问

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login
```

---

## 架构概览

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Backend API    │────▶│  RAG Service    │
│   (Vercel等)    │     │  (Railway/其他) │     │  (Railway)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  Agent Service  │
                        │  (Railway)      │
                        └─────────────────┘
```

| 服务 | 说明 | 端口 |
|------|------|------|
| RAG Service | 基于 ChromaDB 的向量检索服务 | 动态 (Railway 分配) |
| Agent Service | 多 Agent 管理服务 | 动态 (Railway 分配) |

---

## 部署 RAG 服务

RAG 服务提供文档上传和语义检索功能。

### 1. 初始化项目

```bash
cd agents/rag
railway init
# 选择工作区
# 输入项目名称，如: GradientFlow-RAG
```

### 2. 创建持久化存储卷

ChromaDB 需要持久化存储来保存向量数据：

```bash
# 链接到服务
railway link

# 添加存储卷
railway volume add --mount-path /data

# 设置环境变量
railway variables --set "CHROMA_DB_PATH=/data/chroma_db"
```

### 3. 部署

```bash
railway up
```

### 4. 获取域名

```bash
railway domain
```

输出示例：`https://gradientflow-rag-production.up.railway.app`

### 5. 验证部署

```bash
curl https://your-domain.up.railway.app/health
```

预期响应：
```json
{"service": "rag", "status": "ok"}
```

### RAG 服务 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/rag/search` | POST | 语义搜索 `{"query": "...", "topK": 5}` |
| `/rag/upload` | POST | 上传文档 `{"content": "...", "filename": "..."}` |
| `/rag/stats` | GET | 知识库统计 |
| `/rag/delete` | POST | 删除文档 `{"doc_hash": "..."}` |
| `/rag/clear` | POST | 清空知识库 |

---

## 部署 Agent 服务

Agent 服务管理多个 AI Agent 并发运行。

### 1. 初始化项目

```bash
cd agents
railway init
# 选择工作区
# 输入项目名称，如: GradientFlow-Agents
```

### 2. 设置环境变量

```bash
railway variables --set "API_BASE=https://your-backend-url.com"
railway variables --set "AGENT_API_TOKEN=your-agent-token"
railway variables --set "AGENT_LOGIN_EMAIL=root@example.com"
railway variables --set "AGENT_LOGIN_PASSWORD=your-password"
```

或在 Railway Dashboard 中设置：

| 变量 | 说明 | 示例 |
|------|------|------|
| `API_BASE` | 后端 API 地址 | `https://api.example.com` |
| `AGENT_API_TOKEN` | Agent 认证令牌 | `your-secret-token` |
| `AGENT_LOGIN_EMAIL` | 登录邮箱 | `root@example.com` |
| `AGENT_LOGIN_PASSWORD` | 登录密码 | `your-password` |

### 3. 部署

```bash
railway up
```

### 4. 获取域名 (可选)

```bash
railway domain
```

### 5. 验证部署

```bash
curl https://your-domain.up.railway.app/health
```

预期响应：
```json
{
  "status": "running",
  "service": "agent-manager",
  "agents_running": 2,
  "api_base": "https://your-backend-url.com"
}
```

### Agent 服务 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 (状态、Agent 数量) |
| `/status` | GET | 详细 Agent 状态 |

### Agent 服务特性

- **自动启动**: 启动时自动加载所有活跃 Agent
- **热重载**: 每 3 秒同步一次，自动启动新 Agent、停止已删除的 Agent
- **自动重启**: Agent 崩溃后自动重启
- **心跳机制**: 定期向后端发送心跳

---

## 配置后端连接

部署完成后，更新后端环境变量以连接 RAG 服务：

### 本地开发

在项目根目录创建或编辑 `.env` 文件：

```env
# RAG Service (Railway)
RAG_SERVICE_URL=https://your-rag-domain.up.railway.app

# 其他配置
PORT=4000
JWT_SECRET=your-jwt-secret
AGENT_API_TOKEN=your-agent-token
```

### 生产环境

在后端部署平台设置环境变量：

```
RAG_SERVICE_URL=https://your-rag-domain.up.railway.app
```

---

## 常用命令

### 查看日志

```bash
railway logs
```

### 查看状态

```bash
railway status
```

### 打开 Dashboard

```bash
railway open
```

### 重新部署

```bash
railway up
```

### 查看环境变量

```bash
railway variables
```

### 设置环境变量

```bash
railway variables --set "KEY=value"
```

---

## 故障排除

### 1. RAG 服务返回 "Knowledge base is empty"

确保已创建存储卷并设置了正确的路径：

```bash
railway volume add --mount-path /data
railway variables --set "CHROMA_DB_PATH=/data/chroma_db"
railway up  # 重新部署
```

### 2. Agent 服务登录失败

检查环境变量是否正确：

```bash
railway variables
```

确保 `API_BASE` 可访问，`AGENT_LOGIN_EMAIL` 和 `AGENT_LOGIN_PASSWORD` 正确。

### 3. Agent 无法连接后端

1. 确认后端 URL 正确且可公开访问
2. 确认后端 CORS 配置允许 Railway 域名
3. 检查 `AGENT_API_TOKEN` 是否与后端配置一致

### 4. 部署超时

Railway 免费版有资源限制。如果部署超时：

1. 检查 `railway.toml` 中的 `healthcheckTimeout`
2. 确保依赖安装不会超时
3. 考虑升级 Railway 计划

### 5. 存储卷数据丢失

确保：
1. 存储卷已正确挂载
2. 应用使用 `/data` 路径存储数据
3. 不要删除存储卷

---

## 环境变量参考

### RAG 服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | Railway 分配 | 服务端口 |
| `CHROMA_DB_PATH` | `/data/chroma_db` | ChromaDB 存储路径 |

### Agent 服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | Railway 分配 | 健康检查端口 |
| `API_BASE` | `http://localhost:4000` | 后端 API 地址 |
| `AGENT_API_TOKEN` | `dev-agent-token` | Agent 认证令牌 |
| `AGENT_LOGIN_EMAIL` | `root@example.com` | 登录邮箱 |
| `AGENT_LOGIN_PASSWORD` | `1234567890` | 登录密码 |

---

## 文件结构

```
agents/
├── rag/                      # RAG 服务部署目录
│   ├── railway.toml          # Railway 配置
│   ├── Procfile              # 进程定义
│   ├── requirements.txt      # Python 依赖
│   └── rag_service.py        # RAG 服务代码
│
├── railway.toml              # Agent 服务 Railway 配置
├── Procfile                  # Agent 服务进程定义
├── requirements.txt          # Agent 服务依赖
├── agent_runner.py           # Agent 服务入口 (Railway)
├── multi_agent_manager.py    # 多 Agent 管理器
├── agent_service.py          # Agent 实现
└── core/                     # 核心模块
    ├── config.py             # 配置 (支持环境变量)
    ├── api_client.py         # API 客户端
    └── ...
```

---

## 更新部署

当代码有更新时，重新部署：

```bash
# RAG 服务
cd agents/rag
railway up

# Agent 服务
cd agents
railway up
```

或者连接 GitHub 仓库实现自动部署。
