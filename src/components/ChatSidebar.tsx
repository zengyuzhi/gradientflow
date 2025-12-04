import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import {
    X,
    FileText,
    Link2,
    Image,
    CheckSquare,
    MessageSquare,
    Users,
    ExternalLink,
    Loader2,
    Sparkles,
    Clock,
    User as UserIcon,
    AlertCircle,
    StopCircle,
    Clipboard,
    ClipboardCheck,
    Copy,
    RotateCcw,
    Settings,
    ChevronDown,
    ChevronRight,
    Maximize2,
} from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { User } from '../types/chat';
import { api } from '../api/client';
import clsx from 'clsx';

type TabType = 'content' | 'tasks' | 'participants';
type ContentSubTab = 'documents' | 'links' | 'media';

interface ExtractedDocument {
    id: string;
    filename: string;
    sender: User | undefined;
    timestamp: number;
    messageId: string;
}

interface ExtractedLink {
    url: string;
    domain: string;
    sender: User | undefined;
    timestamp: number;
    messageId: string;
}

interface ExtractedTodo {
    id: string;
    text: string;
    sender: User | undefined;
    timestamp: number;
    messageId: string;
}

interface ChatSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings?: () => void;
}

// URL regex pattern
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// TODO patterns to detect
const TODO_PATTERNS = [
    /TODO[:\s]+(.+?)(?:\n|$)/gi,
    /\[ \]\s*(.+?)(?:\n|$)/gi,
    /(?:we should|let's|need to|have to|must)\s+(.+?)(?:\.|!|\n|$)/gi,
    /(?:action item|task|待办|任务)[:\s]+(.+?)(?:\n|$)/gi,
];

// API base URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ isOpen, onClose, onOpenSettings }) => {
    const { state } = useChat();
    const [activeTab, setActiveTab] = useState<TabType>('content');
    const [contentSubTab, setContentSubTab] = useState<ContentSubTab>('documents');
    const [reasoning, setReasoning] = useState<string>('');
    const [summary, setSummary] = useState<string>('');
    const [summaryError, setSummaryError] = useState<string>('');
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingPhase, setStreamingPhase] = useState<'idle' | 'reasoning' | 'output'>('idle');
    const [completedTasks, setCompletedTasks] = useState<Record<string, boolean>>({});
    const [taskCopyStatus, setTaskCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [summaryCopyStatus, setSummaryCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [llmStatus, setLlmStatus] = useState<'idle' | 'loading' | 'configured' | 'not-configured' | 'error'>('idle');
    const [summaryLanguage, setSummaryLanguage] = useState<'zh' | 'en'>('zh');
    const [isSummaryExpanded, setIsSummaryExpanded] = useState(true);
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const reasoningRef = useRef<HTMLDivElement>(null);
    const rawContentRef = useRef<string>('');

    // Load LLM config status when the Tasks tab is active
    useEffect(() => {
        if (!isOpen || activeTab !== 'tasks') return;

        let cancelled = false;
        const loadStatus = async () => {
            try {
                setLlmStatus('loading');
                const cfg = await api.llm.getConfig();
                if (cancelled) return;
                if (cfg.endpoint && cfg.endpoint.trim().length > 0) {
                    setLlmStatus('configured');
                } else {
                    setLlmStatus('not-configured');
                }
            } catch (err) {
                console.error('Failed to load LLM status', err);
                if (!cancelled) {
                    setLlmStatus('error');
                }
            }
        };

        loadStatus();

        return () => {
            cancelled = true;
        };
    }, [isOpen, activeTab]);

    // Extract documents from messages
    const documents = useMemo<ExtractedDocument[]>(() => {
        const docs: ExtractedDocument[] = [];
        state.messages.forEach((msg) => {
            const attachment = msg.metadata?.attachment as {
                filename?: string;
                documentId?: string;
            } | undefined;
            if (attachment?.filename) {
                docs.push({
                    id: attachment.documentId || msg.id,
                    filename: attachment.filename,
                    sender: state.users.find((u) => u.id === msg.senderId),
                    timestamp: msg.timestamp,
                    messageId: msg.id,
                });
            }
        });
        return docs.sort((a, b) => b.timestamp - a.timestamp);
    }, [state.messages, state.users]);

    // Extract links from messages
    const links = useMemo<ExtractedLink[]>(() => {
        const extractedLinks: ExtractedLink[] = [];
        const seenUrls = new Set<string>();

        state.messages.forEach((msg) => {
            const matches = msg.content.match(URL_REGEX);
            if (matches) {
                matches.forEach((url) => {
                    if (!seenUrls.has(url)) {
                        seenUrls.add(url);
                        let domain = '';
                        try {
                            domain = new URL(url).hostname;
                        } catch {
                            domain = url;
                        }
                        extractedLinks.push({
                            url,
                            domain,
                            sender: state.users.find((u) => u.id === msg.senderId),
                            timestamp: msg.timestamp,
                            messageId: msg.id,
                        });
                    }
                });
            }
        });
        return extractedLinks.sort((a, b) => b.timestamp - a.timestamp);
    }, [state.messages, state.users]);

    // Extract media (images) from messages - checking for image URLs
    const media = useMemo(() => {
        const images: ExtractedLink[] = [];
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

        state.messages.forEach((msg) => {
            const matches = msg.content.match(URL_REGEX);
            if (matches) {
                matches.forEach((url) => {
                    const lowerUrl = url.toLowerCase();
                    if (imageExtensions.some((ext) => lowerUrl.includes(ext))) {
                        images.push({
                            url,
                            domain: '',
                            sender: state.users.find((u) => u.id === msg.senderId),
                            timestamp: msg.timestamp,
                            messageId: msg.id,
                        });
                    }
                });
            }
        });
        return images.sort((a, b) => b.timestamp - a.timestamp);
    }, [state.messages, state.users]);

    // Extract TODOs from messages
    const todos = useMemo<ExtractedTodo[]>(() => {
        const extracted: ExtractedTodo[] = [];
        const seenTexts = new Set<string>();

        state.messages.forEach((msg) => {
            const sender = state.users.find((u) => u.id === msg.senderId);
            TODO_PATTERNS.forEach((pattern) => {
                const regex = new RegExp(pattern.source, pattern.flags);
                let match;
                while ((match = regex.exec(msg.content)) !== null) {
                    const text = match[1]?.trim() || match[0].trim();
                    const normalizedText = text.toLowerCase();
                    if (text.length > 1 && text.length < 200 && !seenTexts.has(normalizedText)) {
                        seenTexts.add(normalizedText);
                        const todoId = `${msg.id}-${normalizedText}`;
                        extracted.push({
                            id: todoId,
                            text,
                            sender,
                            timestamp: msg.timestamp,
                            messageId: msg.id,
                        });
                    }
                }
            });
        });
        return extracted.sort((a, b) => b.timestamp - a.timestamp);
    }, [state.messages, state.users]);

    useEffect(() => {
        setCompletedTasks((prev) => {
            const validIds = new Set(todos.map((t) => t.id));
            const next = { ...prev };
            Object.keys(next).forEach((id) => {
                if (!validIds.has(id)) {
                    delete next[id];
                }
            });
            return next;
        });
    }, [todos]);

    // Participants with message counts
    const participants = useMemo(() => {
        const countMap = new Map<string, number>();
        const lastActiveMap = new Map<string, number>();

        state.messages.forEach((msg) => {
            countMap.set(msg.senderId, (countMap.get(msg.senderId) || 0) + 1);
            const current = lastActiveMap.get(msg.senderId) || 0;
            if (msg.timestamp > current) {
                lastActiveMap.set(msg.senderId, msg.timestamp);
            }
        });

        return state.users
            .map((user) => ({
                user,
                messageCount: countMap.get(user.id) || 0,
                lastActive: lastActiveMap.get(user.id) || 0,
            }))
            .sort((a, b) => b.messageCount - a.messageCount);
    }, [state.messages, state.users]);

    const groupedTodos = useMemo(() => {
        const groups = new Map<
            string,
            { sender: User | undefined; todos: ExtractedTodo[]; lastActive: number }
        >();

        todos.forEach((todo) => {
            const senderId = todo.sender?.id || 'unknown';
            const existing = groups.get(senderId) || {
                sender: todo.sender,
                todos: [],
                lastActive: 0,
            };

            const updated = {
                sender: existing.sender ?? todo.sender,
                todos: [...existing.todos, todo],
                lastActive: Math.max(existing.lastActive, todo.timestamp),
            };
            groups.set(senderId, updated);
        });

        return Array.from(groups.values())
            .map((group) => ({
                ...group,
                todos: [...group.todos].sort((a, b) => b.timestamp - a.timestamp),
            }))
            .sort((a, b) => b.lastActive - a.lastActive);
    }, [todos]);

    const pendingTaskCount = useMemo(
        () => todos.reduce((acc, todo) => acc + (completedTasks[todo.id] ? 0 : 1), 0),
        [todos, completedTasks]
    );

    // Stop streaming
    const stopStreaming = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsStreaming(false);
        setLoadingSummary(false);
    };

    const toggleTaskCompletion = (id: string) => {
        setCompletedTasks((prev) => ({
            ...prev,
            [id]: !prev[id],
        }));
    };

    const copyTasksToClipboard = async () => {
        try {
            if (typeof navigator === 'undefined' || !navigator.clipboard) {
                throw new Error('剪贴板不可用');
            }
            const pending = todos.filter((t) => !completedTasks[t.id]);
            const source = pending.length > 0 ? pending : todos;
            const text = source.map((t) => `- ${t.text} (${t.sender?.name || '未知用户'})`).join('\n');
            await navigator.clipboard.writeText(text || '没有找到任务。');
            setTaskCopyStatus('success');
            setTimeout(() => setTaskCopyStatus('idle'), 1400);
        } catch (err) {
            console.error('复制任务失败', err);
            setTaskCopyStatus('error');
            setTimeout(() => setTaskCopyStatus('idle'), 1800);
        }
    };

    const copySummaryToClipboard = async () => {
        if (!summary) return;
        try {
            if (typeof navigator === 'undefined' || !navigator.clipboard) {
                throw new Error('剪贴板不可用');
            }
            await navigator.clipboard.writeText(summary);
            setSummaryCopyStatus('success');
            setTimeout(() => setSummaryCopyStatus('idle'), 1400);
        } catch (err) {
            console.error('复制总结失败', err);
            setSummaryCopyStatus('error');
            setTimeout(() => setSummaryCopyStatus('idle'), 1800);
        }
    };
    // Helper to parse raw content and extract reasoning/output
    const parseRawContent = (raw: string) => {
        const finalMarkerIndex = raw.indexOf('<|channel|>final');

        // Strip special tags helper
        const stripTags = (text: string) => {
            return text
                .replace(/<\|channel\|>analysis/g, '')
                .replace(/<\|channel\|>commentary/g, '')
                .replace(/<\|channel\|>final/g, '')
                .replace(/<\|message\|>/g, '')
                .replace(/<\|end\|>/g, '')
                .replace(/<\|start\|>/g, '')
                .replace(/<\|[^>]+\|>/g, '')
                .trim();
        };

        if (finalMarkerIndex === -1) {
            // Still in reasoning phase
            return {
                reasoning: stripTags(raw),
                output: '',
                phase: 'reasoning' as const
            };
        } else {
            // Has final content
            const reasoningPart = raw.slice(0, finalMarkerIndex);
            const outputPart = raw.slice(finalMarkerIndex);
            return {
                reasoning: stripTags(reasoningPart),
                output: stripTags(outputPart),
                phase: 'output' as const
            };
        }
    };

    // Generate chat summary with streaming
    const generateSummary = async () => {
        if (loadingSummary) return;
        setLoadingSummary(true);
        setIsStreaming(true);
        setStreamingPhase('idle');
        setReasoning('');
        setSummary('');
        setSummaryError('');
        rawContentRef.current = '';

        // Check if there are messages to summarize
        if (state.messages.length === 0) {
            setSummaryError('当前还没有可以总结的消息。');
            setLoadingSummary(false);
            setIsStreaming(false);
            return;
        }

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController();

        try {
            // Get recent messages for summary (latest 50, but API will use last 30)
            const recentMessages = state.messages.slice(-50).map((m) => {
                const sender = state.users.find((u) => u.id === m.senderId);
                return `${sender?.name || '未知用户'}: ${m.content}`;
            });

            // Get auth token from cookie or localStorage
            const token = document.cookie
                .split('; ')
                .find(row => row.startsWith('token='))
                ?.split('=')[1] || localStorage.getItem('token') || '';

            const response = await fetch(`${API_URL}/messages/summarize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ messages: recentMessages, language: summaryLanguage }),
                signal: abortControllerRef.current.signal,
                credentials: 'include',
            });

            // Check if it's a JSON error response (not streaming)
            const contentType = response.headers.get('content-type');
            if (contentType?.includes('application/json')) {
                const errorData = await response.json();
                let message = errorData.error || '生成总结失败';
                if (typeof message === 'string' && message.includes('No LLM endpoint configured')) {
                    message = '还没有配置 LLM Endpoint。请点击右上角 Settings，先在 “AI (LLM) Configuration” 中填写 Endpoint/API Key 后再重试。';
                }
                setSummaryError(message);
                setLoadingSummary(false);
                setIsStreaming(false);
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Process SSE stream
            const reader = response.body?.getReader();
            if (!reader) throw new Error('没有响应体');

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (!data) continue;

                        try {
                            const parsed = JSON.parse(data);

                            if (parsed.error) {
                                setSummaryError(parsed.error);
                                break;
                            }

                            // Handle streaming chunks - parse on frontend
                            if (parsed.type === 'chunk' && parsed.content) {
                                // Accumulate raw content in ref
                                rawContentRef.current += parsed.content;

                                // Parse the accumulated content
                                const { reasoning: parsedReasoning, output: parsedOutput, phase } = parseRawContent(rawContentRef.current);

                                // Update state
                                setReasoning(parsedReasoning);
                                setSummary(parsedOutput);
                                setStreamingPhase(phase);

                                // Auto-scroll reasoning section
                                if (phase === 'reasoning') {
                                    setTimeout(() => {
                                        if (reasoningRef.current) {
                                            reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
                                        }
                                    }, 0);
                                }
                            }

                            if (parsed.done) {
                                // Streaming complete
                                // Use backend's parsed output if provided, otherwise keep what we parsed
                                if (parsed.output) {
                                    setSummary(parsed.output);
                                }
                                setStreamingPhase('idle');
                                break;
                            }
                        } catch {
                            // Skip invalid JSON
                        }
                    }
                }
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') {
                // User cancelled - don't show error
                return;
            }

            console.error('Failed to generate summary:', err);
            const errorMessage = err instanceof Error ? err.message : '生成总结失败';
            setSummaryError(errorMessage);
        } finally {
            setLoadingSummary(false);
            setIsStreaming(false);
            setStreamingPhase('idle');
            abortControllerRef.current = null;
        }
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return '昨天';
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    };

    const renderContentTab = () => (
        <div className="sidebar-section">
            <div className="content-subtabs">
                <button
                    className={clsx('subtab', contentSubTab === 'documents' && 'active')}
                    onClick={() => setContentSubTab('documents')}
                >
                    <FileText size={14} />
                    <span>文件</span>
                    <span className="count">{documents.length}</span>
                </button>
                <button
                    className={clsx('subtab', contentSubTab === 'links' && 'active')}
                    onClick={() => setContentSubTab('links')}
                >
                    <Link2 size={14} />
                    <span>链接</span>
                    <span className="count">{links.length}</span>
                </button>
                <button
                    className={clsx('subtab', contentSubTab === 'media' && 'active')}
                    onClick={() => setContentSubTab('media')}
                >
                    <Image size={14} />
                    <span>媒体</span>
                    <span className="count">{media.length}</span>
                </button>
            </div>

            <div className="content-list">
                {contentSubTab === 'documents' && (
                    documents.length === 0 ? (
                        <div className="empty-state spacious">
                            <div className="empty-illustration">
                                <FileText size={18} />
                            </div>
                            <div className="empty-title">暂时没有文件</div>
                            <div className="empty-hint">在聊天中发送文件后会显示在这里。</div>
                        </div>
                    ) : (
                        documents.map((doc) => (
                            <div key={doc.id} className="content-item">
                                <div className="content-icon doc">
                                    <FileText size={16} />
                                </div>
                                <div className="content-info">
                                    <div className="content-title">{doc.filename}</div>
                                    <div className="content-meta">
                                        <span>{doc.sender?.name || '未知用户'}</span>
                                        <span className="dot">·</span>
                                        <span>{formatTime(doc.timestamp)}</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )
                )}

                {contentSubTab === 'links' && (
                    links.length === 0 ? (
                        <div className="empty-state spacious">
                            <div className="empty-illustration">
                                <Link2 size={18} />
                            </div>
                            <div className="empty-title">暂时没有链接</div>
                            <div className="empty-hint">在聊天中发送网址即可自动收集。</div>
                        </div>
                    ) : (
                        links.map((link, idx) => (
                            <a
                                key={idx}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="content-item link-item"
                            >
                                <div className="content-icon link">
                                    <Link2 size={16} />
                                </div>
                                <div className="content-info">
                                    <div className="content-title">
                                        {link.domain}
                                        <ExternalLink size={12} className="external-icon" />
                                    </div>
                                    <div className="content-meta">
                                        <span>{link.sender?.name || '未知用户'}</span>
                                        <span className="dot">·</span>
                                        <span>{formatTime(link.timestamp)}</span>
                                    </div>
                                </div>
                            </a>
                        ))
                    )
                )}

                {contentSubTab === 'media' && (
                    media.length === 0 ? (
                        <div className="empty-state spacious">
                            <div className="empty-illustration">
                                <Image size={18} />
                            </div>
                            <div className="empty-title">暂时没有媒体</div>
                            <div className="empty-hint">粘贴图片链接或上传图片后会显示在这里。</div>
                        </div>
                    ) : (
                        <div className="media-grid">
                            {media.map((img, idx) => (
                                <a
                                    key={idx}
                                    href={img.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="media-item"
                                >
                                    <img src={img.url} alt="" loading="lazy" />
                                </a>
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );

    const renderTasksTab = () => (
        <div className="sidebar-section">
            {/* LLM Config CTA */}
            <div className="tasks-section">
                <div className="section-header">
                    <Settings size={16} />
                    <span>AI 设置</span>
                </div>
                <div className="llm-cta">
                    <div className="llm-cta-header-row">
                        <span className="llm-cta-title-cn">配置模型和 Key</span>
                        {llmStatus === 'loading' && <span className="status-pill neutral">检测中</span>}
                        {llmStatus === 'configured' && <span className="status-pill success">已配置</span>}
                        {llmStatus === 'not-configured' && <span className="status-pill warning">未配置</span>}
                        {llmStatus === 'error' && <span className="status-pill error">加载失败</span>}
                    </div>
                    <button
                        className="generate-btn compact-btn"
                        onClick={() => {
                            if (onOpenSettings) {
                                onOpenSettings();
                            }
                            onClose();
                        }}
                    >
                        <Settings size={14} />
                        <span>前往设置</span>
                    </button>
                </div>
            </div>

            {/* Summary Section */}
            <div className="tasks-section">
                <div className="section-header" style={{ cursor: 'pointer' }} onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}>
                    <button className="icon-btn-small" style={{ padding: 0, marginRight: 4 }}>
                        {isSummaryExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <MessageSquare size={16} />
                    <span>对话总结</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                        <button
                            className={clsx('lang-btn', summaryLanguage === 'zh' && 'active')}
                            onClick={() => setSummaryLanguage('zh')}
                            style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, background: summaryLanguage === 'zh' ? 'var(--accent-primary)' : 'var(--bg-tertiary)', color: summaryLanguage === 'zh' ? 'white' : 'var(--text-secondary)' }}
                        >
                            中文
                        </button>
                        <button
                            className={clsx('lang-btn', summaryLanguage === 'en' && 'active')}
                            onClick={() => setSummaryLanguage('en')}
                            style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, background: summaryLanguage === 'en' ? 'var(--accent-primary)' : 'var(--bg-tertiary)', color: summaryLanguage === 'en' ? 'white' : 'var(--text-secondary)' }}
                        >
                            EN
                        </button>
                    </div>
                    {isStreaming && (
                        <span className="streaming-badge">
                            <span className="streaming-dot" />
                            {streamingPhase === 'reasoning' ? '思考中' : '生成中'}
                        </span>
                    )}
                </div>
                {isSummaryExpanded && (
                    <div className="summary-container">
                        {summaryError ? (
                            <div className="summary-error">
                                <AlertCircle size={18} />
                                <span>{summaryError}</span>
                                <button className="chip-btn" onClick={generateSummary}>
                                    <RotateCcw size={12} />
                                    <span>重试</span>
                                </button>
                            </div>
                        ) : (reasoning || summary || loadingSummary) ? (
                            <>
                                {/* Reasoning Section - Simple grey block, hidden when summary appears */}
                                {streamingPhase === 'reasoning' && (
                                    <div className="reasoning-section active">
                                        <div className="reasoning-text" ref={reasoningRef}>
                                            {reasoning}
                                            <span className="typing-cursor" />
                                        </div>
                                    </div>
                                )}

                                {/* Output Section */}
                                {(summary || streamingPhase === 'output') && (
                                    <div className="output-section">
                                        <div className="output-header">
                                            <Sparkles size={14} />
                                            <span>总结</span>
                                            {summary && !isStreaming && (
                                                <button
                                                    className="expand-btn"
                                                    onClick={() => setIsSummaryModalOpen(true)}
                                                    title="展开查看"
                                                >
                                                    <Maximize2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="summary-content markdown-content">
                                            <ReactMarkdown remarkPlugins={[remarkBreaks]}>
                                                {summary}
                                            </ReactMarkdown>
                                            {streamingPhase === 'output' && <span className="typing-cursor" />}
                                        </div>
                                    </div>
                                )}

                                {/* Initial loading state */}
                                {loadingSummary && !reasoning && !summary && (
                                    <div className="summary-loading">
                                        <Loader2 size={24} className="loading-spinner" />
                                        <span>正在连接 LLM…</span>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="summary-placeholder">
                                <Sparkles size={20} style={{ marginBottom: 8, opacity: 0.5 }} />
                                <div>点击下方按钮，生成本次对话的 AI 总结。</div>
                            </div>
                        )}
                        <div className="summary-actions">
                            {summary && (
                                <button
                                    className="ghost-btn"
                                    onClick={copySummaryToClipboard}
                                    disabled={!summary}
                                    aria-label="复制总结"
                                >
                                    {summaryCopyStatus === 'success' ? (
                                        <ClipboardCheck size={14} />
                                    ) : (
                                        <Copy size={14} />
                                    )}
                                    <span>
                                        {summaryCopyStatus === 'success'
                                            ? '已复制'
                                            : summaryCopyStatus === 'error'
                                                ? '复制失败'
                                                : '复制'}
                                    </span>
                                </button>
                            )}
                            {isStreaming ? (
                                <button className="stop-btn" onClick={stopStreaming}>
                                    <StopCircle size={14} />
                                    <span>停止</span>
                                </button>
                            ) : (
                                <button
                                    className="generate-btn"
                                    onClick={generateSummary}
                                    disabled={loadingSummary}
                                >
                                    <Sparkles size={14} />
                                    <span>{summary ? '重新生成' : summaryError ? '重试' : '生成总结'}</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* TODO List Section */}
            <div className="tasks-section">
                <div className="section-header tasks-header">
                    <CheckSquare size={16} />
                    <span>识别出的任务</span>
                    <span className="count">{pendingTaskCount}/{todos.length}</span>
                    <div className="section-actions">
                        <button className="chip-btn" onClick={copyTasksToClipboard}>
                            {taskCopyStatus === 'success' ? <ClipboardCheck size={12} /> : <Clipboard size={12} />}
                            <span>
                                {taskCopyStatus === 'success'
                                    ? '已复制'
                                    : taskCopyStatus === 'error'
                                        ? '复制失败'
                                        : '全部复制'}
                            </span>
                        </button>
                    </div>
                </div>
                <div className="todo-list">
                    {todos.length === 0 ? (
                        <div className="empty-state spacious">
                            <div className="empty-illustration">
                                <CheckSquare size={18} />
                            </div>
                            <div className="empty-title">还没有任务</div>
                            <div className="empty-hint">
                                在聊天中发送包含 TODO（比如 “we should...” 或 “[ ]”）的消息，会自动识别到这里。
                            </div>
                        </div>
                    ) : (
                        groupedTodos.map((group, idx) => (
                            <div key={`${group.sender?.id || 'unknown'}-${idx}`} className="todo-group">
                                <div className="todo-group-header">
                                    <div className="todo-group-title">
                                        <UserIcon size={14} />
                                        <span>{group.sender?.name || '未知用户'}</span>
                                    </div>
                                    <div className="todo-group-meta">
                                        <Clock size={10} />
                                        <span>{formatTime(group.lastActive)}</span>
                                    </div>
                                </div>
                                {group.todos.map((todo) => {
                                    const completed = !!completedTasks[todo.id];
                                    return (
                                        <label
                                            key={todo.id}
                                            className={clsx('todo-item', completed && 'completed')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={completed}
                                                onChange={() => toggleTaskCompletion(todo.id)}
                                                className="todo-checkbox"
                                            />
                                            <div className="todo-content">
                                                <div className="todo-text">{todo.text}</div>
                                                <div className="todo-meta">
                                                    <span>{todo.sender?.name || '未知用户'}</span>
                                                    <span className="dot">·</span>
                                                    <span>{formatTime(todo.timestamp)}</span>
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    const renderParticipantsTab = () => (
        <div className="sidebar-section">
            <div className="section-header">
                <Users size={16} />
                <span>成员</span>
                <span className="count">{participants.length}</span>
            </div>
            <div className="participants-list">
                {participants.map(({ user, messageCount, lastActive }) => (
                    <div key={user.id} className="participant-item">
                        <div className="participant-avatar">
                            {user.avatar ? (
                                <img src={user.avatar} alt={user.name} />
                            ) : (
                                <UserIcon size={18} />
                            )}
                            <span
                                className={clsx(
                                    'status-dot',
                                    user.status === 'online' && 'online',
                                    user.status === 'busy' && 'busy'
                                )}
                            />
                        </div>
                        <div className="participant-info">
                            <div className="participant-name">
                                {user.name}
                                <span className={clsx('role-badge', user.type === 'agent' ? 'agent' : 'human')}>
                                    {user.type === 'agent' ? '机器人' : '成员'}
                                </span>
                            </div>
                            <div className="participant-meta">
                                <span>{messageCount} 条消息</span>
                                {lastActive > 0 && (
                                    <>
                                        <span className="dot">·</span>
                                        <Clock size={10} />
                                        <span>{formatTime(lastActive)}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop for mobile */}
                        <motion.div
                            className="sidebar-backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={onClose}
                        />

                        {/* Sidebar Panel */}
                        <motion.div
                            className="chat-sidebar"
                            initial={{ x: '100%', opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: '100%', opacity: 0 }}
                            transition={{ type: 'tween', duration: 0.18, ease: 'easeOut' }}
                        >
                            {/* Header */}
                            <div className="sidebar-header">
                                <h3>聊天信息</h3>
                                <button className="close-btn" onClick={onClose}>
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Tabs */}
                            <div className="sidebar-tabs">
                                <button
                                    className={clsx('tab', activeTab === 'content' && 'active')}
                                    onClick={() => setActiveTab('content')}
                                >
                                    <FileText size={16} />
                                    <span>内容</span>
                                </button>
                                <button
                                    className={clsx('tab', activeTab === 'tasks' && 'active')}
                                    onClick={() => setActiveTab('tasks')}
                                >
                                    <CheckSquare size={16} />
                                    <span>任务</span>
                                </button>
                                <button
                                    className={clsx('tab', activeTab === 'participants' && 'active')}
                                    onClick={() => setActiveTab('participants')}
                                >
                                    <Users size={16} />
                                    <span>成员</span>
                                </button>
                            </div>

                            {/* Tab Content */}
                            <div className="sidebar-content">
                                {activeTab === 'content' && renderContentTab()}
                                {activeTab === 'tasks' && renderTasksTab()}
                                {activeTab === 'participants' && renderParticipantsTab()}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Summary Modal */}
            {createPortal(
                <AnimatePresence>
                    {isSummaryModalOpen && summary && (
                        <>
                            <motion.div
                                className="summary-modal-backdrop"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setIsSummaryModalOpen(false)}
                            />
                            <motion.div
                                className="summary-modal"
                                initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-46%' }}
                                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                                exit={{ opacity: 0, scale: 0.95, x: '-50%', y: '-46%' }}
                                transition={{ type: 'spring', duration: 0.3 }}
                            >
                                <div className="summary-modal-header">
                                    <div className="summary-modal-title">
                                        <Sparkles size={18} />
                                        <span>对话总结</span>
                                    </div>
                                    <div className="summary-modal-actions">
                                        <button
                                            className="ghost-btn"
                                            onClick={copySummaryToClipboard}
                                            title="复制"
                                        >
                                            {summaryCopyStatus === 'success' ? (
                                                <ClipboardCheck size={16} />
                                            ) : (
                                                <Copy size={16} />
                                            )}
                                            <span>
                                                {summaryCopyStatus === 'success' ? '已复制' : '复制'}
                                            </span>
                                        </button>
                                        <button
                                            className="close-btn"
                                            onClick={() => setIsSummaryModalOpen(false)}
                                            title="关闭"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                </div>
                                <div className="summary-modal-content markdown-content">
                                    <ReactMarkdown remarkPlugins={[remarkBreaks]}>
                                        {summary}
                                    </ReactMarkdown>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </>
    );
};

// Styles
const styles = `
            .sidebar-backdrop {
                position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.3);
            z-index: 40;
}

            @media (min-width: 1024px) {
    .sidebar - backdrop {
                display: none;
    }
}

            .chat-sidebar {
                position: fixed;
            right: 0;
            top: 0;
            bottom: 0;
            width: 340px;
            max-width: 100vw;
            background: var(--bg-primary);
            border-left: 1px solid var(--border-light);
            z-index: 50;
            display: flex;
            flex-direction: column;
            box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
}

            .sidebar-header {
                display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border-light);
}

            .sidebar-header h3 {
                font - size: 1.1rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0;
}

            .close-btn {
                padding: 6px;
            border-radius: 8px;
            color: var(--text-secondary);
            transition: all 0.2s;
}

            .close-btn:hover {
                background: var(--bg-tertiary);
            color: var(--text-primary);
}

            .sidebar-tabs {
                display: flex;
            gap: 4px;
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-light);
            background: var(--bg-secondary);
}

            .sidebar-tabs .tab {
                flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 0.8rem;
            font-weight: 500;
            color: var(--text-secondary);
            transition: all 0.2s;
}

            .sidebar-tabs .tab:hover {
                background: var(--bg-tertiary);
            color: var(--text-primary);
}

            .sidebar-tabs .tab.active {
                background: var(--accent-primary);
                color: white;
                box-shadow: var(--shadow-sm);
            }

            .sidebar-content {
                flex: 1;
            overflow-y: auto;
            padding: 16px;
}

            .sidebar-section {
                display: flex;
            flex-direction: column;
            gap: 16px;
}

            .content-subtabs {
                display: flex;
            gap: 8px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-light);
}

            .subtab {
                display: flex;
            align-items: center;
            gap: 4px;
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 0.75rem;
            color: var(--text-secondary);
            transition: all 0.2s;
}

            .subtab:hover {
                background: var(--bg-tertiary);
}

            .subtab.active {
                background: var(--bg-tertiary);
            color: var(--accent-primary);
}

            .subtab .count {
                background: var(--bg-tertiary);
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 0.7rem;
}

            .subtab.active .count {
                background: rgba(139, 92, 246, 0.2);
}

            .content-list {
                display: flex;
            flex-direction: column;
            gap: 8px;
}

            .content-item {
                display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 10px 12px;
            background: var(--bg-secondary);
            border-radius: 10px;
            transition: all 0.2s;
}

            .content-item:hover {
                background: var(--bg-tertiary);
            transform: translateX(2px);
}

            .link-item {
                text - decoration: none;
            cursor: pointer;
}

            .content-icon {
                width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            flex-shrink: 0;
}

            .content-icon.doc {
                background: rgba(59, 130, 246, 0.1);
            color: #3b82f6;
}

            .content-icon.link {
                background: rgba(16, 185, 129, 0.1);
            color: #10b981;
}

            .content-info {
                flex: 1;
            min-width: 0;
}

            .content-title {
                font - size: 0.85rem;
            font-weight: 500;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 4px;
            word-break: break-word;
}

            .external-icon {
                flex - shrink: 0;
            opacity: 0.5;
}

            .content-meta {
                display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 2px;
            font-size: 0.7rem;
            color: var(--text-tertiary);
}

            .dot {
                opacity: 0.5;
}

            .media-grid {
                display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
}

            .media-item {
                aspect - ratio: 1;
            border-radius: 8px;
            overflow: hidden;
            background: var(--bg-secondary);
}

            .media-item img {
                width: 100%;
            height: 100%;
            object-fit: cover;
}

            .empty-state {
                padding: 18px 14px;
            text-align: center;
            color: var(--text-tertiary);
            font-size: 0.85rem;
            border: 1px dashed var(--border-light);
            border-radius: 10px;
            background: var(--bg-primary);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
}

            .empty-state.spacious {
                padding: 22px 16px;
}

            .empty-illustration {
                width: 40px;
            height: 40px;
            border-radius: 12px;
            background: var(--bg-tertiary);
            display: grid;
            place-items: center;
            color: var(--text-secondary);
}

            .empty-title {
                font - weight: 600;
            color: var(--text-primary);
}

            .empty-hint {
                font - size: 0.8rem;
            color: var(--text-tertiary);
}

            /* Tasks Tab */
            .tasks-section {
                background: var(--bg-secondary);
            border-radius: 12px;
            padding: 16px;
}

            .section-header {
                display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 12px;
}

            .section-header .count {
                margin - left: auto;
            background: var(--bg-tertiary);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 500;
            color: var(--text-secondary);
}

            .section-header .section-actions {
                display: flex;
            align-items: center;
            gap: 6px;
            margin-left: 8px;
}

            .tasks-header .count {
                margin - left: auto;
}

            .summary-container {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .llm-cta {
                padding: 16px;
            border-radius: 12px;
            background: linear-gradient(145deg, var(--bg-secondary), var(--bg-tertiary));
            border: 1px solid var(--border-light);
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: var(--shadow-sm);
            position: relative;
            overflow: hidden;
}

            .llm-cta::before {
                content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 4px;
            height: 100%;
            background: var(--accent-gradient);
}

            .llm-cta-title-cn {
                font - size: 0.85rem;
            font-weight: 500;
            color: var(--text-primary);
}

            .llm-cta-header-row {
                display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
}

            .status-pill {
                padding: 2px 8px;
            border-radius: 999px;
            font-size: 0;
            font-weight: 500;
            position: relative;
}

            .status-pill.neutral {
                background: var(--bg-tertiary);
            color: var(--text-secondary);
}

            .status-pill.success {
                background: rgba(16, 185, 129, 0.12);
            color: #059669;
}

            .status-pill.warning {
                background: rgba(245, 158, 11, 0.12);
            color: #d97706;
}

            .status-pill.error {
                background: rgba(239, 68, 68, 0.12);
            color: #dc2626;
}

            .status-pill.neutral::after,
            .status-pill.success::after,
            .status-pill.warning::after,
            .status-pill.error::after {
                font - size: 0.7rem;
}

            .status-pill.neutral::after {
                content: '检测中';
}

            .status-pill.success::after {
                content: '已配置';
}

            .status-pill.warning::after {
                content: '未配置';
}

            .status-pill.error::after {
                content: '加载失败';
}

            .summary-content {
                font - size: 0.85rem;
            line-height: 1.6;
            color: var(--text-secondary);
            white-space: pre-wrap;
}

            .summary-loading {
                display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 24px 16px;
            color: var(--accent-primary);
}

            .summary-loading span {
                font - size: 0.85rem;
            color: var(--text-secondary);
}

            .summary-loading .loading-hint {
                font - size: 0.75rem;
            color: var(--text-tertiary);
}

            .summary-error {
                display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 12px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: 8px;
            color: #ef4444;
}

            .summary-error span {
                font - size: 0.85rem;
            line-height: 1.5;
}

            .summary-error svg {
                flex - shrink: 0;
            margin-top: 2px;
}

            .streaming-badge {
                display: flex;
            align-items: center;
            gap: 6px;
            margin-left: auto;
            padding: 3px 8px;
            background: rgba(16, 185, 129, 0.15);
            border-radius: 12px;
            font-size: 0.7rem;
            font-weight: 500;
            color: #10b981;
}

            .streaming-dot {
                width: 6px;
            height: 6px;
            background: #10b981;
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
}

            @keyframes pulse {
                0 %, 100 % { opacity: 1; transform: scale(1); }
    50% {opacity: 0.5; transform: scale(0.8); }
}

            .typing-cursor {
                display: inline-block;
            width: 2px;
            height: 1em;
            background: var(--accent-primary);
            margin-left: 2px;
            animation: blink 1s step-end infinite;
            vertical-align: text-bottom;
}

            @keyframes blink {
                0 %, 100 % { opacity: 1; }
    50% {opacity: 0; }
}

            .stop-btn {
                display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 16px;
            background: #ef4444;
            color: white;
            border-radius: 8px;
            font-size: 0.8rem;
            font-weight: 500;
            transition: all 0.2s;
            width: auto;
}

            .stop-btn:hover {
                background: #dc2626;
            box-shadow: var(--shadow-md);
}

            .generate-btn {
                display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 16px;
            background: var(--accent-gradient);
            color: white;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 500;
            transition: all 0.2s;
            box-shadow: var(--shadow-sm);
}

            .generate-btn:hover {
                opacity: 0.95;
            transform: translateY(-1px);
            box-shadow: var(--shadow-md);
}

            .generate-btn:disabled {
                opacity: 0.7;
            cursor: not-allowed;
            transform: none;
}

            .compact-btn {
                padding: 8px 12px;
            font-size: 0.8rem;
}

            /* Reasoning Section - Simple grey block */
            .reasoning-section {
                position: relative;
            border-radius: 8px;
            overflow: hidden;
            margin-bottom: 12px;
            background: var(--bg-tertiary);
}

            .reasoning-section.active::before {
                content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.04) 50%,
            transparent 100%
            );
            animation: glimmer 2s ease-in-out infinite;
            pointer-events: none;
}

            @keyframes glimmer {
                0 % { transform: translateX(-100 %); }
    100% {transform: translateX(100%); }
}

            .reasoning-text {
                position: relative;
            padding: 12px;
            font-size: 0.8rem;
            line-height: 1.5;
            color: var(--text-tertiary);
            white-space: pre-wrap;
            max-height: 150px;
            overflow-y: auto;
            z-index: 1;
}

            /* Output Section */
            .output-section {
                margin-bottom: 8px;
            }

            .output-header {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 4px;
                font-size: 0.75rem;
                font-weight: 600;
                color: var(--accent-primary);
            }

            /* Loading spinner animation */
            .loading-spinner {
                animation: spin 1s linear infinite;
}

            @keyframes spin {
                from {transform: rotate(0deg); }
            to {transform: rotate(360deg); }
}

            /* Markdown content styles */
            .markdown-content {
                font-size: 0.85rem;
                line-height: 1.6;
                color: var(--text-secondary);
            }

            .markdown-content h1,
            .markdown-content h2,
            .markdown-content h3,
            .markdown-content h4 {
                color: var(--text-primary);
                margin-top: 0.6em;
                margin-bottom: 0.2em;
                font-weight: 600;
                line-height: 1.3;
            }

            .markdown-content h1 { font-size: 1.2rem; }
            .markdown-content h2 { font-size: 1.1rem; }
            .markdown-content h3 { font-size: 1rem; }
            .markdown-content h4 { font-size: 0.95rem; }

            .markdown-content p {
                margin-top: 0;
                margin-bottom: 0.25em;
            }

            .markdown-content strong {
                color: var(--text-primary);
                font-weight: 600;
            }

            .markdown-content code {
                background: var(--bg-tertiary);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.8rem;
            }

            .markdown-content pre {
                background: var(--bg-tertiary);
                padding: 12px;
                border-radius: 8px;
                overflow-x: auto;
                margin-bottom: 0.75em;
            }

            .markdown-content pre code {
                background: none;
                padding: 0;
            }

            .markdown-content blockquote {
                border-left: 3px solid var(--accent-primary);
                padding-left: 12px;
                margin-left: 0;
                color: var(--text-tertiary);
                font-style: italic;
            }

            .markdown-content ul,
            .markdown-content ol {
                margin: 0.5em 0;
                padding-left: 1.5em;
            }

            .markdown-content ul {
                list-style-type: disc;
            }

            .markdown-content ol {
                list-style-type: decimal;
            }

            .markdown-content li {
                margin: 0.25em 0;
                line-height: 1.5;
            }

            .markdown-content li > ul,
            .markdown-content li > ol {
                margin: 0.25em 0;
            }

            .markdown-content a {
                color: var(--accent-primary);
                text-decoration: none;
            }

            .markdown-content a:hover {
                text-decoration: underline;
            }

            .markdown-content hr {
                border: none;
                border-top: 1px solid var(--border-light);
                margin: 1em 0;
            }

            .summary-placeholder {
                font-size: 0.8rem;
                color: var(--text-tertiary);
            font-style: italic;
}

            .summary-actions {
                display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
}

            .generate-btn {
                display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 16px;
            background: linear-gradient(135deg, #8b5cf6, #7c3aed);
            color: white;
            border-radius: 8px;
            font-size: 0.8rem;
            font-weight: 500;
            transition: all 0.2s;
}

            .generate-btn.compact-btn {
                padding: 6px 12px;
            font-size: 0.8rem;
            width: 100%;
}

            .generate-btn:hover:not(:disabled) {
                transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}

            .generate-btn:disabled {
                opacity: 0.7;
            cursor: not-allowed;
}

            .ghost-btn {
                display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 9px 12px;
            border-radius: 8px;
            font-size: 0.8rem;
            font-weight: 500;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            transition: all 0.15s;
}

            .ghost-btn:hover:not(:disabled) {
                background: var(--bg-secondary);
            transform: translateY(-1px);
}

            .ghost-btn:disabled {
                opacity: 0.7;
            cursor: not-allowed;
}

            .chip-btn {
                display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 12px;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            font-size: 0.75rem;
            transition: all 0.15s;
}

            .chip-btn:hover {
                background: var(--bg-secondary);
            color: var(--text-primary);
}

            .summary-error .chip-btn {
                margin - left: auto;
}

            .todo-list {
                display: flex;
            flex-direction: column;
            gap: 10px;
            max-height: 320px;
            overflow-y: auto;
}

            .todo-group {
                border: 1px solid var(--border-light);
            border-radius: 10px;
            padding: 10px 12px;
            background: var(--bg-primary);
            box-shadow: var(--shadow-sm);
            transition: transform 0.15s ease, box-shadow 0.15s ease;
}

            .todo-group:hover {
                transform: translateY(-1px);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
}

            .todo-group-header {
                display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
}

            .todo-group-title {
                display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: var(--text-primary);
}

            .todo-group-meta {
                display: flex;
            align-items: center;
            gap: 4px;
            font-size: 0.7rem;
            color: var(--text-tertiary);
}

            .todo-item {
                display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px;
            background: var(--bg-secondary);
            border-radius: 8px;
            transition: all 0.15s ease;
}

            .todo-item:hover {
                background: var(--bg-tertiary);
            transform: translateY(-1px);
}

            .todo-item.completed {
                opacity: 0.7;
            background: var(--bg-tertiary);
}

            .todo-item.completed .todo-text {
                text - decoration: line-through;
            color: var(--text-tertiary);
}

            .todo-checkbox {
                width: 16px;
            height: 16px;
            margin-top: 4px;
            accent-color: var(--accent-primary);
}

            .todo-content {
                flex: 1;
            min-width: 0;
}

            .todo-text {
                font - size: 0.85rem;
            color: var(--text-primary);
            line-height: 1.4;
}

            .todo-meta {
                display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 4px;
            font-size: 0.7rem;
            color: var(--text-tertiary);
}

            /* Participants Tab */
            .participants-list {
                display: flex;
            flex-direction: column;
            gap: 8px;
}

            .participant-item {
                display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            background: var(--bg-secondary);
            border-radius: 10px;
            transition: all 0.18s ease;
}

            .participant-item:hover {
                background: var(--bg-tertiary);
            transform: translateY(-1px);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
}

            .participant-avatar {
                position: relative;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--bg-tertiary);
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            color: var(--text-tertiary);
}

            .participant-avatar img {
                width: 100%;
            height: 100%;
            object-fit: cover;
}

            .status-dot {
                position: absolute;
            bottom: 0;
            right: 0;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--text-tertiary);
            border: 2px solid var(--bg-secondary);
}

            .status-dot.online {
                background: #10b981;
}

            .status-dot.busy {
                background: #f59e0b;
}

            .participant-info {
                flex: 1;
            min-width: 0;
}

            .participant-name {
                font - size: 0.9rem;
            font-weight: 500;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 6px;
}

            .role-badge {
                font - size: 0.65rem;
            padding: 2px 6px;
            border-radius: 6px;
            font-weight: 500;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
}

            .role-badge.agent {
                background: rgba(139, 92, 246, 0.15);
            color: #8b5cf6;
}

            .role-badge.human {
                background: rgba(14, 165, 233, 0.12);
            color: #0ea5e9;
}

            .participant-meta {
                display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 2px;
            font-size: 0.7rem;
            color: var(--text-tertiary);
}

            @media (max-width: 768px) {
    .chat - sidebar {
                width: 100%;
    }
}
            .summary-placeholder {
                padding: 32px 20px;
            text-align: center;
            color: var(--text-tertiary);
            font-size: 0.9rem;
            border: 2px dashed var(--border-light);
            border-radius: 12px;
            background: var(--bg-secondary);
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
}

            .summary-placeholder:hover {
                border - color: var(--accent-light);
            background: var(--bg-tertiary);
}

            /* Expand Button */
            .expand-btn {
                margin-left: auto;
                padding: 4px;
                border-radius: 4px;
                color: var(--text-tertiary);
                transition: all 0.15s;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .expand-btn:hover {
                background: var(--bg-tertiary);
                color: var(--accent-primary);
            }

            /* Summary Modal */
            .summary-modal-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 100;
            }

            .summary-modal {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 90%;
                max-width: 700px;
                max-height: 80vh;
                background: var(--bg-primary);
                border-radius: 16px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                z-index: 101;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .summary-modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                border-bottom: 1px solid var(--border-light);
                background: var(--bg-secondary);
            }

            .summary-modal-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 1rem;
                font-weight: 600;
                color: var(--text-primary);
            }

            .summary-modal-title svg {
                color: var(--accent-primary);
            }

            .summary-modal-actions {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .summary-modal-content {
                flex: 1;
                padding: 24px;
                overflow-y: auto;
                font-size: 0.95rem;
                line-height: 1.7;
            }

            .summary-modal-content.markdown-content h1 { font-size: 1.4rem; }
            .summary-modal-content.markdown-content h2 { font-size: 1.25rem; }
            .summary-modal-content.markdown-content h3 { font-size: 1.1rem; }
            .summary-modal-content.markdown-content h4 { font-size: 1rem; }

            @media (max-width: 768px) {
                .summary-modal {
                    width: 95%;
                    max-height: 85vh;
                }

                .summary-modal-content {
                    padding: 16px;
                }
            }
            `;

// Inject styles
if (typeof document !== 'undefined') {
    const styleId = 'chat-sidebar-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }
}
