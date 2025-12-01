export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export const DEFAULT_CONVERSATION_ID = 'global';

export type UserType = 'human' | 'agent' | 'system';

export interface User {
  id: string;
  name: string;
  avatar: string;
  isLLM: boolean;
  status: 'online' | 'offline' | 'busy';
  type?: UserType;
  agentId?: string;
  email?: string;
  createdAt?: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export type MessageStatus =
  | { type: 'sending' }
  | { type: 'sent'; sentAt: number }
  | { type: 'delivered'; deliveredAt: number }
  | { type: 'read'; readAt: number }
  | { type: 'failed'; error: string };

export interface MessageEditMetadata {
  content: string;
  editedAt: number;
}

export type AgentStatus = 'active' | 'inactive';

export interface AgentCapabilities {
  answer_active?: boolean;
  answer_passive?: boolean;
  like?: boolean;
  summarize?: boolean;
}

export interface AgentModelConfig {
  provider: string;
  name: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentRuntimeConfig {
  type: string;
  endpoint?: string;
  apiKeyAlias?: string;
  proactiveCooldown?: number; // Cooldown in seconds between proactive responses (default: 30)
  [key: string]: unknown;
}

export interface MCPToolConfig {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPConfig {
  url: string;
  apiKey?: string;
  endpoint?: string;       // The actual endpoint to use for tool execution (may differ from url)
  transport?: 'streamable-http' | 'sse' | 'rest';  // Transport type discovered during connection
  availableTools?: MCPToolConfig[];
  enabledTools?: string[];
}

export interface Agent {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  avatar?: string;
  status?: AgentStatus;
  systemPrompt?: string;
  capabilities?: AgentCapabilities;
  tools?: string[];
  triggers?: unknown[];
  runtime?: AgentRuntimeConfig;
  model?: AgentModelConfig;
  mcp?: MCPConfig;
  createdAt?: number;
  updatedAt?: number;
  user?: User | null;
}

export interface AgentConfigPayload {
  id?: string;
  name: string;
  description?: string;
  avatar?: string;
  status?: AgentStatus;
  systemPrompt?: string;
  capabilities?: AgentCapabilities;
  tools?: string[];
  model?: AgentModelConfig;
  runtime?: AgentRuntimeConfig;
  mcp?: MCPConfig;
  triggers?: unknown[];
  userId?: string;
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  timestamp: number;
  reactions: Reaction[];
  conversationId: string;
  role: MessageRole;
  metadata?: Record<string, unknown>;
  replyToId?: string; // ID of the message being replied to
  mentions?: string[]; // IDs of users mentioned
  status?: MessageStatus; // Message delivery status
  editHistory?: MessageEditMetadata[]; // Edit history
  editedAt?: number; // Timestamp of last edit
}

export interface ChatState {
  currentUser: User | null;
  users: User[];
  agents: Agent[];
  messages: Message[];
  typingUsers: string[]; // IDs of users currently typing
  replyingTo?: Message; // The message currently being replied to
  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
}
