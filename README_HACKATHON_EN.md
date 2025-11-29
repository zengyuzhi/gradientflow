# GradientFlow

![GradientFlow Logo](./gradient_flow_logo_1764409055594.png)

> **Build your own AI Lab | Gradient Hackathon Submission**
> Track 2: Building Applications

[English](./README_HACKATHON_EN.md) | [中文](./README.md)

**GradientFlow** is a privacy-first, local AI group chat platform designed to empower teams and individuals with secure, intelligent collaboration. Powered by **Parallax**, it leverages distributed local compute to run powerful AI agents without data ever leaving your infrastructure.

---

## 🚀 Why Parallax?

In the era of AI, privacy and cost are paramount. **GradientFlow** is built on the philosophy of **Local AI**:

-   **Privacy First**: By utilizing Parallax's local compute capabilities, all chat logs, documents, and vector embeddings reside on your own hardware. No sensitive data is sent to third-party APIs.
-   **Cost Efficiency**: Leverage your existing GPU resources (or a cluster of consumer GPUs via Parallax) to run LLMs, eliminating per-token costs.
-   **Low Latency**: Local inference ensures snappy response times for real-time collaboration.

We use Parallax to host our **Python Agent Service**, allowing multiple specialized agents (RAG, Search, Summarizer) to run concurrently on a local cluster.

---

## ✨ Key Features

### 🤖 Intelligent Local Agents
-   **Multi-Agent System**: Run multiple agents simultaneously (e.g., `@Coder`, `@Writer`, `@Researcher`) powered by local LLMs.
-   **RAG (Retrieval-Augmented Generation)**: Upload documents to your local Knowledge Base. Agents can retrieve and answer questions based on your private data using ChromaDB.
-   **Web Search**: Integrated privacy-focused search (DuckDuckGo) for real-time information.

### 💬 Modern Chat Experience
-   **Rich Text**: Full Markdown support, code highlighting, and LaTeX math.
-   **Interactive**: Message reactions, replies, and @mentions.
-   **Smart Summaries**: One-click AI summary of long conversation threads.
-   **Real-time**: Typing indicators and live updates.

### 🛡️ Secure & Self-Hosted
-   **Full Control**: You own the code, the data, and the model.
-   **Authentication**: Secure JWT-based login system.
-   **Persistent History**: All chats are stored locally (`lowdb`).

---

## 🛠️ Architecture

GradientFlow consists of three main components:

1.  **Frontend**: React + Vite (Modern UI/UX).
2.  **Backend**: Express API (Manages users, messages, auth).
3.  **AI Layer (Parallax)**: Python Agent Service + RAG Service.
    -   *This layer is designed to be deployed on a Parallax compute node.*

```mermaid
graph TD
    User[User / Browser] <--> Frontend[React Frontend]
    Frontend <--> Backend[Express Server]
    Backend <--> DB[(Local JSON DB)]
    
    subgraph "Parallax Compute Node"
        AgentMgr[Multi-Agent Manager]
        RAG[RAG Service / ChromaDB]
        LLM[Local LLM (Llama 3 / Mistral)]
        
        AgentMgr <--> LLM
        AgentMgr <--> RAG
    end
    
    Backend <--> AgentMgr
```

---

## ⚡ Quick Start

### Prerequisites
-   Node.js 18+
-   Python 3.8+
-   A running Parallax node (or local GPU environment)

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/yourusername/parallax-chat.git
    cd parallax-chat
    ```

2.  **Start the Backend**
    ```bash
    npm install
    npm run server
    ```

3.  **Start the AI Services (Parallax Layer)**
    ```bash
    cd agents
    pip install -r requirements.txt
    # Connects to your local LLM backend
    python multi_agent_manager.py
    ```

4.  **Start the Frontend**
    ```bash
    # New terminal
    npm run dev
    ```

5.  **Access the App**
    Open `http://localhost:5173` and register a new account.

---

## 📸 Screenshots

*(Add screenshots of your application here: Login screen, Chat interface, RAG usage)*

---

## 🏆 Hackathon Checklist

-   [x] **Track**: Building Applications (Track 2)
-   [x] **Tech Stack**: React, Express, Python, Parallax (Local AI)
-   [x] **Goal**: Privacy-focused collaboration tool.

---

*Built with ❤️ for the Gradient Network Community.*
