# AI 智能体集成方案

> **目标**：让 Agent 像真实用户一样在群聊中参与对话（发消息、引用回复、点赞、总结），同时将能力抽象为通用工具层，支持多种大模型与 Agent 框架复用。

---

## Part 1: 概述

### 1.1 项目背景

在现有「多人群聊 + 机器人」架构基础上，引入真正的大模型（LLM）和统一的 Agent 框架，实现：

- **主动/被动回答**：Agent 可被 @ 触发，也可根据上下文主动插话
- **引用回复**：针对特定消息进行回复
- **点赞/反应**：对消息添加表情反应
- **对话总结**：自动或按需生成聊天摘要

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| **Agent 是一级参与者** | 拥有独立身份、头像、角色，行为与真人用户一致 |
| **工具层抽象** | 所有 Agent 行为通过 Chat Tool API 完成，不写死在业务逻辑中 |
| **运行时可插拔** | 支持 Function Calling、MCP、LangChain 等多种运行时 |
| **配置驱动** | 用户可在前端配置 Agent，后端自动注册并加入群聊 |

### 1.3 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              前端 (React)                                │
├─────────────────────────────────────────────────────────────────────────┤
│  ChatContext    │   MessageList   │   MessageInput   │  AgentConfigPage │
│  (状态管理)      │   (消息展示)     │   (@/命令输入)    │   (Agent配置)    │
└────────┬────────┴────────┬────────┴────────┬─────────┴────────┬────────┘
         │                 │                 │                  │
         └─────────────────┴────────┬────────┴──────────────────┘
                                    │ HTTP/SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           后端 (Express)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │   REST API  │───▶│ AgentManager│───▶│  LLM Client │                 │
│  │  /messages  │    │ (事件分发)   │    │ (模型调用)   │                 │
│  │  /agents    │    └──────┬──────┘    └──────┬──────┘                 │
│  └─────────────┘           │                  │                         │
│                            ▼                  ▼                         │
│                   ┌─────────────────────────────────┐                   │
│                   │        ToolRegistry             │                   │
│                   │  ┌──────────┐ ┌──────────────┐  │                   │
│                   │  │send_msg  │ │react_to_msg  │  │                   │
│                   │  │reply_to  │ │get_history   │  │                   │
│                   │  │get_context│ │get_long_ctx │  │                   │
│                   │  └──────────┘ └──────────────┘  │                   │
│                   └─────────────────────────────────┘                   │
│                                    │                                    │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
             ┌──────────┐     ┌──────────┐     ┌──────────┐
             │  OpenAI  │     │ Anthropic│     │   MCP    │
             │ Provider │     │ Provider │     │ Provider │
             └──────────┘     └──────────┘     └──────────┘
```

**数据流**：
1. 用户发消息 → REST API 保存 → 触发 AgentManager.onEvent()
2. AgentManager 判断是否触发 Agent → 构建上下文 → 调用 LLM Client
3. LLM 返回 tool_calls → ToolRegistry 执行 → 结果写入数据库
4. 前端轮询/SSE 获取新消息

---

## Part 2: 核心设计

### 2.1 领域模型

#### Message（消息）

```typescript
interface Message {
  id: string;
  content: string;
  senderId: string;
  timestamp: number;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';

  // 扩展字段
  replyToId?: string;           // 引用的消息 ID
  mentions?: string[];          // @ 提及的用户 ID
  reactions: Reaction[];        // 表情反应
  metadata?: Record<string, unknown>;
}

interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}
```

#### User / Participant（用户/参与者）

```typescript
interface User {
  id: string;
  name: string;
  avatar: string;
  type: 'human' | 'agent' | 'system';
  status: 'online' | 'offline' | 'busy';
  agentId?: string;  // 关联的 Agent 配置
}
```

#### Agent（智能体配置）

```typescript
interface Agent {
  id: string;
  userId?: string;              // 关联的 User 身份
  name: string;
  description?: string;
  avatar?: string;
  status: 'active' | 'inactive';

  // 核心配置
  systemPrompt?: string;
  capabilities: AgentCapabilities;
  tools: string[];              // 可用工具列表
  triggers: AgentTrigger[];     // 触发规则

  // 模型配置
  model: {
    provider: string;           // openai / anthropic / azure
    name: string;               // gpt-4o / claude-3
    temperature?: number;
    maxTokens?: number;
  };

  // 运行时配置
  runtime: {
    type: string;               // internal / langchain / mcp
    endpoint?: string;
    apiKeyAlias?: string;
  };

  // 限流
  rateLimit?: {
    callsPerMinute: number;
    maxTokensPerCall: number;
  };
}

interface AgentCapabilities {
  answer_active: boolean;       // 主动回答
  answer_passive: boolean;      // 被动回答（@ 触发）
  like: boolean;                // 点赞能力
  summarize: boolean;           // 总结能力
}

interface AgentTrigger {
  eventType: 'message_created' | 'summary_requested' | 'mention';
  matchRules: {
    keywords?: string[];
    isQuestion?: boolean;
    targetAgentId?: string;
  };
  mode: 'rule_only' | 'llm_classification';
}
```

#### AgentEvent（Agent 事件）

```typescript
interface AgentEvent {
  type: 'message_created' | 'reaction_added' | 'summary_requested';
  roomId: string;
  message?: Message;
  actor: User;
  timestamp: number;
  conversationWindow?: Message[];  // 最近 N 条消息
}
```

### 2.2 Chat Tool API

> **核心思想**：所有 Agent 行为（发消息、点赞、查历史等）都通过工具完成，便于 Function Calling 和 MCP 统一复用。

#### 工具定义模型

```typescript
interface ToolDefinition {
  name: string;                 // 如 'chat.send_message'
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  scope: 'server' | 'client';
}

interface ToolRegistry {
  registerTool(def: ToolDefinition, impl: Function): void;
  listTools(): ToolDefinition[];
  invoke(toolName: string, args: unknown, ctx: Context): Promise<ToolResult>;
}
```

#### 核心工具列表

| 工具名 | 入参 | 说明 |
|--------|------|------|
| `chat.send_message` | `{ roomId, content, replyToMessageId? }` | 发送消息，可选引用 |
| `chat.reply_to_message` | `{ roomId, targetMessageId, content }` | 引用回复特定消息 |
| `chat.react_to_message` | `{ roomId, messageId, emoji }` | 添加表情反应 |
| `chat.get_recent_history` | `{ roomId, limit }` | 获取最近 N 条消息 |
| `chat.get_message_context` | `{ roomId, messageId, before, after }` | 获取某消息前后上下文 |
| `chat.get_long_context` | `{ roomId, maxMessages? }` | 获取长上下文（摘要+近期） |
| `chat.get_room_participants` | `{ roomId }` | 获取房间参与者 |

### 2.3 Agent 行为设计

#### 被动回答（用户触发）

```
触发方式：
├── @ 提及：@助手名 你好
├── / 命令：/ai 帮我解释一下
└── 消息按钮：点击消息上的「问 AI」按钮

处理流程：
用户发送 @Agent 消息
    ↓
服务器解析 mentions/targetAgentId
    ↓
AgentManager 直接路由到对应 Agent（跳过触发判断）
    ↓
构建上下文 + 调用 LLM
    ↓
执行 tool_calls → 发送回复
```

#### 主动回答（Agent 自动插话）

```
处理流程：
每条 message_created 事件
    ↓
规则判断（疑问句？关键词？未被回复？）
    ↓
可选：LLM 分类（should_answer: true/false）
    ↓
通过 → 构建上下文 + 调用 LLM
    ↓
执行 tool_calls → 发送回复

节流策略：
- 同一房间内，Agent 主动插话间隔 ≥ 30 秒
- 同一用户的问题，避免重复回答
```

#### 主动点赞

```
处理流程：
message_created 事件
    ↓
规则/LLM 判断 should_like（有趣？有帮助？优质内容？）
    ↓
调用 chat.react_to_message({ emoji: '👍' })
```

### 2.4 上下文构建策略

> **核心问题**：聊天历史是作为工具结果返回给 LLM，还是直接注入到 prompt？

#### 推荐方案：混合模式

```
┌────────────────────────────────────────────────────────────┐
│  触发时直接注入基础上下文（最近 10-20 条）                    │
│  → 减少不必要的 tool call 往返                              │
└────────────────────────────────────────────────────────────┘
                              +
┌────────────────────────────────────────────────────────────┐
│  Agent 需要更多信息时，主动调用工具获取                      │
│  → chat.get_message_context / chat.get_long_context        │
└────────────────────────────────────────────────────────────┘
```

| 场景 | 策略 |
|------|------|
| 常规触发（被 @、关键词） | 直接注入最近 10-20 条到 prompt |
| 点击"问 AI"按钮 | 注入目标消息 + 前后 5 条上下文 |
| Agent 需要更多信息 | 提供 `get_long_context` 工具按需调用 |
| 总结任务 | 调用 `get_long_context` 获取摘要+近期消息 |

#### Prompt 结构示例

```typescript
const messages = [
  {
    role: 'system',
    content: `你是群聊助手「小助」。

当前房间参与者：
- Alice (human)
- Bob (human)
- 你 (assistant)

你可以使用以下工具：
- chat.send_message: 发送消息
- chat.react_to_message: 点赞/反应
- chat.reply_to_message: 引用回复`
  },
  // 直接注入最近对话
  { role: 'user', content: '[Alice]: 大家觉得这个方案怎么样？' },
  { role: 'user', content: '[Bob]: 我觉得还行，但有个问题...' },
  { role: 'user', content: '[Alice]: @小助 你怎么看？' },
  // 行动指令
  { role: 'user', content: '你被 @提及了，请决定如何回应。' }
];
```

#### 为什么不推荐纯工具方式

```
纯工具方式的问题：
User 发消息 → 触发 Agent（此时 Agent 什么都不知道）
                    ↓
              必须先调用 get_recent_history  ← 额外一轮 API
                    ↓
              拿到结果后再决策
                    ↓
              再调用 send_message 回复       ← 又一轮

问题：
- 多一轮 API 调用，延迟 +1-2 秒
- Token 消耗更多
- Agent 可能"忘记"调用工具
```

---

## Part 3: 后端实现

### 3.1 LLM Client 封装

**文件**：`server/llm/client.ts`

```typescript
interface LLMClient {
  // 聊天回复（支持 tool_calls）
  chat(params: {
    messages: ChatMessage[];
    systemPrompt?: string;
    tools?: ToolDefinition[];
    temperature?: number;
  }): Promise<ChatResponse>;

  // 简单分类（用于触发判断）
  classify(params: {
    message: string;
    labels: string[];
  }): Promise<{ label: string; confidence: number }>;

  // 对话总结
  summarize(params: {
    messages: Message[];
    maxLength?: number;
  }): Promise<string>;
}
```

**支持的 Provider**：
- `OpenAIProvider`：OpenAI / Azure OpenAI
- `AnthropicProvider`：Claude 系列
- `CustomHTTPProvider`：自定义 HTTP 端点

**配置**：
```env
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4o-mini
```

### 3.2 AgentManager

**文件**：`server/agents/AgentManager.ts`

#### 触发判断策略

> **核心问题**：如何判断 Agent 是否应该响应某条消息？

**方案对比**：

| 方案 | 实现 | 延迟 | 成本 | 适用场景 |
|------|------|------|------|----------|
| **规则优先** | 正则/关键词匹配 | ~0ms | 免费 | MVP 阶段 |
| **轻量 LLM 分类** | 单独调一次小模型 | +200-500ms | 低 | 需要精细控制 |
| **主 LLM 自决策** | 让 Agent 自己决定要不要回复 | 0 额外 | 包含在主调用中 | 推荐方案 |

**推荐：规则 + 主 LLM 自决策**（不加额外 LLM 调用）

```
┌─────────────────────────────────────────────────────────────┐
│                    message_created 事件                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  第一层：规则快速过滤（免费、即时）                            │
│  ├── 被 @ 提及？ → 必须触发                                  │
│  ├── 是 Agent 自己发的？ → 跳过（避免自我循环）               │
│  ├── 最近 30 秒内已回复过？ → 跳过（节流）                    │
│  └── 通过 → 进入下一层                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  第二层：主 LLM 自决策（不额外调用）                          │
│  把"是否回复"的决定权交给 Agent 本身                         │
│  → 在 system prompt 中说明：你可以选择不回复                  │
│  → Agent 返回 [NO_RESPONSE] 或空内容 = 不回复                │
└─────────────────────────────────────────────────────────────┘
```

#### 实现代码

```typescript
class AgentManager {
  private agents: Map<string, Agent>;
  private toolRegistry: ToolRegistry;
  private llmClient: LLMClient;
  private replyTimestamps: Map<string, number> = new Map(); // 节流记录

  // 加载所有 Agent 配置
  async loadAgents(): Promise<void>;

  // 获取 Agent
  getAgentById(id: string): Agent | undefined;
  listAgents(): Agent[];

  // 核心：事件处理入口
  async onEvent(event: AgentEvent): Promise<void> {
    if (event.type !== 'message_created' || !event.message) return;

    const message = event.message;

    // ========== 第一层：规则快速过滤 ==========

    // 1. 跳过 Agent 自己的消息（避免自我循环）
    if (this.isAgentMessage(message)) return;

    // 2. 检查是否被 @ 提及
    const mentionedAgents = this.findMentionedAgents(message);

    // 3. 确定要触发的 Agent 列表
    let agentsToTrigger: Agent[] = [];

    if (mentionedAgents.length > 0) {
      // 被 @ 的 Agent 必须响应
      agentsToTrigger = mentionedAgents;
    } else {
      // 没有 @ 时，检查有主动回答能力的 Agent
      agentsToTrigger = this.getActiveAnswerAgents()
        .filter(agent => this.passesRules(agent, message));
    }

    if (agentsToTrigger.length === 0) return;

    // ========== 第二层：调用 LLM，让它自己决定 ==========
    for (const agent of agentsToTrigger) {
      const isMentioned = mentionedAgents.includes(agent);
      await this.executeAgent(agent, event, isMentioned);
    }
  }

  // 规则过滤
  private passesRules(agent: Agent, message: Message): boolean {
    const key = `${agent.id}:${message.conversationId}`;

    // 节流：同一房间 30 秒内只主动回复一次
    const lastReply = this.replyTimestamps.get(key) || 0;
    if (Date.now() - lastReply < 30000) {
      return false;
    }

    // 可选：关键词匹配
    const triggers = agent.triggers || [];
    const keywordTriggers = triggers.filter(t =>
      t.matchRules?.keywords?.length
    );

    if (keywordTriggers.length > 0) {
      const allKeywords = keywordTriggers.flatMap(t =>
        t.matchRules?.keywords || []
      );
      if (!allKeywords.some(kw => message.content.includes(kw))) {
        return false;
      }
    }

    return true;
  }

  private async executeAgent(
    agent: Agent,
    event: AgentEvent,
    isMentioned: boolean
  ): Promise<void> {
    const context = await this.buildContext(agent, event);

    // 构建 system prompt，告诉 Agent 可以选择不回复
    const decisionPrompt = isMentioned ? '' : `

## 回复策略
你是群聊中的一员。收到新消息后，请判断是否需要回复：
- 如果被直接 @ 或问题明确指向你 → 应该回复
- 如果是闲聊、与你无关的对话 → 不需要回复
- 如果别人已经回答了 → 不需要重复回复

如果你决定不回复，请直接返回 [NO_RESPONSE]，不要调用任何工具。`;

    const response = await this.llmClient.chat({
      messages: [
        { role: 'system', content: agent.systemPrompt + decisionPrompt },
        ...context.messages,
      ],
      tools: this.getAgentTools(agent),
    });

    // 检查是否选择不回复
    if (response.content?.includes('[NO_RESPONSE]') ||
        (response.toolCalls.length === 0 && !response.content?.trim())) {
      return; // Agent 决定不回复
    }

    // 记录回复时间（用于节流）
    const key = `${agent.id}:${event.roomId}`;
    this.replyTimestamps.set(key, Date.now());

    // 执行 tool_calls
    for (const toolCall of response.toolCalls) {
      await this.toolRegistry.invoke(
        toolCall.name,
        toolCall.args,
        { agentId: agent.id, roomId: event.roomId }
      );
    }
  }

  private isAgentMessage(message: Message): boolean {
    const sender = this.getUserById(message.senderId);
    return sender?.type === 'agent';
  }

  private findMentionedAgents(message: Message): Agent[] {
    if (!message.mentions?.length) return [];
    return message.mentions
      .map(userId => this.agents.get(this.getAgentIdByUserId(userId)))
      .filter((a): a is Agent => !!a);
  }

  private getActiveAnswerAgents(): Agent[] {
    return Array.from(this.agents.values())
      .filter(a => a.status === 'active' && a.capabilities?.answer_active);
  }
}
```

#### 分阶段实施建议

| 阶段 | 触发策略 |
|------|----------|
| **Phase 1 (MVP)** | 只用规则：被 @ → 触发，其他 → 不主动回复 |
| **Phase 2** | 加入主 LLM 自决策：开启 `answer_active` 的 Agent 让 LLM 自己判断 |
| **Phase 3** | 如果 token 成本成为问题，再考虑加轻量分类器前置过滤 |

### 3.3 ToolRegistry

**文件**：`server/agents/ToolRegistry.ts`

```typescript
class ToolRegistry {
  private tools: Map<string, { def: ToolDefinition; impl: Function }>;

  registerTool(def: ToolDefinition, impl: Function): void {
    this.tools.set(def.name, { def, impl });
  }

  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.def);
  }

  // 转换为 OpenAI Function Calling 格式
  toOpenAITools(): OpenAI.Tool[] {
    return this.listTools().map(def => ({
      type: 'function',
      function: {
        name: def.name,
        description: def.description,
        parameters: def.inputSchema,
      }
    }));
  }

  async invoke(toolName: string, args: unknown, ctx: Context): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) return { success: false, error: 'Tool not found' };

    try {
      const data = await tool.impl(args, ctx);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
```

### 3.4 长上下文与 RoomMemory

**文件**：`server/agents/RoomMemory.ts`

```typescript
interface RoomMemory {
  roomId: string;
  shortTermMessages: Message[];           // 最近 N 条消息缓存
  summaryBlocks: SummaryBlock[];          // 历史摘要块
  lastUpdatedAt: number;
}

interface SummaryBlock {
  summary: string;
  fromMessageId: string;
  toMessageId: string;
  createdAt: number;
}
```

**SummarizerAgent**：
- 当对话长度超过阈值时自动触发
- 生成摘要并存入 `summaryBlocks`
- 可选：在房间内发布摘要消息

---

## Part 4: 前端实现

### 4.1 ChatContext 改造

```typescript
// 扩展状态
interface ChatState {
  currentUser: User | null;
  users: User[];
  agents: Agent[];              // 新增：Agent 列表
  messages: Message[];
  typingUsers: string[];
  replyingTo?: Message;
}

// 新增 Action
type ChatAction =
  | { type: 'SET_AGENTS'; payload: Agent[] }
  | { type: 'ADD_AGENT_MESSAGE'; payload: Message }
  | { type: 'UPDATE_REACTIONS'; payload: { messageId: string; reactions: Reaction[] } }
  // ...
```

### 4.2 消息展示

**MessageBubble 样式区分**：

| 类型 | 样式 |
|------|------|
| `human` | 现有气泡样式 |
| `agent` | 不同背景色 + AI 角标 + 机器人头像 |
| `system` | 居中、轻量提示样式 |

**Reaction 展示**：
- 消息底部显示表情列表
- Agent 的点赞使用特殊 icon/tooltip 标识

### 4.3 输入交互

**@ 提及**：
```
输入 @ → 弹出用户/Agent 列表 → 选择后插入 @Name
发送时附带 mentions: ['agent-id'] 或 targetAgentId: 'agent-id'
```

**/ 命令**：
```
输入 / → 弹出命令列表
├── /ai <问题>      → 触发默认 Agent
├── /summary        → 请求对话总结
└── /agent <name>   → 指定 Agent
```

**消息操作按钮**：
- Hover 时显示「问 AI」按钮
- 点击后触发 Agent 针对该消息回复

---

## Part 5: Agent 配置平台

### 5.1 配置模型

```typescript
interface AgentConfig {
  // 基础信息
  id?: string;
  name: string;
  description?: string;
  avatar?: string;

  // 模型配置
  model: {
    provider: 'openai' | 'anthropic' | 'azure' | 'custom';
    name: string;
    temperature?: number;
    maxTokens?: number;
  };

  // 行为配置
  systemPrompt: string;
  capabilities: AgentCapabilities;
  tools: string[];
  triggers: AgentTrigger[];

  // 运行时
  runtime: {
    type: 'internal' | 'langchain' | 'mcp' | 'dify';
    endpoint?: string;
    apiKeyAlias?: string;
  };
}
```

### 5.2 前端配置界面

**AgentConfigPage 结构**：

```
┌─────────────────────────────────────────────────────┐
│  Agent 配置                                          │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐   │
│  │ 基础信息                                      │   │
│  │  名称: [_____________]                       │   │
│  │  描述: [_____________]                       │   │
│  │  头像: [选择/上传]                            │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ 模型配置                                      │   │
│  │  Provider: [OpenAI ▼]                        │   │
│  │  Model:    [gpt-4o-mini ▼]                   │   │
│  │  Temperature: [0.7]                          │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ System Prompt                                │   │
│  │  ┌─────────────────────────────────────┐    │   │
│  │  │ 你是一个友好的群聊助手...              │    │   │
│  │  │                                     │    │   │
│  │  └─────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ 能力与工具                                    │   │
│  │  [✓] 被动回答  [✓] 主动回答                   │   │
│  │  [✓] 点赞      [ ] 总结                      │   │
│  │  工具: [send_message] [reply_to] [react]    │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [保存配置]  [注册 Agent]  [删除]                   │
└─────────────────────────────────────────────────────┘
```

### 5.3 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/agents/configs` | GET | 获取所有 Agent 配置 |
| `/agents/configs` | POST | 创建新 Agent |
| `/agents/configs/:id` | PATCH | 更新 Agent 配置 |
| `/agents/configs/:id` | DELETE | 删除 Agent |
| `/agents/:id/messages` | POST | Agent 发送消息（外部调用） |
| `/agents/tools` | GET | 获取可用工具列表 |

### 5.4 用户流程

```
用户流程：

1. 进入 Agent 配置页
        ↓
2. 填写配置（名称、模型、Prompt、能力）
        ↓
3. 点击「保存配置」
        ↓
4. 后端创建 Agent + 关联 User 身份
        ↓
5. 在群聊中 @ 该 Agent 即可触发
```

---

## Part 6: 扩展与兼容

### 6.1 多 Provider 支持

```typescript
// Provider 接口
interface LLMProvider {
  name: string;
  chat(params: ChatParams): Promise<ChatResponse>;
  supportsTools(): boolean;
  supportsStreaming(): boolean;
}

// 已实现
class OpenAIProvider implements LLMProvider { }
class AnthropicProvider implements LLMProvider { }
class AzureOpenAIProvider implements LLMProvider { }

// 扩展
class CustomHTTPProvider implements LLMProvider { }  // 自定义端点
class OllamaProvider implements LLMProvider { }      // 本地模型
```

### 6.2 Function Calling 适配

```typescript
// ToolDefinition → OpenAI tools 格式
function toOpenAITools(defs: ToolDefinition[]): OpenAI.Tool[] {
  return defs.map(def => ({
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    }
  }));
}

// 处理 tool_calls 响应
async function handleToolCalls(
  response: ChatResponse,
  registry: ToolRegistry,
  ctx: Context
): Promise<Message[]> {
  const results: Message[] = [];

  for (const call of response.toolCalls) {
    const result = await registry.invoke(call.name, call.args, ctx);
    results.push({
      role: 'tool',
      toolCallId: call.id,
      content: JSON.stringify(result),
    });
  }

  return results;
}
```

### 6.3 MCP 适配

```typescript
// 将 Chat Tool API 暴露为 MCP Server
class ChatMCPServer {
  private toolRegistry: ToolRegistry;

  // MCP tools/list
  listTools(): MCPTool[] {
    return this.toolRegistry.listTools().map(def => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
    }));
  }

  // MCP tools/call
  async callTool(name: string, args: unknown): Promise<MCPResult> {
    const result = await this.toolRegistry.invoke(name, args, this.ctx);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
```

### 6.4 LangChain / Dify 集成

**AgentConfig.runtime.type = 'langchain'**：

```typescript
// AgentManager 检测到 langchain 类型
if (agent.runtime.type === 'langchain') {
  // 将配置发送给 LangChain Worker
  const worker = new LangChainWorker(agent.runtime);

  // Worker 使用 LangChain 的 AgentExecutor
  const result = await worker.run({
    input: event.message.content,
    tools: this.toolRegistry.toLangChainTools(),
    systemPrompt: agent.systemPrompt,
  });

  // 结果通过 Chat Tool API 发送
  await this.toolRegistry.invoke('chat.send_message', {
    roomId: event.roomId,
    content: result.output,
  }, ctx);
}
```

---

## Part 7: 实施路线图

### Phase 1: 基础 LLM 接入（MVP） ✅ 已完成

**目标**：实现被动回答

- [x] `agents/query.py` - LLM 客户端封装（支持 OpenAI 兼容 API）
- [x] `agents/agent_service.py` - Agent 服务（轮询 + @ 检测 + 回复）
- [x] 实现工具：`/agents/:agentId/messages` API 发送消息
- [x] 心跳机制：`/agents/:agentId/heartbeat` 检测 Agent 在线状态
- [x] 前端：@ 提及触发、Agent 消息展示、消息气泡区分

**交付物**：用户可以 @Agent 获得回复 ✅

### Phase 1.5: 配置化 + 优化 ✅ 已完成

**新增功能**：

- [x] `parallax` Provider 支持（自定义 LLM endpoint）
- [x] 前端 Agent 配置中心（`AgentConfigPanel.tsx`）
- [x] Agent 服务动态读取后端配置（systemPrompt、model、temperature 等）
- [x] 配置即时刷新（每次 @ 时自动获取最新配置）
- [x] 特殊标签过滤（`<think>`、`<|channel|>` 等）
- [x] 级联删除消息（删除 @ 消息时同时删除回复）
- [x] 轮询优化（前端 1.5s、Agent 1s）

### Phase 2: 框架化 + 完整工具 ✅ 基本完成

**目标**：主动回答、点赞、引用

- [x] Agent 配置页面 MVP
- [x] 引用回复功能（replyToId）
- [x] 表情反应功能（reactions）- 通过 `[REACT:emoji:message_id]` 工具调用
- [x] 主动回答触发逻辑 + 节流（30秒冷却，可配置）
- [x] 点赞能力（like capability）- Agent 可主动/被动点赞消息
- [x] 前端：消息上的「问 AI」按钮
- [x] "Agent is taking a look" 指示器（处理消息时显示）
- [x] Mention 系统 Bug 修复（精确匹配 + 动态 userId）
- [ ] 完整 Chat Tool API（get_context、get_long_context）
- [ ] 可配置冷却时间（UI 配置面板）

**已实现的工具调用格式**：
- `[REACT:emoji:message_id]` - 对指定消息添加表情反应
- `[SKIP]` - 主动模式下跳过不参与

**Agent 行为模式**：
- **被动模式（passive）**：被 @ 时必须回复，可选点赞
- **主动模式（proactive）**：AI 自己决定是否回复/点赞/跳过

**交付物**：Agent 能主动插话、点赞、引用回复 ✅

### Phase 3: 高级功能

**目标**：长上下文、多运行时

- [ ] RoomMemory + SummarizerAgent
- [ ] `chat.get_long_context` 实现
- [ ] Function Calling 适配层
- [ ] MCP Server 暴露
- [ ] 多 Provider 支持（Anthropic、Azure）
- [x] 完整 Agent 配置平台

**交付物**：支持长对话、可配置的多 Agent 系统

---

## Appendix: API 参考

### A.1 Agent HTTP API

**发送消息（外部 Agent 调用）**：

```http
POST /agents/:agentId/messages
Header: x-agent-token: <AGENT_API_TOKEN>
Content-Type: application/json

{
  "content": "消息内容",
  "conversationId": "global",
  "replyToId": "<可选，引用的消息 ID>",
  "mentions": ["user-id"],
  "metadata": { "runId": "xxx" }
}
```

**Agent 添加表情反应**：

```http
POST /agents/:agentId/reactions
Header: x-agent-token: <AGENT_API_TOKEN>
Content-Type: application/json

{
  "messageId": "<消息 ID>",
  "emoji": "👍"
}
```

**Agent 设置 "正在查看" 状态**：

```http
POST /agents/:agentId/looking
Header: x-agent-token: <AGENT_API_TOKEN>
Content-Type: application/json

{
  "isLooking": true
}
```

**获取所有正在查看的 Agent**：

```http
GET /agents/looking
Authorization: Bearer <JWT_TOKEN>

Response:
{
  "lookingAgents": [
    {
      "agentId": "helper-agent-1",
      "agentName": "AI 助手",
      "userName": "AI Helper",
      "avatar": "https://..."
    }
  ]
}
```

### A.2 Python 调用示例

```python
import requests

API_BASE = "http://localhost:4000"
AGENT_ID = "helper-agent-1"
AGENT_TOKEN = "dev-agent-token"

def send_agent_message(content: str, reply_to: str = None):
    payload = {
        "content": content,
        "conversationId": "global",
    }
    if reply_to:
        payload["replyToId"] = reply_to

    resp = requests.post(
        f"{API_BASE}/agents/{AGENT_ID}/messages",
        json=payload,
        headers={"x-agent-token": AGENT_TOKEN},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()

# 使用
result = send_agent_message("你好，这是来自 Python 的消息！")
print(result)
```

### A.3 环境变量

```env
# LLM 配置
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4o-mini

# Agent API
AGENT_API_TOKEN=your-secure-token

# 服务配置
PORT=4000
JWT_SECRET=your-jwt-secret
```