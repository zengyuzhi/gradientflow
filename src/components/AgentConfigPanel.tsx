import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { useChat } from '../context/ChatContext';
import { Agent, AgentConfigPayload } from '../types/chat';

interface AgentFormState {
    id?: string;
    name: string;
    description: string;
    avatar: string;
    status: 'active' | 'inactive';
    systemPrompt: string;
    model: { provider: string; name: string; temperature: number; maxTokens: number };
    capabilities: {
        answer_active: boolean;
        answer_passive: boolean;
        like: boolean;
        summarize: boolean;
    };
    runtime: { type: string; endpoint: string; apiKeyAlias: string };
    tools: string[];
    userId?: string;
}

// 能力配置：每个能力对应需要的工具
const CAPABILITY_CONFIG = {
    answer_passive: {
        label: '被动回答',
        description: '被 @ 时回复消息',
        requiredTools: ['chat.send_message', 'chat.reply_to_message'],
    },
    answer_active: {
        label: '主动插话',
        description: '主动参与对话（未 @ 时也可能回复）',
        requiredTools: ['chat.send_message', 'chat.reply_to_message'],
    },
    like: {
        label: '表情回应',
        description: '对消息添加表情反应',
        requiredTools: ['chat.react_to_message'],
    },
    summarize: {
        label: '对话总结',
        description: '生成对话摘要',
        requiredTools: ['chat.send_message', 'chat.get_recent_history'],
    },
} as const;

const PROVIDERS = ['openai', 'azure', 'anthropic', 'parallax', 'custom'];
const RUNTIMES = ['internal-function-calling', 'function-calling-proxy', 'mcp', 'custom'];

const buildFormState = (agent?: Agent): AgentFormState => ({
    id: agent?.id,
    name: agent?.name || '',
    description: agent?.description || '',
    avatar: agent?.avatar || agent?.user?.avatar || '',
    status: agent?.status || 'active',
    systemPrompt:
        agent?.systemPrompt ||
        '你是一位友好的聊天助手，请结合上下文提供精简、准确的回答，必要时引用消息内容。',
    model: {
        provider: agent?.model?.provider || 'openai',
        name: agent?.model?.name || 'gpt-4o-mini',
        temperature: agent?.model?.temperature ?? 0.6,
        maxTokens: agent?.model?.maxTokens ?? 800,
    },
    capabilities: {
        answer_active: agent?.capabilities?.answer_active ?? false,
        answer_passive: agent?.capabilities?.answer_passive ?? true,
        like: agent?.capabilities?.like ?? false,
        summarize: agent?.capabilities?.summarize ?? false,
    },
    runtime: {
        type: agent?.runtime?.type || 'internal-function-calling',
        endpoint: (agent?.runtime?.endpoint as string) || '',
        apiKeyAlias: (agent?.runtime?.apiKeyAlias as string) || '',
    },
    tools: agent?.tools?.length ? agent.tools : ['chat.send_message'],
    userId: agent?.userId,
});

const toPayload = (state: AgentFormState): AgentConfigPayload => {
    const runtime = {
        ...state.runtime,
        endpoint: state.runtime.endpoint.trim() || undefined,
        apiKeyAlias: state.runtime.apiKeyAlias.trim() || undefined,
    };
    const tools = Array.from(new Set(state.tools.filter(Boolean)));

    return {
        id: state.id,
        name: state.name.trim(),
        description: state.description.trim() || undefined,
        avatar: state.avatar.trim() || undefined,
        status: state.status,
        systemPrompt: state.systemPrompt.trim(),
        model: { ...state.model },
        capabilities: { ...state.capabilities },
        runtime,
        tools,
        userId: state.userId || undefined,
    };
};

interface AgentConfigPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AgentConfigPanel = ({ isOpen, onClose }: AgentConfigPanelProps) => {
    const { state, dispatch } = useChat();
    const [selectedId, setSelectedId] = useState<string>('new');
    const [formState, setFormState] = useState<AgentFormState>(() => buildFormState());
    const [busy, setBusy] = useState(false);

    const activeAgent = useMemo(
        () => (selectedId === 'new' ? undefined : state.agents.find((agent) => agent.id === selectedId)),
        [selectedId, state.agents],
    );

    const orderedAgents = useMemo(
        () =>
            [...state.agents].sort((a, b) => {
                const ta = a.updatedAt || a.createdAt || 0;
                const tb = b.updatedAt || b.createdAt || 0;
                return tb - ta;
            }),
        [state.agents],
    );

    useEffect(() => {
        if (!isOpen) return;
        if (selectedId === 'new') {
            setFormState(buildFormState());
            return;
        }
        const match = state.agents.find((agent) => agent.id === selectedId);
        if (match) {
            setFormState(buildFormState(match));
        } else {
            setSelectedId('new');
            setFormState(buildFormState());
        }
    }, [isOpen, selectedId, state.agents]);

    const refreshAgents = useCallback(
        async (opts?: { silent?: boolean }) => {
            try {
                const res = await api.agents.list();
                dispatch({ type: 'SET_AGENTS', payload: res.agents || [] });
                if (res.users?.length) {
                    dispatch({ type: 'SET_USERS', payload: res.users });
                }
            } catch (err: any) {
                console.error('refresh agents failed', err);
                if (!opts?.silent) {
                    toast.error(err?.body?.error || err?.message || 'Agent 列表刷新失败');
                }
                throw err;
            }
        },
        [dispatch],
    );

    useEffect(() => {
        if (!isOpen) return;
        refreshAgents({ silent: true }).catch(() => undefined);
    }, [isOpen, refreshAgents]);

    const handleSelect = (agent?: Agent) => {
        setSelectedId(agent?.id ?? 'new');
    };

    const handleChange = <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => {
        setFormState((prev) => ({ ...prev, [key]: value }));
    };

    const handleCapabilityToggle = (key: keyof AgentFormState['capabilities']) => {
        setFormState((prev) => {
            const newCapValue = !prev.capabilities[key];
            const config = CAPABILITY_CONFIG[key];
            let newTools = [...prev.tools];

            if (newCapValue) {
                // 开启能力时，自动添加所需工具
                config.requiredTools.forEach((tool) => {
                    if (!newTools.includes(tool)) {
                        newTools.push(tool);
                    }
                });
            } else {
                // 关闭能力时，检查是否有其他能力还需要这些工具
                const otherActiveCapabilities = Object.entries(prev.capabilities)
                    .filter(([k, v]) => k !== key && v)
                    .map(([k]) => k as keyof typeof CAPABILITY_CONFIG);

                const stillNeededTools = new Set<string>();
                otherActiveCapabilities.forEach((capKey) => {
                    CAPABILITY_CONFIG[capKey].requiredTools.forEach((t) => stillNeededTools.add(t));
                });

                // 只移除不再需要的工具
                config.requiredTools.forEach((tool) => {
                    if (!stillNeededTools.has(tool)) {
                        newTools = newTools.filter((t) => t !== tool);
                    }
                });
            }

            return {
                ...prev,
                capabilities: { ...prev.capabilities, [key]: newCapValue },
                tools: newTools,
            };
        });
    };

    const handleSave = async (evt?: FormEvent) => {
        evt?.preventDefault();
        if (!formState.name.trim()) {
            toast.error('请填写 Agent 名称');
            return;
        }
        if (busy) return;
        setBusy(true);
        try {
            const payload = toPayload(formState);
            const result = formState.id
                ? await api.agents.update(formState.id, payload)
                : await api.agents.create(payload);
            await refreshAgents();
            handleSelect(result.agent);
            toast.success(formState.id ? 'Agent 已更新' : 'Agent 已创建');
        } catch (err: any) {
            console.error('save agent failed', err);
            toast.error(err?.body?.error || err?.message || '保存失败');
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!formState.id || busy) return;
        setBusy(true);
        try {
            const result = await api.agents.remove(formState.id);
            // Remove the associated user from the users list
            if (result.deletedUserId) {
                dispatch({ type: 'REMOVE_USER', payload: { userId: result.deletedUserId } });
            }
            await refreshAgents();
            handleSelect(undefined);
            toast.success('Agent 已删除');
        } catch (err: any) {
            console.error('delete agent failed', err);
            toast.error(err?.body?.error || err?.message || '删除失败');
        } finally {
            setBusy(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="agent-config-overlay">
            <div className="agent-config-modal">
                <header className="agent-config-header">
                    <div>
                        <h2>Agent 配置中心</h2>
                        <p>配置房间内可用的 LLM Agent，支持自定义模型、能力与运行时。</p>
                    </div>
                    <button className="ghost-btn" onClick={onClose} aria-label="close agent config">
                        <X size={18} />
                    </button>
                </header>

                <div className="agent-config-content">
                    <aside className="agent-config-sidebar">
                        <div className="sidebar-header">
                            <span>Agent 列表</span>
                            <button className="secondary-btn" onClick={() => handleSelect(undefined)}>
                                <Plus size={14} />
                                新建
                            </button>
                        </div>
                        {orderedAgents.length === 0 ? (
                            <div className="empty-block">
                                <Bot size={28} />
                                <p>暂无 Agent，点击「新建」创建一个。</p>
                            </div>
                        ) : (
                            <div className="agent-items">
                                {orderedAgents.map((agent) => (
                                    <button
                                        key={agent.id}
                                        onClick={() => handleSelect(agent)}
                                        className={clsx('agent-item', selectedId === agent.id && 'active')}
                                    >
                                        <div className="avatar">
                                            <img
                                                src={
                                                    agent.avatar ||
                                                    agent.user?.avatar ||
                                                    `https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`
                                                }
                                                alt={agent.name}
                                            />
                                        </div>
                                        <div className="meta">
                                            <div className="title-row">
                                                <strong>{agent.name}</strong>
                                                <span className={clsx('status-dot', agent.status || 'active')} />
                                            </div>
                                            <small>{agent.model?.name || 'gpt-4o-mini'}</small>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </aside>

                    <form className="agent-config-form" onSubmit={handleSave}>
                        <div className="agent-highlight">
                            <div className="highlight-avatar">
                                <img
                                    src={
                                        formState.avatar ||
                                        activeAgent?.avatar ||
                                        activeAgent?.user?.avatar ||
                                        `https://api.dicebear.com/7.x/bottts/svg?seed=${formState.name || 'agent-draft'}`
                                    }
                                    alt="agent avatar"
                                />
                            </div>
                            <div className="highlight-meta">
                                <div className="highlight-row">
                                    <strong>{formState.name || activeAgent?.name || '新建 Agent'}</strong>
                                    <span className={clsx('status-pill', formState.status)}>
                                        {formState.status === 'active' ? '已启用' : '已停用'}
                                    </span>
                                </div>
                                <p>{formState.description || activeAgent?.description || '填写基础信息即可创建自定义 Agent。'}</p>
                            </div>
                        </div>

                        <section>
                            <div className="section-title">基础信息</div>
                            <label>
                                名称
                                <input value={formState.name} onChange={(e) => handleChange('name', e.target.value)} />
                            </label>
                            <label>
                                描述
                                <input
                                    value={formState.description}
                                    onChange={(e) => handleChange('description', e.target.value)}
                                />
                            </label>
                            <label>
                                头像 URL
                                <input value={formState.avatar} onChange={(e) => handleChange('avatar', e.target.value)} />
                            </label>
                            <label>
                                状态
                                <select value={formState.status} onChange={(e) => handleChange('status', e.target.value as any)}>
                                    <option value="active">启用</option>
                                    <option value="inactive">停用</option>
                                </select>
                            </label>
                        </section>

                        <section>
                            <div className="section-title">模型 & Prompt</div>
                            <label>
                                供应商
                                <select
                                    value={formState.model.provider}
                                    onChange={(e) => {
                                        const newProvider = e.target.value;
                                        setFormState((prev) => ({
                                            ...prev,
                                            model: {
                                                ...prev.model,
                                                provider: newProvider,
                                                // 选择 parallax 时自动设置默认模型名
                                                name: newProvider === 'parallax' ? 'default' : prev.model.name,
                                            },
                                        }));
                                    }}
                                >
                                    {PROVIDERS.map((provider) => (
                                        <option key={provider} value={provider}>
                                            {provider}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                模型名称
                                <input
                                    value={formState.model.name}
                                    onChange={(e) =>
                                        setFormState((prev) => ({ ...prev, model: { ...prev.model, name: e.target.value } }))
                                    }
                                />
                            </label>
                            <div className="inline-inputs">
                                <label>
                                    温度
                                    <input
                                        type="number"
                                        min={0}
                                        max={2}
                                        step={0.1}
                                        value={formState.model.temperature}
                                        onChange={(e) =>
                                            setFormState((prev) => ({
                                                ...prev,
                                                model: { ...prev.model, temperature: Number(e.target.value) },
                                            }))
                                        }
                                    />
                                </label>
                                <label>
                                    Max Tokens
                                    <input
                                        type="number"
                                        min={128}
                                        max={16000}
                                        value={formState.model.maxTokens}
                                        onChange={(e) =>
                                            setFormState((prev) => ({
                                                ...prev,
                                                model: { ...prev.model, maxTokens: Number(e.target.value) },
                                            }))
                                        }
                                    />
                                </label>
                            </div>
                            <label>
                                系统 Prompt
                                <textarea
                                    rows={3}
                                    value={formState.systemPrompt}
                                    onChange={(e) => handleChange('systemPrompt', e.target.value)}
                                />
                            </label>
                        </section>

                        <section>
                            <div className="section-title">能力 & 工具</div>
                            <p className="section-hint">开启能力会自动启用所需工具</p>
                            <div className="capability-cards">
                                {(Object.entries(CAPABILITY_CONFIG) as [keyof typeof CAPABILITY_CONFIG, typeof CAPABILITY_CONFIG[keyof typeof CAPABILITY_CONFIG]][]).map(([key, config]) => {
                                    const isActive = formState.capabilities[key];
                                    return (
                                        <button
                                            type="button"
                                            key={key}
                                            className={clsx('capability-card', isActive && 'active')}
                                            onClick={() => handleCapabilityToggle(key)}
                                        >
                                            <div className="cap-header">
                                                <span className="cap-label">{config.label}</span>
                                                <span className={clsx('cap-toggle', isActive && 'on')}>{isActive ? '已开启' : '关闭'}</span>
                                            </div>
                                            <p className="cap-desc">{config.description}</p>
                                            <div className="cap-tools">
                                                {config.requiredTools.map((tool) => (
                                                    <span key={tool} className="tool-tag">{tool.replace('chat.', '')}</span>
                                                ))}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            {formState.tools.length > 0 && (
                                <div className="active-tools">
                                    <span className="tools-label">已启用工具：</span>
                                    {formState.tools.map((tool) => (
                                        <span key={tool} className="tool-badge">{tool}</span>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section>
                            <div className="section-title">运行时</div>
                            <label>
                                Runtime
                                <select
                                    value={formState.runtime.type}
                                    onChange={(e) => handleChange('runtime', { ...formState.runtime, type: e.target.value })}
                                >
                                    {RUNTIMES.map((type) => (
                                        <option key={type} value={type}>
                                            {type}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                Endpoint / MCP URL
                                <input
                                    value={formState.runtime.endpoint}
                                    onChange={(e) => handleChange('runtime', { ...formState.runtime, endpoint: e.target.value })}
                                    placeholder={formState.model.provider === 'parallax' ? 'https://your-llm-endpoint/v1' : ''}
                                />
                            </label>
                            <label>
                                API Key 标识
                                <input
                                    value={formState.runtime.apiKeyAlias}
                                    onChange={(e) => handleChange('runtime', { ...formState.runtime, apiKeyAlias: e.target.value })}
                                />
                            </label>
                        </section>

                        <div className="form-actions">
                            {formState.id && (
                                <button type="button" className="danger-btn" disabled={busy} onClick={handleDelete}>
                                    <Trash2 size={14} />
                                    删除
                                </button>
                            )}
                            <div className="spacer" />
                            <button type="button" className="ghost-btn" onClick={onClose}>
                                取消
                            </button>
                            <button type="submit" className="primary-btn" disabled={busy}>
                                {busy ? '保存中...' : '保存'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <style>{`
                .agent-config-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(8, 15, 35, 0.55);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: flex-start;
                    justify-content: center;
                    padding: 32px;
                    z-index: 120;
                }
                .agent-config-modal {
                    width: min(1100px, 100%);
                    background: var(--bg-primary);
                    border-radius: 20px;
                    box-shadow: 0 30px 80px rgba(15, 23, 42, 0.35);
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }
                .agent-config-header {
                    display: flex;
                    justify-content: space-between;
                    gap: 16px;
                }
                .agent-config-header h2 {
                    margin: 0;
                }
                .agent-config-header p {
                    margin: 4px 0 0;
                    color: var(--text-secondary);
                }
                .agent-config-content {
                    display: grid;
                    grid-template-columns: 280px 1fr;
                    gap: 20px;
                }
                .agent-config-sidebar {
                    border: 1px solid var(--border-light);
                    border-radius: 16px;
                    padding: 16px;
                    background: var(--bg-secondary);
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .sidebar-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .agent-items {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: 420px;
                    overflow-y: auto;
                    padding: 6px 4px;
                }
                .agent-item {
                    border-radius: 12px;
                    padding: 10px;
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    border: 1px solid transparent;
                    background: var(--bg-primary);
                    text-align: left;
                    transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
                }
                .agent-item.active {
                    border-color: var(--accent-primary);
                    box-shadow: 0 6px 18px rgba(51, 144, 236, 0.12);
                    outline: 2px solid rgba(51, 144, 236, 0.35);
                    outline-offset: 2px;
                    transform: translateY(-1px);
                }
                .agent-item:hover {
                    border-color: var(--border-light);
                    transform: translateY(-1px);
                }
                .avatar {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    overflow: hidden;
                }
                .avatar img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .meta {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .title-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #10b981;
                }
                .status-dot.inactive {
                    background: #f97316;
                }
                .agent-config-form {
                    border: 1px solid var(--border-light);
                    border-radius: 16px;
                    padding: 18px;
                    background: var(--bg-secondary);
                    display: flex;
                    flex-direction: column;
                    gap: 18px;
                    max-height: 75vh;
                    overflow-y: auto;
                }
                .agent-highlight {
                    display: grid;
                    grid-template-columns: auto 1fr;
                    gap: 12px;
                    align-items: center;
                    padding: 12px 14px;
                    border-radius: 14px;
                    background: linear-gradient(120deg, rgba(51, 144, 236, 0.12), rgba(51, 144, 236, 0.05));
                    border: 1px solid rgba(51, 144, 236, 0.25);
                    box-shadow: 0 10px 30px rgba(51, 144, 236, 0.15);
                }
                .highlight-avatar {
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 2px solid rgba(255, 255, 255, 0.6);
                    background: #0f172a;
                }
                .highlight-avatar img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .highlight-meta {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .highlight-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .highlight-meta p {
                    margin: 0;
                    color: var(--text-secondary);
                    font-size: 0.9rem;
                }
                .status-pill {
                    padding: 4px 10px;
                    border-radius: 999px;
                    font-size: 0.8rem;
                    background: rgba(51, 144, 236, 0.15);
                    color: var(--accent-primary);
                    border: 1px solid rgba(51, 144, 236, 0.35);
                }
                .status-pill.inactive {
                    background: rgba(239, 68, 68, 0.12);
                    color: #ef4444;
                    border-color: rgba(239, 68, 68, 0.25);
                }
                section {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                label {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    color: var(--text-secondary);
                    font-size: 0.9rem;
                }
                input, select, textarea {
                    border-radius: 10px;
                    border: 1px solid var(--border-light);
                    padding: 8px 10px;
                    background: var(--bg-primary);
                    color: var(--text-primary);
                    transition: border-color 0.2s ease, box-shadow 0.2s ease;
                }
                input:focus, select:focus, textarea:focus {
                    border-color: var(--accent-primary);
                    box-shadow: 0 0 0 3px rgba(51, 144, 236, 0.12);
                    outline: none;
                }
                textarea {
                    resize: vertical;
                }
                .section-title {
                    font-weight: 600;
                    color: var(--text-primary);
                }
                .section-hint {
                    margin: 0;
                    font-size: 0.8rem;
                    color: var(--text-tertiary);
                }
                .capability-cards {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 10px;
                }
                .capability-card {
                    border-radius: 14px;
                    border: 1px solid var(--border-light);
                    padding: 14px;
                    background: var(--bg-primary);
                    text-align: left;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .capability-card:hover {
                    border-color: rgba(51, 144, 236, 0.4);
                    transform: translateY(-1px);
                }
                .capability-card.active {
                    border-color: var(--accent-primary);
                    background: linear-gradient(135deg, rgba(51, 144, 236, 0.08), rgba(51, 144, 236, 0.02));
                    box-shadow: 0 4px 16px rgba(51, 144, 236, 0.12);
                }
                .cap-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .cap-label {
                    font-weight: 600;
                    color: var(--text-primary);
                    font-size: 0.95rem;
                }
                .cap-toggle {
                    font-size: 0.7rem;
                    padding: 3px 8px;
                    border-radius: 999px;
                    background: rgba(0, 0, 0, 0.06);
                    color: var(--text-tertiary);
                }
                .cap-toggle.on {
                    background: rgba(16, 185, 129, 0.15);
                    color: #10b981;
                }
                .cap-desc {
                    margin: 0;
                    font-size: 0.82rem;
                    color: var(--text-secondary);
                    line-height: 1.4;
                }
                .cap-tools {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                    margin-top: 4px;
                }
                .tool-tag {
                    font-size: 0.7rem;
                    padding: 2px 6px;
                    border-radius: 4px;
                    background: rgba(124, 58, 237, 0.1);
                    color: #7c3aed;
                    font-family: monospace;
                }
                .active-tools {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 6px;
                    padding: 10px 12px;
                    background: rgba(51, 144, 236, 0.06);
                    border-radius: 10px;
                    border: 1px dashed rgba(51, 144, 236, 0.2);
                }
                .tools-label {
                    font-size: 0.8rem;
                    color: var(--text-secondary);
                }
                .tool-badge {
                    font-size: 0.75rem;
                    padding: 3px 8px;
                    border-radius: 6px;
                    background: var(--accent-primary);
                    color: #fff;
                    font-family: monospace;
                }
                .inline-inputs {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                    gap: 12px;
                }
                .capability-row {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .chip {
                    padding: 6px 14px;
                    border-radius: 999px;
                    border: 1px solid var(--border-light);
                    background: var(--bg-primary);
                    cursor: pointer;
                    font-size: 0.85rem;
                }
                .chip.active {
                    border-color: var(--accent-primary);
                    color: var(--accent-primary);
                    background: rgba(51, 144, 236, 0.1);
                }
                .tool-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                    gap: 8px;
                }
                .tool-chip {
                    border-radius: 12px;
                    border: 1px dashed var(--border-light);
                    padding: 8px 10px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 0.8rem;
                    transition: border-color 0.2s ease, background 0.2s ease;
                }
                .tool-chip.checked {
                    border-style: solid;
                    border-color: var(--accent-primary);
                    background: rgba(51, 144, 236, 0.08);
                }
                .tool-chip input {
                    margin: 0;
                }
                .form-actions {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .spacer {
                    flex: 1;
                }
                .primary-btn, .secondary-btn, .ghost-btn, .danger-btn {
                    border-radius: 999px;
                    padding: 8px 16px;
                    border: 1px solid transparent;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 600;
                }
                .primary-btn {
                    background: linear-gradient(120deg, #3390ec, #5fbdff);
                    color: #fff;
                    border: none;
                    box-shadow: 0 8px 25px rgba(51, 144, 236, 0.25);
                }
                .secondary-btn {
                    border: 1px solid var(--border-light);
                    background: var(--bg-primary);
                    color: var(--text-primary);
                    transition: background 0.2s ease, box-shadow 0.2s ease;
                }
                .ghost-btn {
                    background: transparent;
                    color: var(--text-secondary);
                }
                .danger-btn {
                    border: 1px solid rgba(239, 68, 68, 0.3);
                    color: #ef4444;
                    background: rgba(239, 68, 68, 0.1);
                }
                .empty-block {
                    border: 1px dashed var(--border-light);
                    border-radius: 14px;
                    padding: 20px;
                    text-align: center;
                    color: var(--text-secondary);
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    align-items: center;
                }
                @media (max-width: 980px) {
                    .agent-config-content {
                        grid-template-columns: 1fr;
                        max-height: 70vh;
                        overflow-y: auto;
                    }
                }
                @media (max-width: 640px) {
                    .agent-config-overlay {
                        padding: 16px;
                    }
                    .agent-config-modal {
                        padding: 16px;
                    }
                }
            `}</style>
        </div>
    );
};
