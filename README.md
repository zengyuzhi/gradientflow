# GradientFlow

<img src="./gradient_flow_logo_1764409055594.png" alt="GradientFlow Logo" width="200">

> **🏆 打造你的专属 AI 实验室 | Gradient 黑客松参赛作品**
>
> **赛道 2：应用构建 (Building Applications)**

[English](./README_HACKATHON_EN.md) | [中文](./README.md)

[![GitHub](https://img.shields.io/badge/GitHub-代码仓库-blue?logo=github)](https://github.com/yourusername/gradientflow)
[![Parallax](https://img.shields.io/badge/Powered%20by-Parallax-green)](https://github.com/GradientHQ/parallax)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

---

## 📸 产品演示

<img src="./GradientBoard.png" alt="GradientFlow Demo" width="800">

<video src="./assets/GradientFlow_Demo2.mp4" controls width="800"></video>

*如果视频无法播放，请[点击此处下载](./assets/GradientFlow_Demo2.mp4)*

**更多截图**: [RAG 知识库](#rag-知识库--ai-摘要) | [智能文档分析](#智能文档分析) | [Agent 配置](#agent-配置--mcp-工具)

---

## 🔗 链接

- **在线演示**: [gradientflow-chat-production.up.railway.app](https://gradientflow-chat-production.up.railway.app/)
- **小红书**: [GradientFlow](http://xhslink.com/o/1CF3tnSUnuE)
- **Parallax**: [github.com/GradientHQ/parallax](https://github.com/GradientHQ/parallax)

---

## 🎯 什么是 GradientFlow？

**GradientFlow** 是一个隐私优先、AI 原生的本地 Workspace 平台，旨在为团队和个人提供安全、智能的协作体验。由 [**Parallax**](https://github.com/GradientHQ/parallax) 驱动，它利用分布式本地计算来运行强大的 AI Agent，确保数据永远不会离开您的基础设施。

### 💡 我们解决的问题

| 挑战 | 云端 AI 方案 | GradientFlow + Parallax |
|------|-------------|------------------------|
| **数据隐私** | 敏感数据发送至第三方服务器 | 所有数据留在您自己的硬件上 |
| **成本** | 按 Token 计费，费用快速累积 | 部署后零推理成本 |
| **延迟** | 网络往返增加延迟 | 本地推理 = 即时响应 |
| **控制权** | 供应商锁定，模型下线风险 | 您拥有模型和基础设施 |
| **上下文理解** | 每次对话都是独立的，缺乏连贯性 | 精细的 Context Engineering，理解对话历史、@提及和引用关系 |
| **交互模式** | 传统 Bot 只能被动回答问题 | Agent 可主动参与讨论、筛选相关信息、适时插入观点 |

---

## 🔌 Parallax 深度集成

[**Parallax**](https://github.com/GradientHQ/parallax) 是 GradientFlow 的 AI 核心引擎。我们不只是调用 API，而是将 Parallax 深度嵌入到整个架构中。

### 集成方式

| 组件 | Parallax 作用 | 技术细节 |
|------|--------------|---------|
| **多 Agent 管理器** | 在 Parallax 节点上并发运行多个 Agent | Python 服务部署于 Parallax 计算节点 |
| **RAG 知识库** | 本地向量检索，数据不外传 | ChromaDB + Parallax 本地推理 |
| **LLM 推理** | 零 Token 费用的本地模型 | 支持 Llama 3 / Mistral / Qwen 等 |
| **工具执行** | 网络搜索、MCP 协议等工具链 | 分布式任务调度 |

### 系统架构

```mermaid
graph TD
    User["用户 / 浏览器"] <--> Frontend["React 前端"]
    Frontend <--> Backend["Express 服务器"]
    Backend <--> DB[("本地 JSON 数据库")]

    subgraph "🔌 Parallax 计算节点"
        AgentMgr["多 Agent 管理器"]
        RAG["RAG 服务 / ChromaDB"]
        MCP["MCP 工具服务"]
        LLM["本地 LLM"]

        AgentMgr <--> LLM
        AgentMgr <--> RAG
        AgentMgr <--> MCP
    end

    Backend <--> AgentMgr
```

### Parallax 带来的优势

-   **隐私优先**：所有聊天记录、文档和向量嵌入都存储在您自己的硬件上
-   **成本效益**：利用 Parallax 调度消费级 GPU 集群，彻底消除 Token 费用
-   **低延迟**：本地推理确保毫秒级响应
-   **可扩展性**：随时向 Parallax 集群添加更多节点

---

## ✨ 核心功能

### 🤖 智能本地 Agent `🔌 Parallax 驱动`

-   **多 Agent 系统**：支持多个 Agent 同时运行（`@Assistant`, `@Writer`, `@Researcher`），全部由 Parallax 本地 LLM 驱动
-   **Agent 选择器**：下拉菜单选择在线 Agent，支持键盘导航
-   **RAG 检索增强生成** `🔌`：上传文档至本地知识库，Agent 利用 ChromaDB 检索私有数据
-   **网络搜索** `🔌`：集成 DuckDuckGo 隐私搜索，通过 Parallax 节点执行
-   **MCP 集成** `🔌`：通过 FastMCP 支持 Model Context Protocol，扩展工具能力
-   **顺序工具调用**：支持多轮工具的顺序执行
-   **最大轮次控制**：可配置 Agent 响应的最大轮次

### 💬 现代聊天体验

-   **智能上下文管理**：精细调优的 Context Engineering，Agent 能准确理解对话历史、引用关系和 @提及
-   **富文本支持**：Markdown、代码高亮、LaTeX 数学公式
-   **交互式体验**：消息表情回应、引用回复、@提及
-   **智能摘要** `🔌`：一键生成长对话的 AI 摘要
-   **实时同步**：输入状态指示器和实时消息更新
-   **LLM 设置**：可配置 LLM 端点、模型和 API Key

### 🛡️ 安全 & 自托管

-   **完全掌控**：您拥有代码、数据和模型的所有权
-   **身份认证**：安全的 JWT 登录系统
-   **持久化存储**：所有聊天记录本地存储 (`lowdb`)

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
    # 连接到您的 Parallax 节点
    python multi_agent_manager.py
    ```

4.  **启动前端**
    ```bash
    npm run dev
    ```

5.  **访问应用**
    打开浏览器访问 `http://localhost:5173`

---

## 📷 更多截图

### RAG 知识库 + AI 摘要
<img src="./assets/image1.png" alt="RAG Knowledge Base" width="800">

### 智能文档分析
<img src="./assets/image2.png" alt="Document Analysis" width="800">

### Agent 配置 + MCP 工具
<img src="./assets/image3.png" alt="Agent Configuration" width="800">

---

## 📄 开源协议

MIT License - 详见 [LICENSE](./LICENSE)

---

*Built with ❤️ for the Gradient Network Community.*

**#BuildYourOwnAILab #Parallax #GradientNetwork**
