import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
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
} from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { User } from '../types/chat';
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
    text: string;
    sender: User | undefined;
    timestamp: number;
    messageId: string;
}

interface ChatSidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

// URL regex pattern
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// TODO patterns to detect
const TODO_PATTERNS = [
    /TODO[:\s]+(.+?)(?:\n|$)/gi,
    /\[ \]\s*(.+?)(?:\n|$)/gi,
    /(?:we should|let's|need to|have to|must)\s+(.+?)(?:\.|!|\n|$)/gi,
    /(?:action item|task)[:\s]+(.+?)(?:\n|$)/gi,
];

// API base URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ isOpen, onClose }) => {
    const { state } = useChat();
    const [activeTab, setActiveTab] = useState<TabType>('content');
    const [contentSubTab, setContentSubTab] = useState<ContentSubTab>('documents');
    const [reasoning, setReasoning] = useState<string>('');
    const [summary, setSummary] = useState<string>('');
    const [summaryError, setSummaryError] = useState<string>('');
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingPhase, setStreamingPhase] = useState<'idle' | 'reasoning' | 'output'>('idle');
    const abortControllerRef = useRef<AbortController | null>(null);
    const reasoningRef = useRef<HTMLDivElement>(null);
    const rawContentRef = useRef<string>('');

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
            TODO_PATTERNS.forEach((pattern) => {
                const regex = new RegExp(pattern.source, pattern.flags);
                let match;
                while ((match = regex.exec(msg.content)) !== null) {
                    const text = match[1]?.trim() || match[0].trim();
                    const normalizedText = text.toLowerCase();
                    if (text.length > 5 && text.length < 200 && !seenTexts.has(normalizedText)) {
                        seenTexts.add(normalizedText);
                        extracted.push({
                            text,
                            sender: state.users.find((u) => u.id === msg.senderId),
                            timestamp: msg.timestamp,
                            messageId: msg.id,
                        });
                    }
                }
            });
        });
        return extracted.sort((a, b) => b.timestamp - a.timestamp);
    }, [state.messages, state.users]);

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
            .filter((p) => p.messageCount > 0)
            .sort((a, b) => b.messageCount - a.messageCount);
    }, [state.messages, state.users]);

    // Stop streaming
    const stopStreaming = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsStreaming(false);
        setLoadingSummary(false);
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
            setSummaryError('No messages to summarize yet.');
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
                return `${sender?.name || 'Unknown'}: ${m.content}`;
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
                body: JSON.stringify({ messages: recentMessages }),
                signal: abortControllerRef.current.signal,
                credentials: 'include',
            });

            // Check if it's a JSON error response (not streaming)
            const contentType = response.headers.get('content-type');
            if (contentType?.includes('application/json')) {
                const errorData = await response.json();
                setSummaryError(errorData.error || 'Failed to generate summary');
                setLoadingSummary(false);
                setIsStreaming(false);
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Process SSE stream
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

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
            const errorMessage = err instanceof Error ? err.message : 'Failed to generate summary';
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
            return 'Yesterday';
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
                    <span>Documents</span>
                    <span className="count">{documents.length}</span>
                </button>
                <button
                    className={clsx('subtab', contentSubTab === 'links' && 'active')}
                    onClick={() => setContentSubTab('links')}
                >
                    <Link2 size={14} />
                    <span>Links</span>
                    <span className="count">{links.length}</span>
                </button>
                <button
                    className={clsx('subtab', contentSubTab === 'media' && 'active')}
                    onClick={() => setContentSubTab('media')}
                >
                    <Image size={14} />
                    <span>Media</span>
                    <span className="count">{media.length}</span>
                </button>
            </div>

            <div className="content-list">
                {contentSubTab === 'documents' && (
                    documents.length === 0 ? (
                        <div className="empty-state">No documents shared yet</div>
                    ) : (
                        documents.map((doc) => (
                            <div key={doc.id} className="content-item">
                                <div className="content-icon doc">
                                    <FileText size={16} />
                                </div>
                                <div className="content-info">
                                    <div className="content-title">{doc.filename}</div>
                                    <div className="content-meta">
                                        <span>{doc.sender?.name || 'Unknown'}</span>
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
                        <div className="empty-state">No links shared yet</div>
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
                                        <span>{link.sender?.name || 'Unknown'}</span>
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
                        <div className="empty-state">No media shared yet</div>
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
            {/* Summary Section */}
            <div className="tasks-section">
                <div className="section-header">
                    <MessageSquare size={16} />
                    <span>Chat Summary</span>
                    {isStreaming && (
                        <span className="streaming-badge">
                            <span className="streaming-dot" />
                            {streamingPhase === 'reasoning' ? 'Thinking' : 'Writing'}
                        </span>
                    )}
                </div>
                <div className="summary-container">
                    {summaryError ? (
                        <div className="summary-error">
                            <AlertCircle size={18} />
                            <span>{summaryError}</span>
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
                                        <span>Summary</span>
                                    </div>
                                    <div className="summary-content markdown-content">
                                        <ReactMarkdown>{summary}</ReactMarkdown>
                                        {streamingPhase === 'output' && <span className="typing-cursor" />}
                                    </div>
                                </div>
                            )}

                            {/* Initial loading state */}
                            {loadingSummary && !reasoning && !summary && (
                                <div className="summary-loading">
                                    <Loader2 size={24} className="loading-spinner" />
                                    <span>Connecting...</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="summary-placeholder">
                            Click the button below to generate an AI-powered summary of this conversation.
                        </div>
                    )}
                    <div className="summary-actions">
                        {isStreaming ? (
                            <button className="stop-btn" onClick={stopStreaming}>
                                <StopCircle size={14} />
                                <span>Stop</span>
                            </button>
                        ) : (
                            <button
                                className="generate-btn"
                                onClick={generateSummary}
                                disabled={loadingSummary}
                            >
                                <Sparkles size={14} />
                                <span>{summary ? 'Regenerate' : summaryError ? 'Try Again' : 'Generate Summary'}</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* TODO List Section */}
            <div className="tasks-section">
                <div className="section-header">
                    <CheckSquare size={16} />
                    <span>Extracted Tasks</span>
                    <span className="count">{todos.length}</span>
                </div>
                <div className="todo-list">
                    {todos.length === 0 ? (
                        <div className="empty-state">
                            No tasks detected. Tasks are extracted from patterns like "TODO:", "we should...", "let's...", etc.
                        </div>
                    ) : (
                        todos.map((todo, idx) => (
                            <div key={idx} className="todo-item">
                                <CheckSquare size={14} className="todo-icon" />
                                <div className="todo-content">
                                    <div className="todo-text">{todo.text}</div>
                                    <div className="todo-meta">
                                        <span>{todo.sender?.name || 'Unknown'}</span>
                                        <span className="dot">·</span>
                                        <span>{formatTime(todo.timestamp)}</span>
                                    </div>
                                </div>
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
                <span>Participants</span>
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
                                {user.type === 'agent' && (
                                    <span className="agent-badge">Agent</span>
                                )}
                            </div>
                            <div className="participant-meta">
                                <span>{messageCount} messages</span>
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
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    >
                        {/* Header */}
                        <div className="sidebar-header">
                            <h3>Chat Info</h3>
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
                                <span>Content</span>
                            </button>
                            <button
                                className={clsx('tab', activeTab === 'tasks' && 'active')}
                                onClick={() => setActiveTab('tasks')}
                            >
                                <CheckSquare size={16} />
                                <span>Tasks</span>
                            </button>
                            <button
                                className={clsx('tab', activeTab === 'participants' && 'active')}
                                onClick={() => setActiveTab('participants')}
                            >
                                <Users size={16} />
                                <span>People</span>
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
    .sidebar-backdrop {
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
    font-size: 1.1rem;
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
}

.link-item {
    text-decoration: none;
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
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 4px;
    word-break: break-word;
}

.external-icon {
    flex-shrink: 0;
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
    aspect-ratio: 1;
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
    padding: 24px 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 0.85rem;
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
    margin-left: auto;
    background: var(--bg-tertiary);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-secondary);
}

.summary-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.summary-content {
    font-size: 0.85rem;
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
    font-size: 0.85rem;
    color: var(--text-secondary);
}

.summary-loading .loading-hint {
    font-size: 0.75rem;
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
    font-size: 0.85rem;
    line-height: 1.5;
}

.summary-error svg {
    flex-shrink: 0;
    margin-top: 2px;
}

.summary-actions {
    display: flex;
    gap: 8px;
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
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
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
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
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
    width: 100%;
}

.stop-btn:hover {
    background: #dc2626;
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
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
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
    margin-bottom: 12px;
}

.output-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent-primary);
}

/* Loading spinner animation */
.loading-spinner {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
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
    margin-top: 1em;
    margin-bottom: 0.5em;
    font-weight: 600;
}

.markdown-content h1 { font-size: 1.2rem; }
.markdown-content h2 { font-size: 1.1rem; }
.markdown-content h3 { font-size: 1rem; }
.markdown-content h4 { font-size: 0.95rem; }

.markdown-content p {
    margin-bottom: 0.75em;
}

.markdown-content ul,
.markdown-content ol {
    margin-left: 1.5em;
    margin-bottom: 0.75em;
}

.markdown-content li {
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

.summary-placeholder {
    font-size: 0.8rem;
    color: var(--text-tertiary);
    font-style: italic;
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

.generate-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}

.generate-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
}

.todo-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 300px;
    overflow-y: auto;
}

.todo-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px;
    background: var(--bg-primary);
    border-radius: 8px;
}

.todo-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
    margin-top: 2px;
}

.todo-content {
    flex: 1;
    min-width: 0;
}

.todo-text {
    font-size: 0.85rem;
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
    transition: all 0.2s;
}

.participant-item:hover {
    background: var(--bg-tertiary);
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
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 6px;
}

.agent-badge {
    font-size: 0.65rem;
    padding: 2px 6px;
    background: rgba(139, 92, 246, 0.15);
    color: #8b5cf6;
    border-radius: 4px;
    font-weight: 500;
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
    .chat-sidebar {
        width: 100%;
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
