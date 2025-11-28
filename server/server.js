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
    if (runtimeInput.proactiveCooldown !== undefined) {
        base.proactiveCooldown = clampNumber(runtimeInput.proactiveCooldown, 5, 300, 30);
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

// Agent "looking" status tracking
const AGENT_LOOKING_TTL = 10000; // 10 seconds
db.data.agentLooking ||= {};

const pruneAgentLooking = () => {
    const now = Date.now();
    Object.entries(db.data.agentLooking || {}).forEach(([agentId, expires]) => {
        if (expires < now) delete db.data.agentLooking[agentId];
    });
};

// Agent sets "looking" status
app.post('/agents/:agentId/looking', agentAuthMiddleware, async (req, res) => {
    const { agentId } = req.params;
    const { isLooking } = req.body || {};
    pruneAgentLooking();
    if (isLooking) {
        db.data.agentLooking[agentId] = Date.now() + AGENT_LOOKING_TTL;
    } else {
        delete db.data.agentLooking[agentId];
    }
    await db.write();
    res.json({ success: true });
});

// Get all looking agents
app.get('/agents/looking', authMiddleware, (_req, res) => {
    pruneAgentLooking();
    const lookingAgentIds = Object.keys(db.data.agentLooking || {});
    const lookingAgents = lookingAgentIds.map(agentId => {
        const agent = db.data.agents.find(a => a.id === agentId);
        if (!agent) return null;
        const user = db.data.users.find(u => u.id === agent.userId);
        return {
            agentId,
            agentName: agent.name,
            userName: user?.name || agent.name,
            avatar: user?.avatar || agent.avatar,
        };
    }).filter(Boolean);
    res.json({ lookingAgents });
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

// ========== Chat Tool API ==========
// These APIs allow agents to fetch context programmatically

// chat.get_message_context - Get context around a specific message
app.get('/agents/:agentId/context', agentAuthMiddleware, (req, res) => {
    const { agentId } = req.params;
    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const messageId = req.query.messageId;
    const before = Math.min(Number(req.query.before) || 5, 50);
    const after = Math.min(Number(req.query.after) || 5, 50);
    const conversationId = req.query.conversationId || DEFAULT_CONVERSATION_ID;

    const allMessages = db.data.messages
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp);

    let contextMessages = [];

    if (messageId) {
        // Find the target message and get messages around it
        const targetIndex = allMessages.findIndex((m) => m.id === messageId);
        if (targetIndex === -1) {
            return res.status(404).json({ error: 'Message not found' });
        }
        const startIndex = Math.max(0, targetIndex - before);
        const endIndex = Math.min(allMessages.length, targetIndex + after + 1);
        contextMessages = allMessages.slice(startIndex, endIndex);
    } else {
        // No messageId specified, get recent messages
        contextMessages = allMessages.slice(-Math.max(before, 10));
    }

    // Build user map for context
    const userMap = {};
    contextMessages.forEach((m) => {
        const user = db.data.users.find((u) => u.id === m.senderId);
        if (user) {
            userMap[user.id] = {
                id: user.id,
                name: user.name,
                type: user.type || (user.isLLM ? 'agent' : 'human'),
            };
        }
    });

    res.json({
        messages: contextMessages.map(normalizeMessage),
        users: Object.values(userMap),
        targetMessageId: messageId || null,
    });
});

// chat.get_long_context - Get long context with optional summary
app.get('/agents/:agentId/long-context', agentAuthMiddleware, (req, res) => {
    const { agentId } = req.params;
    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const maxMessages = Math.min(Number(req.query.maxMessages) || 50, 200);
    const conversationId = req.query.conversationId || DEFAULT_CONVERSATION_ID;
    const includeSystemPrompt = req.query.includeSystemPrompt === 'true';

    const allMessages = db.data.messages
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp);

    // Get recent messages up to maxMessages
    const recentMessages = allMessages.slice(-maxMessages);

    // Build user map
    const userMap = {};
    recentMessages.forEach((m) => {
        const user = db.data.users.find((u) => u.id === m.senderId);
        if (user) {
            userMap[user.id] = {
                id: user.id,
                name: user.name,
                type: user.type || (user.isLLM ? 'agent' : 'human'),
                avatar: user.avatar,
            };
        }
    });

    // Get room participants
    const participants = db.data.users
        .filter((u) => u.type !== 'system')
        .map((u) => ({
            id: u.id,
            name: u.name,
            type: u.type || (u.isLLM ? 'agent' : 'human'),
        }));

    const response = {
        messages: recentMessages.map(normalizeMessage),
        users: Object.values(userMap),
        participants,
        totalMessages: allMessages.length,
        returnedMessages: recentMessages.length,
    };

    // Optionally include agent's system prompt
    if (includeSystemPrompt && agent.systemPrompt) {
        response.systemPrompt = agent.systemPrompt;
    }

    res.json(response);
});

// chat.get_recent_history - Simple recent history endpoint
app.get('/agents/:agentId/history', agentAuthMiddleware, (req, res) => {
    const { agentId } = req.params;
    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const conversationId = req.query.conversationId || DEFAULT_CONVERSATION_ID;

    const messages = db.data.messages
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-limit);

    // Build user map
    const userMap = {};
    messages.forEach((m) => {
        const user = db.data.users.find((u) => u.id === m.senderId);
        if (user) {
            userMap[user.id] = sanitizeUser(user);
        }
    });

    res.json({
        messages: messages.map(normalizeMessage),
        users: Object.values(userMap),
    });
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

// ============ Web Search Tool ============
// POST /agents/:agentId/tools/web-search
// Performs web search using DuckDuckGo (no API key required)
app.post('/agents/:agentId/tools/web-search', agentAuthMiddleware, async (req, res) => {
    const { agentId } = req.params;
    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const { query, maxResults = 5 } = req.body;
    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query is required' });
    }

    try {
        // Use DuckDuckGo HTML search (no API key needed)
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
        }

        const html = await response.text();

        // Parse results from DuckDuckGo HTML response
        const results = [];
        let match;

        // Method 1: Parse each result block separately
        const resultBlockRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;
        const titleLinkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
        const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
        const snippetAltRegex = /<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

        while ((match = resultBlockRegex.exec(html)) !== null && results.length < maxResults) {
            const block = match[1];
            const titleMatch = titleLinkRegex.exec(block);
            if (!titleMatch) continue;

            const url = titleMatch[1];
            const title = titleMatch[2].replace(/<[^>]*>/g, '').trim(); // Strip inner HTML tags

            // Try to find snippet
            let snippet = '';
            const snippetMatch = snippetRegex.exec(block) || snippetAltRegex.exec(block);
            if (snippetMatch) {
                snippet = snippetMatch[1].replace(/<[^>]*>/g, '').trim(); // Strip HTML tags
            }

            // Skip ads and empty results
            if (url && title && !url.includes('duckduckgo.com/y.js')) {
                results.push({ title, url, snippet });
            }
        }

        // Fallback: simpler line-by-line parsing
        if (results.length === 0) {
            // Try to find result__a links with their snippets
            const simpleResultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
            const allTitles = [];
            while ((match = simpleResultRegex.exec(html)) !== null) {
                allTitles.push({ url: match[1], title: match[2].trim() });
            }

            // Find all snippets
            const allSnippets = [];
            const simpleSnippetRegex = /class="result__snippet"[^>]*>([^<]+)</gi;
            while ((match = simpleSnippetRegex.exec(html)) !== null) {
                allSnippets.push(match[1].trim());
            }

            for (let i = 0; i < Math.min(allTitles.length, maxResults); i++) {
                if (allTitles[i].url && allTitles[i].title) {
                    results.push({
                        title: allTitles[i].title,
                        url: allTitles[i].url,
                        snippet: allSnippets[i] || ''
                    });
                }
            }
        }

        console.log(`[WebSearch] Agent ${agentId} searched for "${query}", found ${results.length} results`);

        // Optionally fetch content from top results for richer context
        const fetchContent = req.body.fetchContent !== false; // Default true
        if (fetchContent && results.length > 0) {
            const contentPromises = results.slice(0, 3).map(async (result, index) => {
                try {
                    // Decode DuckDuckGo redirect URL
                    let targetUrl = result.url;
                    if (targetUrl.includes('duckduckgo.com/l/')) {
                        const urlMatch = targetUrl.match(/uddg=([^&]+)/);
                        if (urlMatch) {
                            targetUrl = decodeURIComponent(urlMatch[1]);
                        }
                    }
                    // Ensure URL has protocol
                    if (targetUrl.startsWith('//')) {
                        targetUrl = 'https:' + targetUrl;
                    }
                    if (!targetUrl.startsWith('http')) {
                        targetUrl = 'https://' + targetUrl;
                    }

                    const pageResponse = await fetch(targetUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        },
                        timeout: 5000,
                        signal: AbortSignal.timeout(5000),
                    });

                    if (pageResponse.ok) {
                        const pageHtml = await pageResponse.text();
                        // Extract text content (simple approach - remove HTML tags)
                        let textContent = pageHtml
                            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
                            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
                            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();

                        // Take first 800 characters of meaningful content
                        if (textContent.length > 800) {
                            textContent = textContent.substring(0, 800) + '...';
                        }

                        result.content = textContent;
                        result.actualUrl = targetUrl;
                        console.log(`[WebSearch] Fetched content from ${targetUrl.substring(0, 50)}...`);
                    }
                } catch (fetchError) {
                    console.log(`[WebSearch] Could not fetch content from result ${index + 1}: ${fetchError.message}`);
                }
            });

            await Promise.allSettled(contentPromises);
        }

        res.json({ query, results, source: 'duckduckgo' });
    } catch (error) {
        console.error(`[WebSearch] Error:`, error.message);
        res.status(500).json({ error: 'Web search failed', details: error.message });
    }
});

// ============ Local RAG Tool ============
// Initialize SHARED knowledge base storage (all agents share this)
db.data.knowledgeBase ||= { documents: [], chunks: [] };

// Helper function to chunk document content
const chunkDocument = (content, filename, docId) => {
    const chunkSize = 500;  // characters per chunk
    const chunks = [];

    // Split by paragraphs first
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = '';
    let chunkIndex = 0;

    for (const para of paragraphs) {
        if (currentChunk.length + para.length < chunkSize) {
            currentChunk += (currentChunk ? '\n\n' : '') + para;
        } else {
            if (currentChunk) {
                chunks.push({
                    id: `${docId}-chunk-${chunkIndex}`,
                    documentId: docId,
                    source: filename,
                    content: currentChunk.trim(),
                    chunkIndex: chunkIndex++,
                });
            }
            currentChunk = para;
        }
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
        chunks.push({
            id: `${docId}-chunk-${chunkIndex}`,
            documentId: docId,
            source: filename,
            content: currentChunk.trim(),
            chunkIndex: chunkIndex,
        });
    }

    return chunks;
};

// POST /agents/:agentId/tools/local-rag
// Query the SHARED knowledge base
app.post('/agents/:agentId/tools/local-rag', agentAuthMiddleware, async (req, res) => {
    const { agentId } = req.params;
    const agent = db.data.agents.find((a) => a.id === agentId);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const { query, topK = 5 } = req.body;
    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query is required' });
    }

    const kb = db.data.knowledgeBase;
    if (!kb || !kb.chunks || kb.chunks.length === 0) {
        return res.json({
            query,
            chunks: [],
            message: 'No documents in knowledge base'
        });
    }

    // Simple keyword-based retrieval (can be replaced with embeddings later)
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    const scoredChunks = kb.chunks.map(chunk => {
        const content = chunk.content.toLowerCase();
        let score = 0;

        // Score based on term frequency
        queryTerms.forEach(term => {
            const regex = new RegExp(term, 'gi');
            const matches = content.match(regex);
            if (matches) {
                score += matches.length;
            }
        });

        // Boost for exact phrase match
        if (content.includes(query.toLowerCase())) {
            score += 10;
        }

        return { ...chunk, score };
    });

    // Sort by score and take top K
    const topChunks = scoredChunks
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(c => ({
            content: c.content,
            source: c.source,
            score: c.score / (queryTerms.length + 10),  // Normalize score
            chunkIndex: c.chunkIndex,
        }));

    console.log(`[LocalRAG] Agent ${agentId} queried "${query}", found ${topChunks.length} relevant chunks`);
    res.json({ query, chunks: topChunks });
});

// POST /knowledge-base/upload
// Upload a document to the SHARED knowledge base (called when user attaches file in chat)
app.post('/knowledge-base/upload', authMiddleware, async (req, res) => {
    const { content, filename, type = 'text', messageId } = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Document content is required' });
    }

    // Ensure knowledge base is initialized
    if (!db.data.knowledgeBase) {
        db.data.knowledgeBase = { documents: [], chunks: [] };
    }
    if (!db.data.knowledgeBase.documents) {
        db.data.knowledgeBase.documents = [];
    }
    if (!db.data.knowledgeBase.chunks) {
        db.data.knowledgeBase.chunks = [];
    }

    const kb = db.data.knowledgeBase;
    const docId = randomUUID();
    const timestamp = Date.now();

    // Add document metadata
    kb.documents.push({
        id: docId,
        filename: filename || `document-${docId.slice(0, 8)}`,
        type,
        size: content.length,
        uploadedAt: timestamp,
        uploadedBy: req.user.id,
        messageId: messageId || null,  // Link to the message that attached this file
    });

    // Chunk the document
    const chunks = chunkDocument(content, filename || `document-${docId.slice(0, 8)}`, docId);

    // Add chunks to knowledge base
    kb.chunks.push(...chunks);

    await db.write();

    console.log(`[LocalRAG] User ${req.user.name} uploaded document "${filename}", created ${chunks.length} chunks`);
    res.json({
        documentId: docId,
        filename: filename || `document-${docId.slice(0, 8)}`,
        chunksCreated: chunks.length,
        totalDocuments: kb.documents.length,
        totalChunks: kb.chunks.length,
    });
});

// GET /knowledge-base/documents
// List all documents in the SHARED knowledge base
app.get('/knowledge-base/documents', authMiddleware, (req, res) => {
    const kb = db.data.knowledgeBase;
    if (!kb) {
        return res.json({ documents: [], totalChunks: 0 });
    }

    res.json({
        documents: kb.documents || [],
        totalChunks: kb.chunks?.length || 0,
    });
});

// DELETE /knowledge-base/documents/:documentId
// Delete a document from the SHARED knowledge base
app.delete('/knowledge-base/documents/:documentId', authMiddleware, async (req, res) => {
    const { documentId } = req.params;

    const kb = db.data.knowledgeBase;
    if (!kb) {
        return res.status(404).json({ error: 'Knowledge base not found' });
    }

    const docIndex = kb.documents.findIndex(d => d.id === documentId);
    if (docIndex === -1) {
        return res.status(404).json({ error: 'Document not found' });
    }

    // Remove document and its chunks
    const removedDoc = kb.documents.splice(docIndex, 1)[0];
    kb.chunks = kb.chunks.filter(c => c.documentId !== documentId);

    await db.write();

    console.log(`[LocalRAG] Deleted document ${removedDoc.filename}`);
    res.json({
        success: true,
        deletedDocument: removedDoc.filename,
        remainingDocuments: kb.documents.length,
        remainingChunks: kb.chunks.length,
    });
});

app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
});
