import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID, randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data.json');

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TYPING_TTL = 7000;
const DEFAULT_CONVERSATION_ID = 'global';
const LLM_USER_ID = 'llm1';
const DEFAULT_AGENT_ID = 'helper-agent-1';
const ALLOWED_ROLES = new Set(['user', 'assistant', 'system', 'tool']);
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN || process.env.AGENT_API_KEY || 'dev-agent-token';

const adapter = new JSONFile(DB_PATH);
const db = new Low(adapter, { users: [], messages: [], typing: {}, agents: [] });
await db.read();
db.data ||= { users: [], messages: [], typing: {}, agents: [] };
db.data.users ||= [];
db.data.messages ||= [];
db.data.typing ||= {};
db.data.agents ||= [];

const app = express();
app.use(
    cors({
        credentials: true,
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (CLIENT_ORIGINS.includes(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
    }),
);
app.use(express.json());
app.use(cookieParser());

const sanitizeUser = (user) => {
    if (!user) return null;
    const { password_hash, ...rest } = user;
    return rest;
};

const sanitizeAgent = (agent) => {
    if (!agent) return null;
    const user = agent.userId ? db.data.users.find((u) => u.id === agent.userId) : null;
    return {
        ...agent,
        user: user ? sanitizeUser(user) : null,
    };
};

const DEFAULT_AGENT_CAPABILITIES = {
    answer_active: false,
    answer_passive: true,
    like: false,
    summarize: false,
};
const DEFAULT_AGENT_MODEL = {
    provider: 'openai',
    name: 'gpt-4o-mini',
    temperature: 0.6,
    maxTokens: 1000,
};
const DEFAULT_AGENT_RUNTIME = {
    type: 'internal-function-calling',
};
const DEFAULT_AGENT_TOOLS = ['chat.send_message'];

const clampNumber = (value, min, max, fallback) => {
    const num = Number(value);
    if (Number.isFinite(num)) {
        return Math.min(Math.max(num, min), max);
    }
    return fallback;
};

const safeTrim = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const generateAgentAvatar = (seed) => {
    const actualSeed = seed || `agent-${randomBytes(4).toString('hex')}`;
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(actualSeed)}`;
};

const normalizeAgentTools = (toolsInput) => {
    if (!Array.isArray(toolsInput)) return [...DEFAULT_AGENT_TOOLS];
    const cleaned = toolsInput
        .map((tool) => safeTrim(tool ?? ''))
        .filter(Boolean);
    const unique = Array.from(new Set(cleaned));
    return unique.length ? unique : [...DEFAULT_AGENT_TOOLS];
};

const normalizeAgentCapabilities = (capsInput = {}) => {
    return {
        answer_active: Boolean(capsInput.answer_active),
        answer_passive:
            capsInput.answer_passive === undefined ? DEFAULT_AGENT_CAPABILITIES.answer_passive : Boolean(capsInput.answer_passive),
        like: Boolean(capsInput.like),
        summarize: Boolean(capsInput.summarize),
    };
};

const normalizeAgentModel = (modelInput = {}, fallback = DEFAULT_AGENT_MODEL) => {
    const base = { ...fallback };
    if (modelInput.provider) {
        base.provider = safeTrim(modelInput.provider).toLowerCase() || base.provider;
    }
    if (modelInput.model || modelInput.name) {
        base.name = safeTrim(modelInput.model || modelInput.name) || base.name;
    }
    if (modelInput.temperature !== undefined) {
        base.temperature = clampNumber(modelInput.temperature, 0, 2, base.temperature);
    }
    if (modelInput.maxTokens !== undefined) {
        base.maxTokens = clampNumber(modelInput.maxTokens, 64, 16000, base.maxTokens);
    }
    return base;
};

const normalizeAgentRuntime = (runtimeInput = {}, fallback = DEFAULT_AGENT_RUNTIME) => {
    const base = { ...fallback };
    if (runtimeInput.type) {
        base.type = safeTrim(runtimeInput.type) || base.type;
    }
    if (runtimeInput.endpoint !== undefined) {
        const endpoint = safeTrim(runtimeInput.endpoint);
        base.endpoint = endpoint || undefined;
    }
    if (runtimeInput.apiKeyAlias !== undefined) {
        const apiKeyAlias = safeTrim(runtimeInput.apiKeyAlias);
        base.apiKeyAlias = apiKeyAlias || undefined;
    }
    return base;
};

const ensureAgentUserRecord = ({ agentId, userId, name, avatar }) => {
    const desiredName = safeTrim(name) || 'AI Agent';
    const desiredAvatar = safeTrim(avatar) || generateAgentAvatar(desiredName);
    const trimmedUserId = safeTrim(userId);
    let user =
        (trimmedUserId && db.data.users.find((u) => u.id === trimmedUserId)) ||
        db.data.users.find((u) => u.agentId === agentId);

    if (!user) {
        user = {
            id: trimmedUserId || `agent-user-${randomUUID()}`,
            email: `${agentId || randomUUID()}@agents.local`,
            password_hash: randomBytes(12).toString('hex'),
            name: desiredName,
            avatar: desiredAvatar,
            isLLM: true,
            status: 'online',
            createdAt: Date.now(),
            type: 'agent',
            agentId,
        };
        db.data.users.push(user);
    } else {
        user.name = desiredName;
        user.avatar = desiredAvatar;
        user.type = 'agent';
        user.isLLM = true;
        user.agentId = agentId;
        user.status = user.status || 'online';
    }

    return sanitizeUser(user);
};

const normalizeMetadata = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
};

const normalizeMentions = (mentions) => {
    if (!Array.isArray(mentions)) return [];
    return mentions.filter(Boolean);
};

const ensureAgentMetadata = (agent, metadata = {}) => {
    const base = normalizeMetadata(metadata);
    return {
        ...base,
        agentId: agent?.id || base.agentId,
        source: base.source || 'agent',
    };
};

const normalizeMessage = (message) => {
    if (!message) return message;
    const role = ALLOWED_ROLES.has(message.role)
        ? message.role
        : message.senderId === LLM_USER_ID
          ? 'assistant'
          : 'user';

    return {
        ...message,
        conversationId: message.conversationId || DEFAULT_CONVERSATION_ID,
        role,
        metadata: normalizeMetadata(message.metadata),
        mentions: normalizeMentions(message.mentions),
        reactions: Array.isArray(message.reactions) ? message.reactions : [],
    };
};

const signToken = (userId) => {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
};

const setSessionCookie = (res, token) => {
    res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
};

const authMiddleware = (req, res, next) => {
    const bearer = req.headers.authorization?.replace('Bearer ', '');
    const token = req.cookies.token || bearer;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = db.data.users.find((u) => u.id === payload.id);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        req.user = sanitizeUser(user);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
};

const agentAuthMiddleware = (req, res, next) => {
    const token =
        req.headers['x-agent-token'] ||
        req.headers['x-agent-key'] ||
        req.headers.authorization?.replace('Bearer ', '');
    if (!token || token !== AGENT_API_TOKEN) {
        return res.status(401).json({ error: 'Invalid agent token' });
    }
    next();
};

const ensureSeed = async () => {
    // Ensure all existing users有类型标记，便于区分人类与 Agent
    db.data.users.forEach((user) => {
        if (!user.type) {
            user.type = user.isLLM ? 'agent' : 'human';
        }
    });

    // Seed 默认的 LLM 用户（作为 Agent 的 user 身份）
    let llmUser = db.data.users.find((u) => u.id === LLM_USER_ID);
    if (!llmUser) {
        llmUser = {
            id: LLM_USER_ID,
            email: 'gpt4@example.com',
            password_hash: randomBytes(8).toString('hex'),
            name: 'GPT-4',
            avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=GPT4',
            isLLM: true,
            type: 'agent',
            status: 'online',
            createdAt: Date.now(),
        };
        db.data.users.push(llmUser);
    } else if (!llmUser.type) {
        llmUser.type = llmUser.isLLM ? 'agent' : 'human';
    }

    // 确保 LLM 用户关联到默认 Agent
    if (llmUser.isLLM && !llmUser.agentId) {
        llmUser.agentId = DEFAULT_AGENT_ID;
    }

    // Seed 默认 Agent 配置
    const existingAgent = db.data.agents.find((a) => a.id === DEFAULT_AGENT_ID);
    if (!existingAgent) {
        db.data.agents.push({
            id: DEFAULT_AGENT_ID,
            userId: LLM_USER_ID,
            name: 'GPT-4 助手',
            description: '默认示例 Agent，用于基础问答与演示。',
            capabilities: {
                answer_active: false,
                answer_passive: true,
                like: false,
                summarize: false,
            },
            tools: ['chat.send_message'],
            triggers: [],
            runtime: {
                type: 'internal-function-calling',
            },
            createdAt: Date.now(),
        });
    }
};

const applyMessageDefaults = () => {
    db.data.messages = db.data.messages.map((m) => normalizeMessage(m));
};

await ensureSeed();
applyMessageDefaults();
await db.write();

app.post('/auth/register', async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || password.length < 8) {
        return res.status(400).json({ error: 'Invalid email or password too short' });
    }
    if (db.data.users.find((u) => u.email === email)) {
        return res.status(409).json({ error: 'Email already registered' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = {
        id: randomUUID(),
        email,
        password_hash: hash,
        name: name || email.split('@')[0],
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name || email)}`,
        isLLM: false,
        status: 'online',
        createdAt: Date.now(),
    };
    db.data.users.push(user);
    await db.write();

    const token = signToken(user.id);
    setSessionCookie(res, token);
    res.json({ user: sanitizeUser(user) });
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    const user = db.data.users.find((u) => u.email === email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id);
    setSessionCookie(res, token);
    res.json({ user: sanitizeUser(user) });
});

app.post('/auth/logout', (_req, res) => {
    res.clearCookie('token');
    res.json({ ok: true });
});

app.get('/auth/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

app.get('/messages', authMiddleware, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const before = req.query.before ? Number(req.query.before) : undefined;
    const since = req.query.since ? Number(req.query.since) : undefined;
    const conversationId = req.query.conversationId ? String(req.query.conversationId) : DEFAULT_CONVERSATION_ID;

    let msgs = [...db.data.messages]
        .map(normalizeMessage)
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (since) {
        msgs = msgs.filter((m) => m.timestamp > since);
    }
    if (before) {
        msgs = msgs.filter((m) => m.timestamp < before);
    }
    msgs = msgs.slice(-limit);

    const usersMap = new Map();
    msgs.forEach((m) => {
        const u = db.data.users.find((x) => x.id === m.senderId);
        if (u) usersMap.set(u.id, sanitizeUser(u));
    });
    res.json({ messages: msgs, users: Array.from(usersMap.values()) });
});

app.get('/users', authMiddleware, (_req, res) => {
    res.json({ users: db.data.users.map((u) => sanitizeUser(u)) });
});

app.get('/agents', authMiddleware, (_req, res) => {
    const agents = db.data.agents.map((agent) => sanitizeAgent(agent)).filter(Boolean);
    const users = agents
        .map((agent) => agent.user)
        .filter(Boolean)
        .map((user) => sanitizeUser(user));
    res.json({ agents, users });
});

app.get('/agents/configs', authMiddleware, (_req, res) => {
    const agents = db.data.agents.map((agent) => sanitizeAgent(agent)).filter(Boolean);
    const users = agents
        .map((agent) => agent.user)
        .filter(Boolean)
        .map((user) => sanitizeUser(user));
    res.json({ agents, users });
});

app.post('/agents/configs', authMiddleware, async (req, res) => {
    const payload = req.body || {};
    const name = safeTrim(payload.name);
    if (!name) {
        return res.status(400).json({ error: 'Agent name is required' });
    }

    const requestedId = safeTrim(payload.id);
    const agentId = requestedId || `agent-${randomUUID()}`;
    if (db.data.agents.find((agent) => agent.id === agentId)) {
        return res.status(409).json({ error: 'Agent ID already exists' });
    }

    const baseDescription = safeTrim(payload.description);
    const avatar = safeTrim(payload.avatar) || generateAgentAvatar(name || agentId);
    const systemPrompt = safeTrim(payload.systemPrompt);
    const agent = {
        id: agentId,
        name,
        description: baseDescription,
        avatar,
        status: payload.status === 'inactive' ? 'inactive' : 'active',
        systemPrompt,
        capabilities: normalizeAgentCapabilities(payload.capabilities),
        tools: normalizeAgentTools(payload.tools),
        model: normalizeAgentModel(payload.model || payload.modelConfig || {}, DEFAULT_AGENT_MODEL),
        runtime: normalizeAgentRuntime(payload.runtime || {}, DEFAULT_AGENT_RUNTIME),
        triggers: Array.isArray(payload.triggers) ? payload.triggers : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };

    const linkedUser = ensureAgentUserRecord({
        agentId: agent.id,
        userId: safeTrim(payload.userId),
        name: agent.name,
        avatar: agent.avatar,
    });
    agent.userId = linkedUser?.id;

    db.data.agents.push(agent);
    await db.write();
    res.status(201).json({ agent: sanitizeAgent(agent), user: linkedUser });
});

app.patch('/agents/configs/:agentId', authMiddleware, async (req, res) => {
    const { agentId } = req.params;
    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const payload = req.body || {};

    if (payload.name !== undefined) {
        const nextName = safeTrim(payload.name);
        if (!nextName) return res.status(400).json({ error: 'Agent name cannot be empty' });
        agent.name = nextName;
    }
    if (payload.description !== undefined) {
        agent.description = safeTrim(payload.description);
    }
    if (payload.avatar !== undefined) {
        const avatar = safeTrim(payload.avatar);
        agent.avatar = avatar || generateAgentAvatar(agent.name || agent.id);
    } else if (!agent.avatar) {
        agent.avatar = generateAgentAvatar(agent.name || agent.id);
    }
    if (payload.status !== undefined) {
        agent.status = payload.status === 'inactive' ? 'inactive' : 'active';
    }
    if (payload.systemPrompt !== undefined) {
        agent.systemPrompt = safeTrim(payload.systemPrompt);
    }
    if (payload.capabilities !== undefined) {
        agent.capabilities = normalizeAgentCapabilities(payload.capabilities);
    } else if (!agent.capabilities) {
        agent.capabilities = { ...DEFAULT_AGENT_CAPABILITIES };
    }
    if (payload.tools !== undefined) {
        agent.tools = normalizeAgentTools(payload.tools);
    } else if (!Array.isArray(agent.tools) || !agent.tools.length) {
        agent.tools = [...DEFAULT_AGENT_TOOLS];
    }
    if (payload.model !== undefined || payload.modelConfig !== undefined) {
        agent.model = normalizeAgentModel(payload.model || payload.modelConfig || {}, agent.model || DEFAULT_AGENT_MODEL);
    } else if (!agent.model) {
        agent.model = { ...DEFAULT_AGENT_MODEL };
    }
    if (payload.runtime !== undefined) {
        agent.runtime = normalizeAgentRuntime(payload.runtime, agent.runtime || DEFAULT_AGENT_RUNTIME);
    } else if (!agent.runtime) {
        agent.runtime = { ...DEFAULT_AGENT_RUNTIME };
    }
    if (payload.triggers !== undefined && Array.isArray(payload.triggers)) {
        agent.triggers = payload.triggers;
    }

    const linkedUser = ensureAgentUserRecord({
        agentId: agent.id,
        userId: safeTrim(payload.userId) || agent.userId,
        name: agent.name,
        avatar: agent.avatar,
    });
    agent.userId = linkedUser?.id;
    agent.updatedAt = Date.now();

    await db.write();
    res.json({ agent: sanitizeAgent(agent), user: linkedUser });
});

app.delete('/agents/configs/:agentId', authMiddleware, async (req, res) => {
    const { agentId } = req.params;
    const index = db.data.agents.findIndex((a) => a.id === agentId);
    if (index === -1) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const [removed] = db.data.agents.splice(index, 1);
    let deletedUserId = null;
    if (removed?.userId) {
        const userIndex = db.data.users.findIndex((u) => u.id === removed.userId && u.type === 'agent');
        if (userIndex !== -1) {
            // Remove the agent user from the users list
            deletedUserId = removed.userId;
            db.data.users.splice(userIndex, 1);
        }
    }

    await db.write();
    res.json({ deletedAgentId: agentId, deletedUserId });
});

app.post('/agents/:agentId/messages', agentAuthMiddleware, async (req, res) => {
    const { agentId } = req.params;
    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }
    const agentUser = db.data.users.find((u) => u.id === agent.userId);
    if (!agentUser) {
        return res.status(422).json({ error: 'Agent user not configured' });
    }

    const { content, conversationId, replyToId, metadata, mentions } = req.body || {};
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Content required' });
    }

    const message = normalizeMessage({
        id: randomUUID(),
        content: content.trim(),
        senderId: agentUser.id,
        timestamp: Date.now(),
        replyToId: replyToId || undefined,
        reactions: [],
        conversationId: conversationId?.trim() || DEFAULT_CONVERSATION_ID,
        role: 'assistant',
        metadata: ensureAgentMetadata(agent, metadata),
        mentions: normalizeMentions(mentions),
    });

    db.data.messages.push(message);
    await db.write();
    res.json({ message });
});

// Agent 添加表情反应
app.post('/agents/:agentId/reactions', agentAuthMiddleware, async (req, res) => {
    const { agentId } = req.params;
    const { messageId, emoji } = req.body || {};

    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }
    const agentUser = db.data.users.find((u) => u.id === agent.userId);
    if (!agentUser) {
        return res.status(422).json({ error: 'Agent user not configured' });
    }

    if (!messageId || !emoji) {
        return res.status(400).json({ error: 'messageId and emoji are required' });
    }

    const message = db.data.messages.find((m) => m.id === messageId);
    if (!message) {
        return res.status(404).json({ error: 'Message not found' });
    }

    message.reactions ||= [];
    const userId = agentUser.id;
    const reactionIndex = message.reactions.findIndex((r) => r.emoji === emoji);

    if (reactionIndex >= 0) {
        const existing = message.reactions[reactionIndex];
        if (!existing.userIds.includes(userId)) {
            existing.userIds.push(userId);
            existing.count = existing.userIds.length;
        }
    } else {
        message.reactions.push({
            emoji,
            count: 1,
            userIds: [userId],
        });
    }

    await db.write();
    res.json({ message: normalizeMessage(message) });
});

app.post('/messages', authMiddleware, async (req, res) => {
    const { content, replyToId, conversationId, role, metadata, mentions } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
    const targetConversation = conversationId?.trim() || DEFAULT_CONVERSATION_ID;
    const messageRole = ALLOWED_ROLES.has(role) ? role : req.user.isLLM ? 'assistant' : 'user';

    const rawMessage = {
        id: randomUUID(),
        content: content.trim(),
        senderId: req.user.id,
        timestamp: Date.now(),
        replyToId: replyToId || undefined,
        reactions: [],
        conversationId: targetConversation,
        role: messageRole,
        metadata: normalizeMetadata(metadata),
        mentions: normalizeMentions(mentions),
    };
    const message = normalizeMessage(rawMessage);
    db.data.messages.push(message);
    await db.write();
    res.json({ message, users: [req.user] });
});

app.delete('/messages/:messageId', authMiddleware, async (req, res) => {
    const { messageId } = req.params;
    const conversationId = req.query.conversationId ? String(req.query.conversationId) : undefined;
    const index = db.data.messages.findIndex((m) => m.id === messageId);
    if (index === -1) {
        return res.status(404).json({ error: 'Message not found' });
    }
    const message = db.data.messages[index];
    if (conversationId && message.conversationId && message.conversationId !== conversationId) {
        return res.status(404).json({ error: 'Message not found in this conversation' });
    }
    if (message.senderId !== req.user.id) {
        return res.status(403).json({ error: 'Cannot delete this message' });
    }

    // 级联删除：找出所有 replyToId 指向此消息的回复
    const deletedIds = [messageId];
    const findReplies = (parentId) => {
        const replies = db.data.messages.filter((m) => m.replyToId === parentId);
        for (const reply of replies) {
            deletedIds.push(reply.id);
            findReplies(reply.id); // 递归删除回复的回复
        }
    };
    findReplies(messageId);

    // 删除所有相关消息
    db.data.messages = db.data.messages.filter((m) => !deletedIds.includes(m.id));
    await db.write();
    res.json({ deletedMessageIds: deletedIds });
});

app.post('/messages/:messageId/reactions', authMiddleware, async (req, res) => {
    const { emoji, conversationId } = req.body || {};
    const { messageId } = req.params;
    if (!emoji || typeof emoji !== 'string') {
        return res.status(400).json({ error: 'Emoji is required' });
    }

    const message = db.data.messages.find((m) => m.id === messageId);
    if (!message) {
        return res.status(404).json({ error: 'Message not found' });
    }

    if (conversationId && message.conversationId && message.conversationId !== conversationId) {
        return res.status(404).json({ error: 'Message not found in this conversation' });
    }

    message.reactions ||= [];
    Object.assign(message, normalizeMessage(message));

    const userId = req.user.id;
    const reactionIndex = message.reactions.findIndex((reaction) => reaction.emoji === emoji);

    if (reactionIndex >= 0) {
        const existing = message.reactions[reactionIndex];
        const hasReacted = existing.userIds.includes(userId);

        if (hasReacted) {
            const nextUserIds = existing.userIds.filter((id) => id !== userId);
            if (nextUserIds.length === 0) {
                message.reactions.splice(reactionIndex, 1);
            } else {
                message.reactions[reactionIndex] = {
                    ...existing,
                    count: nextUserIds.length,
                    userIds: nextUserIds,
                };
            }
        } else {
            const nextUserIds = [...existing.userIds, userId];
            message.reactions[reactionIndex] = {
                ...existing,
                count: nextUserIds.length,
                userIds: nextUserIds,
            };
        }
    } else {
        message.reactions.push({
            emoji,
            count: 1,
            userIds: [userId],
        });
    }

    await db.write();
    res.json({ message: normalizeMessage(message) });
});

const pruneTyping = () => {
    const now = Date.now();
    Object.entries(db.data.typing).forEach(([userId, expires]) => {
        if (expires < now) delete db.data.typing[userId];
    });
};

app.post('/typing', authMiddleware, async (req, res) => {
    const { isTyping } = req.body || {};
    pruneTyping();
    if (isTyping) {
        db.data.typing[req.user.id] = Date.now() + TYPING_TTL;
    } else {
        delete db.data.typing[req.user.id];
    }
    await db.write();
    res.json({ typingUsers: Object.keys(db.data.typing) });
});

app.get('/typing', authMiddleware, (_req, res) => {
    pruneTyping();
    res.json({ typingUsers: Object.keys(db.data.typing) });
});

// Agent heartbeat tracking
const AGENT_HEARTBEAT_TTL = 15000; // 15 seconds
db.data.agentHeartbeats ||= {};

const pruneAgentHeartbeats = () => {
    const now = Date.now();
    Object.entries(db.data.agentHeartbeats || {}).forEach(([agentId, lastSeen]) => {
        if (now - lastSeen > AGENT_HEARTBEAT_TTL) {
            delete db.data.agentHeartbeats[agentId];
        }
    });
};

// Agent heartbeat endpoint - called by agent_service to signal it's alive
app.post('/agents/:agentId/heartbeat', agentAuthMiddleware, async (req, res) => {
    const { agentId } = req.params;
    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    db.data.agentHeartbeats ||= {};
    db.data.agentHeartbeats[agentId] = Date.now();
    await db.write();
    res.json({ ok: true, agentId, timestamp: db.data.agentHeartbeats[agentId] });
});

// Get status of all agents (whether real agent service is running)
app.get('/agents/status', authMiddleware, (_req, res) => {
    pruneAgentHeartbeats();
    const statuses = {};
    db.data.agents.forEach((agent) => {
        const lastHeartbeat = db.data.agentHeartbeats?.[agent.id];
        statuses[agent.id] = {
            id: agent.id,
            name: agent.name,
            configStatus: agent.status || 'active',
            serviceOnline: !!lastHeartbeat && (Date.now() - lastHeartbeat < AGENT_HEARTBEAT_TTL),
            lastHeartbeat: lastHeartbeat || null,
        };
    });
    res.json({ agents: statuses });
});

app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
});
