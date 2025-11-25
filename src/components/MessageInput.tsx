import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { Send, Smile, X, Paperclip, Mic, Loader2, Reply } from 'lucide-react';
import { User } from '../types/chat';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { api } from '../api/client';
import { DEFAULT_CONVERSATION_ID } from '../types/chat';
import { EmojiPickerComponent } from './EmojiPicker';
import toast from 'react-hot-toast';

export const MessageInput: React.FC = () => {
    const { state, dispatch } = useChat();
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

    const markTyping = () => {
        if (!state.currentUser) return;
        dispatch({ type: 'SET_TYPING', payload: { userId: state.currentUser.id, isTyping: true } });
        api.typing.set(true).catch(() => { });
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            dispatch({ type: 'SET_TYPING', payload: { userId: state.currentUser!.id, isTyping: false } });
            api.typing.set(false).catch(() => { });
        }, TYPING_STOP_DELAY);
    };

    const stopTyping = () => {
        if (!state.currentUser) return;
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = null;
        }
        dispatch({ type: 'SET_TYPING', payload: { userId: state.currentUser.id, isTyping: false } });
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

    const handleSend = async () => {
        if (!content.trim() || !state.currentUser || sending) return;
        setSending(true);

        const mentions = state.users
            .filter(u => content.includes(`@${u.name}`))
            .map(u => u.id);

        try {
            const res = await api.messages.create({
                content: content.trim(),
                replyToId: state.replyingTo?.id,
                conversationId: DEFAULT_CONVERSATION_ID,
                role: 'user',
                mentions,
                metadata: { source: 'ui' },
            });
            dispatch({ type: 'SEND_MESSAGE', payload: res.message });
            if (res.users) {
                dispatch({ type: 'SET_USERS', payload: res.users });
            }
        } catch (err) {
            console.error('send message failed', err);
            toast.error('Failed to send message');
        }

        setContent('');
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
                                    <span className="reply-label">Replying to {state.users.find(u => u.id === state.replyingTo?.senderId)?.name}</span>
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

                <div className={clsx('input-bar', isFocused && 'focused')}>
                    <button className="icon-btn attach-btn" title="Attach">
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
                            placeholder="Write a message..."
                            rows={1}
                        />
                        <button
                            ref={emojiButtonRef}
                            className="icon-btn emoji-btn"
                            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                            title="Emoji"
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
          gap: 12px;
          background: radial-gradient(140% 160% at 50% -30%, rgba(51, 144, 236, 0.16), transparent 55%), rgba(255, 255, 255, 0.94);
          border-radius: 26px;
          padding: 12px;
          box-shadow: 0 20px 46px rgba(15, 23, 42, 0.14), 0 8px 20px rgba(15, 23, 42, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          transition: box-shadow 0.22s ease, transform 0.18s ease, background 0.25s ease;
          position: relative;
        }

        .input-bar::before {
          content: '';
          position: absolute;
          inset: 6px;
          border-radius: 18px;
          background: linear-gradient(120deg, rgba(51, 144, 236, 0.12), transparent 65%);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s ease;
        }

        .input-bar.focused {
          box-shadow: 0 24px 60px rgba(51, 144, 236, 0.22), 0 12px 26px rgba(15, 23, 42, 0.12);
          transform: translateY(-1px);
        }

        .input-bar.focused::before {
          opacity: 1;
        }

        .input-field-container {
            flex: 1;
            display: flex;
            align-items: flex-end;
            background: rgba(var(--bg-secondary-rgb), 0.82);
            border-radius: 18px;
            padding: 10px 16px;
            transition: box-shadow 0.2s, background-color 0.2s, transform 0.2s, border-color 0.2s;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
            border: 1px solid rgba(15, 23, 42, 0.08);
            border: 1px solid rgba(15, 23, 42, 0.08);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }

        .input-bar.focused .input-field-container {
            background-color: rgba(255, 255, 255, 0.98);
            box-shadow: 0 0 0 1px rgba(51, 144, 236, 0.28), 0 14px 32px rgba(51, 144, 236, 0.18);
            transform: translateY(-1px);
            border-color: rgba(51, 144, 236, 0.32);
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
          color: var(--text-secondary);
          padding: 8px;
          border-radius: 50%;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .icon-btn:hover {
          color: var(--text-primary);
          background-color: var(--bg-tertiary);
        }

        .attach-btn {
            margin-bottom: 4px;
        }

        .emoji-btn {
            margin-left: 8px;
            color: var(--text-tertiary);
        }
        
        .emoji-btn:hover {
            color: var(--accent-primary);
            background: none;
            transform: scale(1.1);
        }

        .input-action-slot {
            display: flex;
            align-items: center;
            min-width: 44px;
        }

        .send-btn {
          background-color: var(--accent-primary);
          color: white;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.2s, transform 0.2s;
          margin-bottom: 2px;
          box-shadow: var(--shadow-md);
        }

        .send-btn:hover {
          background-color: var(--accent-hover);
          transform: scale(1.05);
        }

        .send-btn.sending {
            opacity: 0.8;
            cursor: progress;
        }

        .mic-btn {
            background-color: var(--bg-secondary);
            color: var(--text-primary);
            width: 42px;
            height: 42px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s;
            margin-bottom: 2px;
        }
        
        .mic-btn:hover {
            background-color: var(--bg-tertiary);
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

