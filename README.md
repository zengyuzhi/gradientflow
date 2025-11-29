# GradientFlow

![GradientFlow Logo](./gradient_flow_logo_1764409055594.png)

> **打造你的专属 AI 实验室 | Gradient 黑客松参赛作品**
> 赛道 2：应用构建 (Building Applications)

[English](./README_HACKATHON_EN.md) | [中文](./README.md)

**GradientFlow** 是一个隐私优先的本地 AI 群聊平台，旨在为团队和个人提供安全、智能的协作体验。由 **Parallax** 驱动，它利用分布式本地计算来运行强大的 AI Agent，确保数据永远不会离开您的基础设施。

---

## 🚀 为什么选择 Parallax？

在 AI 时代，隐私和成本至关重要。**GradientFlow** 基于 **Local AI**（本地人工智能）理念构建：

-   **隐私优先**：利用 Parallax 的本地计算能力，所有聊天记录、文档和向量嵌入都存储在您自己的硬件上。绝无敏感数据发送至第三方 API。
-   **成本效益**：利用您现有的 GPU 资源（或通过 Parallax 使用消费级 GPU 集群）运行 LLM，彻底消除 Token 费用。
-   **低延迟**：本地推理确保了实时协作所需的极速响应。

我们使用 Parallax 托管我们的 **Python Agent 服务**，这使得在本地集群上并发运行多个专用 Agent（如 RAG、搜索、摘要生成器）成为可能。

---

## ✨ 核心功能

### 🤖 智能本地 Agent
-   **多 Agent 系统**：支持多个 Agent 同时运行（例如 `@Coder`, `@Writer`, `@Researcher`），全部由本地 LLM 驱动。
-   **RAG（检索增强生成）**：上传文档至您的本地知识库。Agent 可以利用 ChromaDB 检索您的私有数据并回答问题。
-   **网络搜索**：集成隐私保护搜索 (DuckDuckGo)，获取实时信息。

### 💬 现代聊天体验
-   **富文本支持**：完整的 Markdown 支持，代码高亮，以及 LaTeX 数学公式。
-   **交互式体验**：消息表情回应、引用回复以及 @提及功能。
-   **智能摘要**：一键生成长对话的 AI 摘要。
-   **实时同步**：输入状态指示器和实时消息更新。

### 🛡️ 安全 & 自托管
-   **完全掌控**：您拥有代码、数据和模型的所有权。
-   **身份认证**：安全的 JWT 登录系统。
-   **持久化存储**：所有聊天记录本地存储 (`lowdb`)。

---

## 🛠️ 系统架构

GradientFlow 由三个主要组件构成：

1.  **前端 (Frontend)**: React + Vite (现代 UI/UX)。
2.  **后端 (Backend)**: Express API (管理用户、消息、认证)。
3.  **AI 层 (Parallax)**: Python Agent 服务 + RAG 服务。
    -   *此层设计为部署在 Parallax 计算节点上。*

```mermaid
graph TD
    User[用户 / 浏览器] <--> Frontend[React 前端]
    Frontend <--> Backend[Express 服务器]
    Backend <--> DB[(本地 JSON 数据库)]
    
    subgraph "Parallax 计算节点"
        AgentMgr[多 Agent 管理器]
        RAG[RAG 服务 / ChromaDB]
        LLM[本地 LLM (Llama 3 / Mistral)]
        
        AgentMgr <--> LLM
        AgentMgr <--> RAG
    end
    
    Backend <--> AgentMgr
```

---

## ⚡ 快速开始

### 前置要求
-   Node.js 18+
-   Python 3.8+
-   运行中的 Parallax 节点（或本地 GPU 环境）

### 安装步骤

1.  **克隆仓库**
    ```bash
    git clone https://github.com/yourusername/parallax-chat.git
    cd parallax-chat
    ```

2.  **启动后端**
    ```bash
    npm install
    npm run server
    ```

3.  **启动 AI 服务 (Parallax 层)**
    ```bash
    cd agents
    pip install -r requirements.txt
    # 连接到您的本地 LLM 后端
    python multi_agent_manager.py
    ```

4.  **启动前端**
    ```bash
    # 新开一个终端窗口
    npm run dev
    ```

5.  **访问应用**
    打开浏览器访问 `http://localhost:5173` 并注册一个新账号。

---

## 📸 截图展示

*(在此处添加您的应用截图：登录界面、聊天界面、RAG 使用演示)*

---

## 🏆 黑客松核查清单

-   [x] **赛道**：应用构建 (Track 2: Building Applications)
-   [x] **技术栈**：React, Express, Python, Parallax (Local AI)
-   [x] **目标**：隐私保护的协作工具。

---

*Built with ❤️ for the Gradient Network Community.*
