import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useTyping } from '../context/TypingContext';
import { Send, Smile, X, Paperclip, Mic, Loader2, Reply, FileText, Database } from 'lucide-react';
import { User } from '../types/chat';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { api } from '../api/client';
import { DEFAULT_CONVERSATION_ID } from '../types/chat';
import { EmojiPickerComponent } from './EmojiPicker';
import toast from 'react-hot-toast';

/**
 * Extract plain text from HTML content.
 * Removes all tags, decodes HTML entities, and normalizes whitespace.
 */
function extractTextFromHtml(html: string): string {
    // Create a temporary DOM element to parse HTML
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Remove script and style elements (they contain non-visible content)
    doc.querySelectorAll('script, style, noscript').forEach(el => el.remove());

    // Get text content
    let text = doc.body?.textContent || doc.documentElement?.textContent || '';

    // Normalize whitespace: collapse multiple spaces/newlines into single space
    text = text.replace(/\s+/g, ' ').trim();

    return text;
}

interface AttachedFile {
    name: string;
    content: string;
    size: number;
    type: string;
    file?: File; // Original file object for binary uploads
    isBinary?: boolean;
}

// Binary file extensions that need special handling
const BINARY_EXTENSIONS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.go', '.rs', '.rtf'];
const ALL_ALLOWED_EXTENSIONS = [...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS];

export const MessageInput: React.FC = () => {
    const { state, dispatch } = useChat();
    const { setTyping } = useTyping();
    const [content, setContent] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isFocused, setIsFocused] = useState(false);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const TYPING_STOP_DELAY = 1500;

    const [showMentions, setShowMentions] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionIndex, setMentionIndex] = useState(-1);
    const [mentionActive, setMentionActive] = useState(0);
    const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });

    const [sending, setSending] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const emojiButtonRef = useRef<HTMLButtonElement>(null);

    // File attachment state
    const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
    const [uploadingFile, setUploadingFile] = useState(false);
    const [uploadToRag, setUploadToRag] = useState(true); // Option to upload to knowledge base
    const fileInputRef = useRef<HTMLInputElement>(null);

    const markTyping = () => {
        if (!state.currentUser) return;
        setTyping(state.currentUser.id, true);
        api.typing.set(true).catch(() => { });
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            setTyping(state.currentUser!.id, false);
            api.typing.set(false).catch(() => { });
        }, TYPING_STOP_DELAY);
    };

    const stopTyping = () => {
        if (!state.currentUser) return;
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = null;
        }
        setTyping(state.currentUser.id, false);
        api.typing.set(false).catch(() => { });
    };

    const updateMentionPosition = useCallback(() => {
        if (!showMentions || !textareaRef.current || typeof window === 'undefined') return;
        const textarea = textareaRef.current;
        const selectionStart = textarea.selectionStart ?? textarea.value.length;
        const textBeforeCaret = textarea.value.substring(0, selectionStart);
        const rect = textarea.getBoundingClientRect();
        const mirror = document.createElement('div');
        const computed = window.getComputedStyle(textarea);
        mirror.style.position = 'absolute';
        mirror.style.top = `${rect.top + window.scrollY}px`;
        mirror.style.left = `${rect.left + window.scrollX}px`;
        mirror.style.visibility = 'hidden';
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.wordWrap = 'break-word';
        mirror.style.padding = computed.padding;
        mirror.style.border = computed.border;
        mirror.style.fontSize = computed.fontSize;
        mirror.style.fontFamily = computed.fontFamily;
        mirror.style.fontWeight = computed.fontWeight;
        mirror.style.lineHeight = computed.lineHeight;
        mirror.style.letterSpacing = computed.letterSpacing;
        mirror.style.boxSizing = 'border-box';
        mirror.style.width = `${textarea.clientWidth}px`;
        mirror.textContent = textBeforeCaret;
        const span = document.createElement('span');
        span.textContent = '\u200b';
        mirror.appendChild(span);
        document.body.appendChild(mirror);
        const spanRect = span.getBoundingClientRect();
        const mirrorRect = mirror.getBoundingClientRect();
        const caretTop = rect.top + (spanRect.top - mirrorRect.top);
        const caretLeft = rect.left + (spanRect.left - mirrorRect.left);
        const viewportWidth = window.innerWidth;
        const popupWidth = 260;
        const clampedLeft = Math.min(Math.max(16, caretLeft), viewportWidth - popupWidth - 16);
        const offsetTop = caretTop + 36;
        setMentionPosition({ top: offsetTop, left: clampedLeft });
        document.body.removeChild(mirror);
    }, [showMentions]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        const mentionableUsers = state.users.filter(u => u.id !== state.currentUser?.id && u.name.toLowerCase().includes(mentionQuery.toLowerCase()));

        if (showMentions && mentionableUsers.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionActive(prev => {
                    if (mentionableUsers.length === 0) return prev;
                    const delta = e.key === 'ArrowDown' ? 1 : -1;
                    return (prev + delta + mentionableUsers.length) % mentionableUsers.length;
                });
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(mentionableUsers[mentionActive] || mentionableUsers[0]);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowMentions(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (showMentions && mentionableUsers.length > 0) {
                insertMention(mentionableUsers[mentionActive] || mentionableUsers[0]);
            } else {
                handleSend();
            }
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newVal = e.target.value;
        setContent(newVal);
        if (newVal.trim()) {
            markTyping();
        } else {
            stopTyping();
        }

        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
        }

        const cursorPosition = e.target.selectionStart ?? newVal.length;
        const textBeforeCursor = newVal.slice(0, cursorPosition);
        const lastAtPos = textBeforeCursor.lastIndexOf('@');

        if (lastAtPos !== -1) {
            const query = textBeforeCursor.slice(lastAtPos + 1);
            if (!query.includes(' ') && query.length < 20) {
                setShowMentions(true);
                setMentionQuery(query);
                setMentionIndex(lastAtPos);
                setMentionActive(0);
                requestAnimationFrame(updateMentionPosition);
                return;
            }
        }
        setShowMentions(false);
    };

    const insertMention = (user: User) => {
        const beforeAt = content.slice(0, mentionIndex);
        const afterCursor = content.slice(mentionIndex + mentionQuery.length + 1);
        const newContent = `${beforeAt}@${user.name} ${afterCursor}`;
        setContent(newContent);
        setShowMentions(false);
        setMentionQuery('');
        setMentionActive(0);
        if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
        }
    };

    const cancelReply = () => {
        dispatch({ type: 'SET_REPLYING_TO', payload: undefined });
    };

    // File attachment handlers
    const handleFileSelect = async (evt: React.ChangeEvent<HTMLInputElement>) => {
        const file = evt.target.files?.[0];
        if (!file) return;

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }

        // Validate file type
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

        if (!ALL_ALLOWED_EXTENSIONS.includes(ext)) {
            toast.error('仅支持文本文件和文档 (.txt, .md, .pdf, .docx, .pptx 等)');
            return;
        }

        // Max file size: 10MB for binary files, 1MB for text files
        const isBinary = BINARY_EXTENSIONS.includes(ext);
        const maxSize = isBinary ? 10 * 1024 * 1024 : 1024 * 1024;
        if (file.size > maxSize) {
            toast.error(`文件大小不能超过 ${isBinary ? '10MB' : '1MB'}`);
            return;
        }

        try {
            if (isBinary) {
                // For binary files, store the file object for later upload via FormData
                setAttachedFile({
                    name: file.name,
                    content: '', // Content will be extracted by backend
                    size: file.size,
                    type: ext.slice(1),
                    file: file,
                    isBinary: true,
                });
                toast.success(`已添加文件: ${file.name}`);
            } else {
                // For text files, read content directly
                let content = await file.text();

                // Extract plain text from HTML/XML files for better RAG embeddings
                if (ext === '.html' || ext === '.xml') {
                    const originalLength = content.length;
                    content = extractTextFromHtml(content);
                    console.log(`[FileUpload] Extracted text from ${ext}: ${originalLength} -> ${content.length} chars`);

                    if (!content.trim()) {
                        toast.error('HTML 文件中未提取到有效文本内容');
                        return;
                    }
                }

                setAttachedFile({
                    name: file.name,
                    content,
                    size: file.size,
                    type: ext.slice(1),
                    isBinary: false,
                });
                toast.success(`已添加文件: ${file.name}`);
            }
        } catch (err) {
            console.error('Failed to read file:', err);
            toast.error('无法读取文件');
        }
    };

    const removeAttachedFile = () => {
        setAttachedFile(null);
    };

    const handleSend = async () => {
        // Allow sending with just file attached (no text required)
        if ((!content.trim() && !attachedFile) || !state.currentUser || sending) return;
        setSending(true);

        // 使用精确匹配：@username 后面必须是空格、标点或结尾
        const mentions = state.users
            .filter(u => {
                const regex = new RegExp(`@${u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[^\\w\\-\\.])`, 'i');
                return regex.test(content);
            })
            .map(u => u.id);

        try {
            // Build message content - include file reference if attached
            let messageContent = content.trim();
            let messageMetadata: Record<string, unknown> = { source: 'ui' };

            // If file is attached, optionally upload to knowledge base
            if (attachedFile) {
                if (uploadToRag) {
                    // Upload to RAG knowledge base
                    setUploadingFile(true);
                    try {
                        let uploadRes: { documentId: string; chunksCreated: number };

                        if (attachedFile.isBinary && attachedFile.file) {
                            // For binary files (PDF, DOCX, PPTX), use FormData upload
                            const formData = new FormData();
                            formData.append('file', attachedFile.file);

                            const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:4000');
                            const response = await fetch(`${API_BASE}/knowledge-base/upload-file`, {
                                method: 'POST',
                                credentials: 'include',
                                body: formData,
                            });

                            if (!response.ok) {
                                const errorData = await response.json().catch(() => ({}));
                                throw new Error(errorData.error || `Upload failed: ${response.status}`);
                            }

                            uploadRes = await response.json();
                        } else {
                            // For text files, use JSON upload
                            uploadRes = await api.post<{ documentId: string; chunksCreated: number }>(
                                '/knowledge-base/upload',
                                {
                                    content: attachedFile.content,
                                    filename: attachedFile.name,
                                    type: attachedFile.type,
                                }
                            );
                        }

                        // Add file info to message metadata
                        messageMetadata.attachment = {
                            filename: attachedFile.name,
                            documentId: uploadRes.documentId,
                            size: attachedFile.size,
                            type: attachedFile.type,
                            chunksCreated: uploadRes.chunksCreated,
                            uploadedToRag: true,
                        };

                        // Add visual indicator in message
                        const fileIndicator = `📎 [附件: ${attachedFile.name}] (已添加到知识库)`;
                        messageContent = messageContent
                            ? `${messageContent}\n\n${fileIndicator}`
                            : fileIndicator;

                        toast.success(`文件已添加到知识库 (${uploadRes.chunksCreated} 个文本块)`);
                    } catch (uploadErr) {
                        console.error('Failed to upload file:', uploadErr);
                        toast.error(uploadErr instanceof Error ? uploadErr.message : '文件上传失败');
                        setUploadingFile(false);
                        setSending(false);
                        return;
                    }
                    setUploadingFile(false);
                } else {
                    // Just share file as attachment without RAG upload
                    messageMetadata.attachment = {
                        filename: attachedFile.name,
                        size: attachedFile.size,
                        type: attachedFile.type,
                        content: attachedFile.isBinary ? '[Binary file]' : attachedFile.content,
                        uploadedToRag: false,
                    };

                    // Add visual indicator in message
                    const fileIndicator = `📎 [附件: ${attachedFile.name}]`;
                    messageContent = messageContent
                        ? `${messageContent}\n\n${fileIndicator}`
                        : fileIndicator;

                    toast.success(`文件已添加为附件`);
                }
            }

            const res = await api.messages.create({
                content: messageContent,
                replyToId: state.replyingTo?.id,
                conversationId: DEFAULT_CONVERSATION_ID,
                role: 'user',
                mentions,
                metadata: messageMetadata,
            });
            dispatch({ type: 'SEND_MESSAGE', payload: res.message });
            if (res.users) {
                dispatch({ type: 'SET_USERS', payload: res.users });
            }
        } catch (err) {
            console.error('send message failed', err);
            toast.error('发送消息失败');
        }

        setContent('');
        setAttachedFile(null);
        setUploadToRag(true); // Reset to default for next attachment
        stopTyping();
        setSending(false);
        dispatch({ type: 'SET_REPLYING_TO', payload: undefined });
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };

    useEffect(() => {
        return () => stopTyping();
    }, []);

    useEffect(() => {
        if (!showMentions) return;
        updateMentionPosition();
    }, [showMentions, mentionQuery, content, updateMentionPosition]);

    useEffect(() => {
        if (!showMentions) return;
        const handler = () => updateMentionPosition();
        window.addEventListener('resize', handler);
        window.addEventListener('scroll', handler, true);
        return () => {
            window.removeEventListener('resize', handler);
            window.removeEventListener('scroll', handler, true);
        };
    }, [showMentions, updateMentionPosition]);

    const filteredUsers = state.users.filter(u =>
        u.id !== state.currentUser?.id &&
        u.name.toLowerCase().includes(mentionQuery.toLowerCase())
    );

    useEffect(() => {
        if (!showMentions) return;
        setMentionActive(0);
    }, [mentionQuery, showMentions]);

    const mentionPopupVisible = showMentions && filteredUsers.length > 0;

    return (
        <div className="input-area-wrapper">
            <div className="input-content-container">
                <AnimatePresence>
                    {state.replyingTo && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="reply-preview-container"
                        >
                            <div className="reply-preview-content">
                                <div className="reply-icon-wrapper">
                                    <Reply size={14} />
                                </div>
                                <div className="reply-info">
                                    <span className="reply-label">回复 {state.users.find(u => u.id === state.replyingTo?.senderId)?.name}</span>
                                    <span className="reply-message-preview">{state.replyingTo.content}</span>
                                </div>
                            </div>
                            <button onClick={cancelReply} className="close-reply">
                                <X size={16} />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {mentionPopupVisible && (
                    <div
                        className="mention-popup"
                        style={{ top: mentionPosition.top, left: mentionPosition.left }}
                    >
                        {filteredUsers.map((user, index) => (
                            <button
                                key={user.id}
                                className={clsx('mention-item', index === mentionActive && 'active')}
                                onMouseEnter={() => setMentionActive(index)}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    insertMention(user);
                                }}
                            >
                                <img src={user.avatar} alt={user.name} className="mention-avatar" />
                                <span className="mention-name">{user.name}</span>
                                {user.isLLM && <span className="bot-tag">BOT</span>}
                            </button>
                        ))}
                    </div>
                )}

                {/* File attachment preview */}
                <AnimatePresence>
                    {attachedFile && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="file-preview-container"
                        >
                            <div className="file-preview-content">
                                <div className="file-icon-wrapper">
                                    <FileText size={16} />
                                </div>
                                <div className="file-info">
                                    <span className="file-name">{attachedFile.name}</span>
                                    <span className="file-meta">{(attachedFile.size / 1024).toFixed(1)} KB</span>
                                </div>
                            </div>
                            <div className="file-preview-actions">
                                <label className="rag-toggle" title={uploadToRag ? '将添加到知识库' : '仅作为附件分享'}>
                                    <input
                                        type="checkbox"
                                        checked={uploadToRag}
                                        onChange={(e) => setUploadToRag(e.target.checked)}
                                    />
                                    <span className={clsx('rag-toggle-switch', uploadToRag && 'active')}>
                                        <Database size={12} />
                                    </span>
                                    <span className="rag-toggle-label">{uploadToRag ? '添加到知识库' : '仅分享'}</span>
                                </label>
                                <button onClick={removeAttachedFile} className="remove-file-btn" title="移除文件">
                                    <X size={16} />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className={clsx('input-bar', isFocused && 'focused')}>
                    {/* Hidden file input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.md,.json,.csv,.xml,.html,.js,.ts,.py,.java,.c,.cpp,.go,.rs,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.rtf"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />
                    <button
                        className={clsx('icon-btn attach-btn', attachedFile && 'has-file')}
                        title="添加文件"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFile}
                    >
                        <Paperclip size={20} />
                    </button>

                    <div className="input-field-container">
                        <textarea
                            ref={textareaRef}
                            value={content}
                            onChange={handleChange}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => {
                                setIsFocused(false);
                                stopTyping();
                            }}
                            placeholder="输入消息..."
                            rows={1}
                        />
                        <button
                            ref={emojiButtonRef}
                            className="icon-btn emoji-btn"
                            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                            title="表情"
                        >
                            <Smile size={20} />
                        </button>
                        <EmojiPickerComponent
                            isOpen={showEmojiPicker}
                            onClose={() => setShowEmojiPicker(false)}
                            onEmojiSelect={(emoji) => {
                                const cursorPos = textareaRef.current?.selectionStart ?? content.length;
                                const newContent = content.slice(0, cursorPos) + emoji + content.slice(cursorPos);
                                setContent(newContent);
                                textareaRef.current?.focus();
                            }}
                            anchorEl={emojiButtonRef.current}
                        />
                    </div>

                    <div className="input-action-slot">
                        <AnimatePresence mode="wait" initial={false}>
                            {content.trim() ? (
                                <motion.button
                                    key="send"
                                    initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
                                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                    exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
                                    className={clsx('send-btn', sending && 'sending')}
                                    onClick={handleSend}
                                    disabled={sending}
                                >
                                    {sending ? <Loader2 size={18} className="btn-spinner" /> : <Send size={18} />}
                                </motion.button>
                            ) : (
                                <motion.button
                                    key="mic"
                                    initial={{ scale: 0.8, opacity: 0, rotate: 15 }}
                                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                    exit={{ scale: 0.8, opacity: 0, rotate: -10 }}
                                    className="mic-btn"
                                >
                                    <Mic size={20} />
                                </motion.button>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            <style>{`
        .input-area-wrapper {
          padding: 0;
          background: transparent;
          position: relative;
          z-index: 20;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }

        .input-content-container {
            max-width: var(--content-max-width);
            padding: var(--spacing-sm) var(--content-gutter);
            box-sizing: border-box;
            margin: 0 auto;
            width: 100%;
            position: relative;
        }

        .reply-preview-container {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 12px;
          margin-bottom: 8px;
          background: rgba(var(--bg-secondary-rgb), 0.5);
          border-radius: var(--radius-md);
          border-left: 3px solid var(--accent-primary);
        }

        .reply-preview-content {
            display: flex;
            gap: 10px;
            flex: 1;
            align-items: flex-start;
            min-width: 0;
        }

        .reply-icon-wrapper {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background-color: var(--accent-primary);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .reply-info {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 2px;
            flex: 1;
            min-width: 0;
        }

        .reply-label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            font-weight: 500;
        }

        .reply-message-preview {
            font-size: 0.85rem;
            color: var(--text-primary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .close-reply {
          padding: 4px;
          border-radius: 50%;
          color: var(--text-secondary);
          transition: background-color 0.2s;
          flex-shrink: 0;
        }

        .close-reply:hover {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .input-bar {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          background: rgba(255, 255, 255, 0.85);
          border-radius: 28px; /* 大圆角，接近胶囊 */
          padding: 6px 8px 6px 12px;
          box-shadow: 
            0 4px 6px -1px rgba(0, 0, 0, 0.05),
            0 10px 30px -5px rgba(0, 0, 0, 0.08),
            0 0 0 1px rgba(0, 0, 0, 0.03); /* 极细的内描边替代 border */
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
          position: relative;
          margin-bottom: 8px; /* 底部留白，制造悬浮感 */
        }

        .input-bar.focused {
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 
            0 12px 40px -8px rgba(37, 99, 235, 0.15),
            0 0 0 2px rgba(37, 99, 235, 0.1); /* 聚焦时的光晕 */
          transform: translateY(-2px);
        }

        .input-field-container {
            flex: 1;
            display: flex;
            align-items: flex-end;
            background: var(--bg-tertiary);
            border-radius: var(--radius-xl);
            padding: 10px 16px;
            transition: var(--transition-base);
            border: 1px solid transparent;
        }

        .input-bar.focused .input-field-container {
            background-color: #fff;
            box-shadow: var(--shadow-sm);
            border-color: var(--border-accent);
        }

        textarea {
          flex: 1;
          background: transparent;
          border: none;
          resize: none;
          outline: none;
          color: var(--text-primary);
          font-size: 1rem;
          line-height: 1.5;
          max-height: 150px;
          padding: 4px 0;
          min-height: 24px;
        }

        textarea::placeholder {
          color: var(--text-tertiary);
        }

        .icon-btn {
          color: var(--text-tertiary);
          padding: 10px;
          border-radius: 50%;
          transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          width: 40px;
          height: 40px;
        }

        .icon-btn:hover {
          color: var(--accent-primary);
          background-color: rgba(37, 99, 235, 0.08);
          transform: scale(1.05);
        }

        .attach-btn {
            margin-bottom: 2px;
        }

        .attach-btn.has-file {
            color: var(--accent-primary);
            background: rgba(37, 99, 235, 0.1);
        }

        /* 隐藏文件预览的边框，让它更像卡片 */
        .file-preview-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 16px;
          margin-bottom: 12px;
          background: #ffffff;
          border-radius: 16px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
          border: 1px solid var(--border-light);
        }

        .file-preview-content {
            display: flex;
            gap: 12px;
            flex: 1;
            align-items: center;
            min-width: 0;
        }

        .file-icon-wrapper {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            background: linear-gradient(135deg, #8b5cf6, #6366f1);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        }

        .file-info {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 2px;
            flex: 1;
            min-width: 0;
        }

        .file-name {
            font-size: 0.9rem;
            color: var(--text-primary);
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .file-meta {
            font-size: 0.75rem;
            color: var(--text-tertiary);
        }

        .file-preview-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        .rag-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;
            padding: 6px 10px;
            border-radius: 20px;
            background: var(--bg-tertiary);
            transition: all 0.2s ease;
        }

        .rag-toggle:hover {
            background: var(--bg-secondary);
        }

        .rag-toggle input {
            display: none;
        }

        .rag-toggle-switch {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: var(--text-tertiary);
            color: white;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .rag-toggle-switch.active {
            background: linear-gradient(135deg, #8b5cf6, #6366f1);
            box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
            transform: scale(1.05);
        }

        .rag-toggle-label {
            font-size: 0.75rem;
            font-weight: 500;
            color: var(--text-secondary);
            white-space: nowrap;
        }

        .remove-file-btn {
          padding: 8px;
          border-radius: 50%;
          color: var(--text-secondary);
          transition: all 0.2s;
          flex-shrink: 0;
        }

        .remove-file-btn:hover {
          background-color: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          transform: rotate(90deg);
        }

        .emoji-btn {
            margin-bottom: 2px;
            color: var(--text-tertiary);
        }
        
        .emoji-btn:hover {
            color: #f59e0b; /* Amber 500 */
            background: rgba(245, 158, 11, 0.1);
            transform: scale(1.1) rotate(8deg);
        }

        .input-action-slot {
            display: flex;
            align-items: center;
            min-width: 48px;
            justify-content: flex-end;
            padding-bottom: 2px;
        }

        .send-btn {
          background: var(--accent-primary); /* 纯色比渐变更高级 */
          color: white;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
        }

        .send-btn:hover {
          background: var(--accent-hover);
          transform: scale(1.1) rotate(-10deg);
          box-shadow: 0 8px 20px rgba(37, 99, 235, 0.4);
        }

        .send-btn:active {
          transform: scale(0.95);
        }

        .send-btn.sending {
            opacity: 0.8;
            cursor: progress;
            transform: scale(1);
        }

        .mic-btn {
            background-color: var(--bg-tertiary);
            color: var(--text-secondary);
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            border: none;
        }

        .mic-btn:hover {
            background-color: var(--border-light);
            color: var(--text-primary);
            transform: scale(1.05);
        }

        .btn-spinner {
            animation: spin 1s linear infinite;
        }

        .mention-popup {
          position: fixed;
          transform: translateY(-100%);
          min-width: 240px;
          max-width: 280px;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          box-shadow: 0 25px 60px rgba(15, 23, 42, 0.2);
          max-height: 220px;
          overflow-y: auto;
          z-index: 99;
          display: flex;
          flex-direction: column;
          padding: 6px;
          gap: 4px;
        }

        .mention-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          border-radius: var(--radius-sm);
          width: 100%;
          text-align: left;
          transition: background-color 0.1s;
        }

        .mention-item.active {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .mention-avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
        }

        .mention-name {
          font-size: 0.9rem;
          color: var(--text-primary);
          flex: 1;
        }



        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
};

