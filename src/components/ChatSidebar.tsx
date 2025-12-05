import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import {
    FileText,
    Link2,
    Image,
    CheckSquare,
    Users,
    ExternalLink,
    Loader2,
    Copy,
    ClipboardCheck,
    AlertCircle,
    X,
    Search,
    Sparkles,
    Settings,
    RotateCcw,
    StopCircle,
    ChevronDown,
    ChevronRight,
    Clipboard,
    User as UserIcon,
    Maximize2,
    Clock,
    MessageCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useChat } from '../context/ChatContext';

// Types
type TabType = 'content' | 'tasks' | 'participants' | 'search';
type ContentSubTab = 'documents' | 'links' | 'media';

interface ExtractedDocument {
    id: string;
    filename: string;
    url?: string;
    timestamp: number;
    senderId: string;
}

interface ExtractedLink {
    url: string;
    domain: string;
    timestamp: number;
    senderId: string;
}

interface ExtractedMedia {
    url: string;
    timestamp: number;
    senderId: string;
}

interface ExtractedTodo {
    id: string;
    text: string;
    timestamp: number;
    senderId: string;
}

interface ChatSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings?: () => void;
}

// Patterns
const URL_PATTERN = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/gi;
const IMAGE_PATTERN = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?|$)/i;
const TODO_PATTERNS = [
    /(?:^|\n)\s*[-*]\s*\[[ x]\]\s*(.+)/gi,
    /(?:TODO|FIXME|待办|任务)[：:]\s*(.+)/gi,
];

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
    isOpen,
    onClose,
    onOpenSettings,
}) => {
    const { state } = useChat();
    const [activeTab, setActiveTab] = useState<TabType>('content');
    const [contentSubTab, setContentSubTab] = useState<ContentSubTab>('documents');
    const [searchQuery, setSearchQuery] = useState('');

    // Summary state
    const [summary, setSummary] = useState('');
    const [reasoning, setReasoning] = useState('');
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingPhase, setStreamingPhase] = useState<'idle' | 'reasoning' | 'output'>('idle');
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [summaryCopyStatus, setSummaryCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [summaryLanguage, setSummaryLanguage] = useState<'zh' | 'en'>('zh');
    const [isSummaryExpanded, setIsSummaryExpanded] = useState(true);
    const abortControllerRef = useRef<AbortController | null>(null);
    const reasoningRef = useRef<HTMLDivElement>(null);

    // Tasks state
    const [completedTasks, setCompletedTasks] = useState<Record<string, boolean>>({});
    const [taskCopyStatus, setTaskCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');

    // LLM config status
    const [llmStatus, setLlmStatus] = useState<'idle' | 'loading' | 'configured' | 'not-configured' | 'error'>('idle');

    // Check LLM status
    useEffect(() => {
        const checkLLMStatus = async () => {
            setLlmStatus('loading');
            try {
                const llmConfig = localStorage.getItem('llm-config');
                if (llmConfig) {
                    const config = JSON.parse(llmConfig);
                    if (config.apiKey && config.model) {
                        setLlmStatus('configured');
                        return;
                    }
                }
                setLlmStatus('not-configured');
            } catch {
                setLlmStatus('error');
            }
        };
        checkLLMStatus();
    }, [isOpen]);

    // Extract data from messages
    const { documents, links, media, todos } = useMemo(() => {
        const docs: ExtractedDocument[] = [];
        const lnks: ExtractedLink[] = [];
        const imgs: ExtractedMedia[] = [];
        const todoItems: ExtractedTodo[] = [];

        state.messages.forEach((msg) => {
            // Extract URLs
            const urlMatches = msg.content.match(URL_PATTERN) || [];
            urlMatches.forEach((url) => {
                try {
                    const urlObj = new URL(url);
                    if (IMAGE_PATTERN.test(url)) {
                        imgs.push({ url, timestamp: msg.timestamp, senderId: msg.senderId });
                    } else {
                        lnks.push({
                            url,
                            domain: urlObj.hostname.replace('www.', ''),
                            timestamp: msg.timestamp,
                            senderId: msg.senderId,
                        });
                    }
                } catch { /* ignore invalid URLs */ }
            });

            // Extract TODOs
            TODO_PATTERNS.forEach((pattern) => {
                let match;
                const content = msg.content;
                pattern.lastIndex = 0;
                while ((match = pattern.exec(content)) !== null) {
                    todoItems.push({
                        id: `${msg.id}-${match.index}`,
                        text: match[1].trim(),
                        timestamp: msg.timestamp,
                        senderId: msg.senderId,
                    });
                }
            });
        });

        return {
            documents: docs,
            links: lnks.sort((a, b) => b.timestamp - a.timestamp),
            media: imgs.sort((a, b) => b.timestamp - a.timestamp),
            todos: todoItems.sort((a, b) => b.timestamp - a.timestamp),
        };
    }, [state.messages]);

    // Group todos by sender
    const groupedTodos = useMemo(() => {
        const groups: Map<string, { sender: typeof state.users[0] | undefined; todos: ExtractedTodo[]; lastActive: number }> = new Map();
        todos.forEach((todo) => {
            const sender = state.users.find((u) => u.id === todo.senderId);
            const key = todo.senderId;
            if (!groups.has(key)) {
                groups.set(key, { sender, todos: [], lastActive: todo.timestamp });
            }
            const group = groups.get(key)!;
            group.todos.push(todo);
            group.lastActive = Math.max(group.lastActive, todo.timestamp);
        });
        return Array.from(groups.values()).sort((a, b) => b.lastActive - a.lastActive);
    }, [todos, state.users]);

    const pendingTaskCount = useMemo(() => {
        return todos.filter((t) => !completedTasks[t.id]).length;
    }, [todos, completedTasks]);

    // Participants
    const participants = useMemo(() => {
        const senderMap = new Map<string, { count: number; lastActive: number }>();
        state.messages.forEach((msg) => {
            const existing = senderMap.get(msg.senderId);
            if (existing) {
                existing.count++;
                existing.lastActive = Math.max(existing.lastActive, msg.timestamp);
            } else {
                senderMap.set(msg.senderId, { count: 1, lastActive: msg.timestamp });
            }
        });

        return state.users
            .filter((user) => senderMap.has(user.id))
            .map((user) => ({
                user,
                messageCount: senderMap.get(user.id)?.count || 0,
                lastActive: senderMap.get(user.id)?.lastActive || 0,
            }))
            .sort((a, b) => b.messageCount - a.messageCount);
    }, [state.messages, state.users]);

    // Search results
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const query = searchQuery.toLowerCase();
        return state.messages
            .filter((msg) => msg.content.toLowerCase().includes(query))
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [state.messages, searchQuery]);

    // Helpers
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

    const toggleTaskCompletion = (taskId: string) => {
        setCompletedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
    };

    const copyTasksToClipboard = async () => {
        const pendingTasks = todos.filter((t) => !completedTasks[t.id]);
        const text = pendingTasks.map((t) => `- [ ] ${t.text}`).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setTaskCopyStatus('success');
            setTimeout(() => setTaskCopyStatus('idle'), 2000);
        } catch {
            setTaskCopyStatus('error');
            setTimeout(() => setTaskCopyStatus('idle'), 2000);
        }
    };

    const copySummaryToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(summary);
            setSummaryCopyStatus('success');
            setTimeout(() => setSummaryCopyStatus('idle'), 2000);
        } catch {
            setSummaryCopyStatus('error');
            setTimeout(() => setSummaryCopyStatus('idle'), 2000);
        }
    };

    const generateSummary = async () => {
        // Placeholder - actual LLM integration would go here
        setLoadingSummary(true);
        setSummaryError(null);
        setSummary('');
        setReasoning('');
        setIsStreaming(true);
        setStreamingPhase('reasoning');

        try {
            // Simulate streaming
            await new Promise((r) => setTimeout(r, 1500));
            setReasoning('分析聊天记录...\n识别关键信息点...');
            await new Promise((r) => setTimeout(r, 1000));
            setStreamingPhase('output');
            setSummary('这是一个示例总结。实际使用时需要配置 LLM API。');
        } catch (err) {
            setSummaryError('生成总结失败');
        } finally {
            setLoadingSummary(false);
            setIsStreaming(false);
            setStreamingPhase('idle');
        }
    };

    const stopStreaming = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setIsStreaming(false);
        setLoadingSummary(false);
        setStreamingPhase('idle');
    };

    // Animation variants
    const listItemVariants = {
        hidden: { opacity: 0, y: 10 },
        visible: (i: number) => ({
            opacity: 1,
            y: 0,
            transition: { delay: i * 0.05, duration: 0.2 },
        }),
    };

    // Render tabs
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
                <AnimatePresence mode="wait">
                    {contentSubTab === 'documents' && (
                        documents.length === 0 ? (
                            <motion.div
                                key="empty-docs"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="empty-state spacious"
                            >
                                <div className="empty-illustration">
                                    <FileText size={20} />
                                </div>
                                <div className="empty-title">暂无文件</div>
                                <div className="empty-hint">分享的文件会出现在这里</div>
                            </motion.div>
                        ) : (
                            documents.map((doc, i) => {
                                const sender = state.users.find((u) => u.id === doc.senderId);
                                return (
                                    <motion.div
                                        key={doc.id}
                                        custom={i}
                                        variants={listItemVariants}
                                        initial="hidden"
                                        animate="visible"
                                        className="content-item"
                                    >
                                        <div className="content-icon doc">
                                            <FileText size={16} />
                                        </div>
                                        <div className="content-info">
                                            <div className="content-title">{doc.filename}</div>
                                            <div className="content-meta">
                                                <span>{sender?.name || '未知'}</span>
                                                <span className="dot">·</span>
                                                <span>{formatTime(doc.timestamp)}</span>
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })
                        )
                    )}

                    {contentSubTab === 'links' && (
                        links.length === 0 ? (
                            <motion.div
                                key="empty-links"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="empty-state spacious"
                            >
                                <div className="empty-illustration">
                                    <Link2 size={20} />
                                </div>
                                <div className="empty-title">暂无链接</div>
                                <div className="empty-hint">分享的链接会出现在这里</div>
                            </motion.div>
                        ) : (
                            links.map((link, i) => {
                                const sender = state.users.find((u) => u.id === link.senderId);
                                return (
                                    <motion.a
                                        key={`${link.url}-${i}`}
                                        custom={i}
                                        variants={listItemVariants}
                                        initial="hidden"
                                        animate="visible"
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
                                                <span>{sender?.name || '未知'}</span>
                                                <span className="dot">·</span>
                                                <span>{formatTime(link.timestamp)}</span>
                                            </div>
                                        </div>
                                    </motion.a>
                                );
                            })
                        )
                    )}

                    {contentSubTab === 'media' && (
                        media.length === 0 ? (
                            <motion.div
                                key="empty-media"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="empty-state spacious"
                            >
                                <div className="empty-illustration">
                                    <Image size={20} />
                                </div>
                                <div className="empty-title">暂无媒体</div>
                                <div className="empty-hint">分享的图片会出现在这里</div>
                            </motion.div>
                        ) : (
                            <div className="media-grid">
                                {media.map((img, i) => (
                                    <motion.a
                                        key={`${img.url}-${i}`}
                                        custom={i}
                                        variants={listItemVariants}
                                        initial="hidden"
                                        animate="visible"
                                        href={img.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="media-item"
                                    >
                                        <img src={img.url} alt="" loading="lazy" />
                                    </motion.a>
                                ))}
                            </div>
                        )
                    )}
                </AnimatePresence>
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
                    {llmStatus === 'loading' && <span className="status-pill neutral">检测中</span>}
                    {llmStatus === 'configured' && <span className="status-pill success">已配置</span>}
                    {llmStatus === 'not-configured' && <span className="status-pill warning">未配置</span>}
                    {llmStatus === 'error' && <span className="status-pill error">加载失败</span>}
                </div>
                <div className="llm-cta">
                    <div className="llm-cta-header-row">
                        <span className="llm-cta-title-cn">配置模型和 API Key</span>
                    </div>
                    <button
                        className="generate-btn compact-btn"
                        onClick={() => {
                            if (onOpenSettings) onOpenSettings();
                            onClose();
                        }}
                    >
                        <Settings size={14} />
                        <span>前往设置</span>
                    </button>
                </div>
            </div>

            {/* AI Summary Section */}
            <div className="tasks-section">
                <div
                    className="section-header"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                >
                    <button className="icon-btn-small" style={{ padding: 0, marginRight: 4 }}>
                        {isSummaryExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <Sparkles size={16} />
                    <span>AI 总结</span>
                    {summary && (
                        <button
                            className="icon-btn-small"
                            style={{ marginLeft: 'auto' }}
                            onClick={(e) => {
                                e.stopPropagation();
                                // Open modal if needed
                            }}
                            title="全屏查看"
                        >
                            <Maximize2 size={14} />
                        </button>
                    )}
                </div>

                <AnimatePresence>
                    {isSummaryExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            style={{ overflow: 'hidden' }}
                        >
                            <div className="summary-container">
                                <div className="language-toggle">
                                    <button
                                        className={clsx('lang-btn', summaryLanguage === 'zh' && 'active')}
                                        onClick={() => setSummaryLanguage('zh')}
                                    >
                                        中文
                                    </button>
                                    <button
                                        className={clsx('lang-btn', summaryLanguage === 'en' && 'active')}
                                        onClick={() => setSummaryLanguage('en')}
                                    >
                                        English
                                    </button>
                                </div>

                                {isStreaming ? (
                                    <button className="generate-btn stop-btn" onClick={stopStreaming}>
                                        <StopCircle size={14} />
                                        <span>停止生成</span>
                                    </button>
                                ) : (
                                    <button className="generate-btn" onClick={generateSummary} disabled={loadingSummary}>
                                        {loadingSummary ? (
                                            <>
                                                <Loader2 size={14} className="spin" />
                                                <span>生成中...</span>
                                            </>
                                        ) : (
                                            <>
                                                {summary ? <RotateCcw size={14} /> : <Sparkles size={14} />}
                                                <span>{summary ? '重新生成' : '生成总结'}</span>
                                            </>
                                        )}
                                    </button>
                                )}

                                {(isStreaming || reasoning) && streamingPhase === 'reasoning' && (
                                    <div className="reasoning-section" ref={reasoningRef}>
                                        <div className="reasoning-header">
                                            <Clock size={12} />
                                            <span>思考中...</span>
                                        </div>
                                        <div className="reasoning-content">
                                            {reasoning || '正在分析聊天内容...'}
                                        </div>
                                    </div>
                                )}

                                {summaryError && (
                                    <div className="summary-error">
                                        <AlertCircle size={14} />
                                        <span>{summaryError}</span>
                                    </div>
                                )}

                                {summary && (
                                    <div className="summary-output">
                                        <div className="summary-header">
                                            <span>总结</span>
                                            <button
                                                className="icon-btn-small"
                                                onClick={copySummaryToClipboard}
                                                title="复制总结"
                                            >
                                                {summaryCopyStatus === 'success' ? (
                                                    <ClipboardCheck size={14} />
                                                ) : (
                                                    <Copy size={14} />
                                                )}
                                            </button>
                                        </div>
                                        <div className="summary-text">
                                            <ReactMarkdown remarkPlugins={[remarkBreaks]}>
                                                {summary}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Tasks Section */}
            <div className="tasks-section">
                <div className="section-header">
                    <CheckSquare size={16} />
                    <span>待办事项</span>
                    {pendingTaskCount > 0 && (
                        <span className="task-count">{pendingTaskCount}</span>
                    )}
                    <button
                        className="icon-btn-small"
                        style={{ marginLeft: 'auto' }}
                        onClick={copyTasksToClipboard}
                        title="复制任务列表"
                    >
                        {taskCopyStatus === 'success' ? (
                            <ClipboardCheck size={14} />
                        ) : taskCopyStatus === 'error' ? (
                            <AlertCircle size={14} />
                        ) : (
                            <Clipboard size={14} />
                        )}
                    </button>
                </div>

                {todos.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-illustration">
                            <CheckSquare size={20} />
                        </div>
                        <div className="empty-title">暂无待办事项</div>
                        <div className="empty-hint">聊天中提到的任务会自动出现在这里</div>
                    </div>
                ) : (
                    <div className="tasks-list">
                        {groupedTodos.map((group, gIdx) => (
                            <motion.div
                                key={group.sender?.id || gIdx}
                                custom={gIdx}
                                variants={listItemVariants}
                                initial="hidden"
                                animate="visible"
                                className="task-group"
                            >
                                <div className="task-group-header">
                                    <div className="task-group-avatar">
                                        {group.sender?.name?.[0]?.toUpperCase() || '?'}
                                    </div>
                                    <span className="task-group-name">{group.sender?.name || '未知用户'}</span>
                                </div>
                                {group.todos.map((todo) => (
                                    <div
                                        key={todo.id}
                                        className={clsx('task-item', completedTasks[todo.id] && 'completed')}
                                        onClick={() => toggleTaskCompletion(todo.id)}
                                    >
                                        <div className={clsx('task-checkbox', completedTasks[todo.id] && 'checked')}>
                                            {completedTasks[todo.id] && <CheckSquare size={14} />}
                                        </div>
                                        <div className="task-content">
                                            <div className="task-text">{todo.text}</div>
                                            <div className="task-meta">{formatTime(todo.timestamp)}</div>
                                        </div>
                                    </div>
                                ))}
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    const renderSearchTab = () => (
        <div className="sidebar-section">
            <div className="search-container">
                <div className="search-input-wrapper">
                    <Search size={16} className="search-icon" />
                    <input
                        type="text"
                        className="search-input"
                        placeholder="搜索消息..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button
                            className="search-clear-btn"
                            onClick={() => setSearchQuery('')}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>
            <div className="search-results-list">
                <AnimatePresence mode="wait">
                    {searchResults.length === 0 ? (
                        <motion.div
                            key="empty-search"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="empty-state"
                        >
                            <div className="empty-illustration">
                                <Search size={20} />
                            </div>
                            <div className="empty-title">
                                {searchQuery ? '未找到相关消息' : '搜索聊天记录'}
                            </div>
                            <div className="empty-hint">
                                {searchQuery ? '换个关键词试试' : '输入关键词开始搜索'}
                            </div>
                        </motion.div>
                    ) : (
                        searchResults.map((msg, i) => {
                            const sender = state.users.find((u) => u.id === msg.senderId);
                            return (
                                <motion.div
                                    key={msg.id}
                                    custom={i}
                                    variants={listItemVariants}
                                    initial="hidden"
                                    animate="visible"
                                    className="search-result-item"
                                    onClick={() => {
                                        const element = document.getElementById(`message-${msg.id}`);
                                        if (element) {
                                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            element.classList.add('highlight-message');
                                            setTimeout(() => element.classList.remove('highlight-message'), 2000);
                                        }
                                    }}
                                >
                                    <div className="result-header">
                                        <div className="result-user">
                                            <div
                                                className="user-avatar-tiny"
                                                style={{ backgroundColor: sender?.type === 'agent' ? 'var(--accent-secondary)' : 'var(--accent-primary)' }}
                                            >
                                                {sender?.name?.[0]?.toUpperCase() || '?'}
                                            </div>
                                            <span className="result-name">{sender?.name || '未知用户'}</span>
                                        </div>
                                        <span className="result-time">{formatTime(msg.timestamp)}</span>
                                    </div>
                                    <div className="result-content">
                                        {msg.content.length > 150 ? msg.content.slice(0, 150) + '...' : msg.content}
                                    </div>
                                </motion.div>
                            );
                        })
                    )}
                </AnimatePresence>
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
                <AnimatePresence>
                    {participants.map(({ user, messageCount, lastActive }, i) => (
                        <motion.div
                            key={user.id}
                            custom={i}
                            variants={listItemVariants}
                            initial="hidden"
                            animate="visible"
                            className="participant-item"
                        >
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
                                    {messageCount} 条消息
                                    {lastActive > 0 && ` · ${formatTime(lastActive)}`}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );

    return (
        <>
            {/* Backdrop */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        className="sidebar-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <div className={clsx('chat-sidebar', isOpen && 'open')}>
                <div className="sidebar-header">
                    <div className="sidebar-header-icon">
                        <MessageCircle size={20} />
                    </div>
                    <div className="sidebar-header-content">
                        <h3>聊天信息</h3>
                        <div className="sidebar-header-subtitle">
                            <span className="online-dot" />
                            <span>{participants.length} 位成员 · {state.messages.length} 条消息</span>
                        </div>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className="sidebar-tabs">
                    <button
                        className={clsx('tab', activeTab === 'content' && 'active')}
                        onClick={() => setActiveTab('content')}
                    >
                        <FileText size={16} />
                        <span>内容</span>
                    </button>
                    <button
                        className={clsx('tab', activeTab === 'search' && 'active')}
                        onClick={() => setActiveTab('search')}
                    >
                        <Search size={16} />
                        <span>搜索</span>
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

                <div className="sidebar-content">
                    {activeTab === 'content' && renderContentTab()}
                    {activeTab === 'search' && renderSearchTab()}
                    {activeTab === 'tasks' && renderTasksTab()}
                    {activeTab === 'participants' && renderParticipantsTab()}
                </div>
            </div>
        </>
    );
};

export default ChatSidebar;
