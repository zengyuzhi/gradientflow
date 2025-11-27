const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const res = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const error = new Error(body?.error || res.statusText || `Request failed: ${res.status}`);
        (error as any).status = res.status;
        (error as any).body = body;
        throw error;
    }
    return body as T;
};

export const api = {
    auth: {
        me: () => request<{ user: User }>('/auth/me'),
        login: (payload: { email: string; password: string }) =>
            request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
        register: (payload: { email: string; password: string; name: string }) =>
            request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
        logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
    },
    messages: {
        list: (params?: { limit?: number; before?: number; since?: number; conversationId?: string }) => {
            const search = new URLSearchParams();
            const conversation = params?.conversationId || DEFAULT_CONVERSATION_ID;
            search.set('conversationId', conversation);
            if (params?.limit) search.set('limit', String(params.limit));
            if (params?.before) search.set('before', String(params.before));
            if (params?.since) search.set('since', String(params.since));
            const suffix = search.toString() ? `?${search.toString()}` : '';
            return request<{ messages: Message[]; users: User[] }>(`/messages${suffix}`);
        },
        create: (payload: {
            content: string;
            replyToId?: string;
            conversationId?: string;
            role?: string;
            metadata?: Record<string, unknown>;
            mentions?: string[];
        }) =>
            request<{ message: Message; users?: User[] }>('/messages', {
                method: 'POST',
                body: JSON.stringify({
                    conversationId: DEFAULT_CONVERSATION_ID,
                    role: 'user',
                    metadata: {},
                    mentions: [],
                    ...payload,
                }),
            }),
        react: (messageId: string, emoji: string, conversationId?: string) =>
            request<{ message: Message }>(`/messages/${messageId}/reactions`, {
                method: 'POST',
                body: JSON.stringify({ emoji, conversationId }),
            }),
        delete: (messageId: string, conversationId?: string) => {
            const search = new URLSearchParams();
            if (conversationId) search.set('conversationId', conversationId);
            const suffix = search.toString() ? `?${search.toString()}` : '';
            return request<{ deletedMessageId?: string; deletedMessageIds?: string[] }>(`/messages/${messageId}${suffix}`, {
                method: 'DELETE',
            });
        },
    },
    typing: {
        set: (isTyping: boolean) => request<{ typingUsers: string[] }>('/typing', { method: 'POST', body: JSON.stringify({ isTyping }) }),
        list: () => request<{ typingUsers: string[] }>('/typing'),
    },
    users: {
        list: () => request<{ users: User[] }>('/users'),
    },
    agents: {
        list: () => request<{ agents: Agent[]; users: User[] }>('/agents'),
        create: (payload: AgentConfigPayload) =>
            request<{ agent: Agent; user?: User }>('/agents/configs', {
                method: 'POST',
                body: JSON.stringify(payload),
            }),
        update: (agentId: string, payload: Partial<AgentConfigPayload>) =>
            request<{ agent: Agent; user?: User }>(`/agents/configs/${agentId}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            }),
        remove: (agentId: string) =>
            request<{ deletedAgentId: string; deletedUserId: string | null }>(`/agents/configs/${agentId}`, {
                method: 'DELETE',
            }),
        looking: () =>
            request<{
                lookingAgents: Array<{
                    agentId: string;
                    agentName: string;
                    userName: string;
                    avatar: string;
                }>;
            }>('/agents/looking'),
    },
};
import { Agent, AgentConfigPayload, DEFAULT_CONVERSATION_ID, Message, User } from '../types/chat';
