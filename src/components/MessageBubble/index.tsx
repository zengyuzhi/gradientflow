import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Message, DEFAULT_CONVERSATION_ID } from '../../types/chat';
import { useChat } from '../../context/ChatContext';
import { useUsersLookup } from '../../context/UsersLookupContext';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { api } from '../../api/client';
import { MessageStatus } from '../MessageStatus';
import { useShouldUseComplexAnimations } from '../../hooks/useDevicePerformance';
import { ANIMATION_CONFIG } from '../../constants/animations';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { ReactionPanel } from './ReactionPanel';
import { ActionButtons } from './ActionButtons';
import { ReplyContext } from './ReplyContext';
import { ReactionList } from './ReactionList';
import { MessageContent } from './MessageContent';
import './styles.css';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';

interface MessageBubbleProps {
    message: Message;
    isOwnMessage: boolean;
    showAvatar: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({ message, isOwnMessage, showAvatar }) => {
    const { state, dispatch } = useChat();
    const { getUserById } = useUsersLookup();
    const currentUserId = state.currentUser?.id;
    // O(1) lookup instead of O(n) find
    const sender = useMemo(() => getUserById(message.senderId), [getUserById, message.senderId]);
    const isAgentSender = sender?.type === 'agent' || sender?.isLLM;
    const prefersReducedMotion = useReducedMotion();
    const shouldUseComplexAnimations = useShouldUseComplexAnimations();
    const [isHovered, setIsHovered] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const contentColumnRef = useRef<HTMLDivElement>(null);
    const actionsGroupRef = useRef<HTMLDivElement>(null);

    const isHoveringInteractiveArea = useCallback(() => {
        const contentEl = contentColumnRef.current;
        const actionsEl = actionsGroupRef.current;
        return Boolean(
            (contentEl && contentEl.matches(':hover')) ||
            (actionsEl && actionsEl.matches(':hover'))
        );
    }, []);

    const clearHoverTimeout = () => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
    };

    // Memoize replied message lookup
    const repliedMessage = useMemo(() => {
        if (!message.replyToId) return null;
        return state.messages.find(m => m.id === message.replyToId) ?? null;
    }, [message.replyToId, state.messages]);

    // O(1) lookup for replied user
    const repliedUser = useMemo(() => {
        if (!repliedMessage) return null;
        return getUserById(repliedMessage.senderId) ?? null;
    }, [repliedMessage, getUserById]);

    const handleReaction = async (emoji: string) => {
        if (!state.currentUser) return;
        try {
            const { message: updatedMessage } = await api.messages.react(message.id, emoji, message.conversationId);
            dispatch({ type: 'UPDATE_MESSAGE', payload: updatedMessage });
        } catch (err) {
            console.error('Failed to toggle reaction', err);
            toast.error('Failed to add reaction');
        }
    };

    const handleReply = () => {
        dispatch({ type: 'SET_REPLYING_TO', payload: message });
    };

    // 获取第一个可用的 AI Agent
    const firstAgent = useMemo(() => {
        return state.agents.find(a => a.status === 'active');
    }, [state.agents]);

    const handleAskAI = async () => {
        if (!firstAgent || !state.currentUser) return;

        // 获取 agent 对应的用户
        const agentUser = state.users.find(u => u.id === firstAgent.userId);
        if (!agentUser) {
            toast.error('AI Agent not available');
            return;
        }

        // 构建提问消息：引用原消息并 @ AI
        const truncatedContent = message.content.length > 100
            ? message.content.slice(0, 100) + '...'
            : message.content;
        const askContent = `@${agentUser.name} 请解释或评论这条消息: "${truncatedContent}"`;

        try {
            const { message: newMsg, users } = await api.messages.create({
                content: askContent,
                replyToId: message.id,
                conversationId: message.conversationId || DEFAULT_CONVERSATION_ID,
                mentions: [agentUser.id],
            });
            dispatch({ type: 'UPSERT_MESSAGES', payload: [newMsg] });
            if (users?.length) {
                dispatch({ type: 'SET_USERS', payload: users });
            }
            toast.success('已请求 AI 回复');
        } catch (err) {
            console.error('Failed to ask AI', err);
            toast.error('发送失败');
        }
    };

    const openDeleteConfirm = () => {
        if (!isOwnMessage) return;
        setDeleteError(null);
        setShowDeleteConfirm(true);
    };

    const closeDeleteConfirm = () => {
        if (isDeleting) return;
        setShowDeleteConfirm(false);
        setDeleteError(null);
    };

    const handleDeleteConfirm = async () => {
        if (!isOwnMessage || isDeleting) return;
        const conversation = message.conversationId || DEFAULT_CONVERSATION_ID;
        try {
            setIsDeleting(true);
            setDeleteError(null);
            const res = await api.messages.delete(message.id, conversation);
            // 支持级联删除：后端返回 deletedMessageIds 数组
            if (res.deletedMessageIds && res.deletedMessageIds.length > 0) {
                dispatch({ type: 'DELETE_MESSAGES', payload: { ids: res.deletedMessageIds } });
            } else if (res.deletedMessageId) {
                // 兼容旧版本
                dispatch({ type: 'DELETE_MESSAGE', payload: { id: res.deletedMessageId } });
            }

            try {
                const refreshed = await api.messages.list({ limit: 100, conversationId: conversation });
                dispatch({ type: 'SET_MESSAGES', payload: refreshed.messages });
                dispatch({ type: 'SET_USERS', payload: refreshed.users });
            } catch (refreshErr) {
                console.error('Failed to refresh messages after delete', refreshErr);
            }

            setShowDeleteConfirm(false);
            const count = res.deletedMessageIds?.length || 1;
            toast.success(count > 1 ? `Deleted ${count} messages` : 'Message deleted');
        } catch (err) {
            console.error('Failed to delete message', err);
            setDeleteError('Failed to delete. Please try again.');
            toast.error('Failed to delete message');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleMouseEnter = () => {
        clearHoverTimeout();
        hoverTimeoutRef.current = setTimeout(() => {
            setIsHovered(true);
        }, ANIMATION_CONFIG.HOVER_IN_DELAY);
    };

    const handleMouseLeave = () => {
        clearHoverTimeout();
        if (showDeleteConfirm) return;
        hoverTimeoutRef.current = setTimeout(() => {
            if (!isHoveringInteractiveArea()) {
                setIsHovered(false);
            }
        }, ANIMATION_CONFIG.HOVER_OUT_DELAY);
    };

    useEffect(() => () => clearHoverTimeout(), []);
    useEffect(() => {
        if (!isHovered) return;
        if (!isHoveringInteractiveArea()) {
            setIsHovered(false);
        }
    }, [isHovered, message.reactions, isHoveringInteractiveArea]);
    useEffect(() => {
        setIsHovered(false);
        setShowDeleteConfirm(false);
    }, [message.id]);
    const timestamp = useMemo(() => dayjs(message.timestamp), [message.timestamp]);
    const timeLabel = timestamp.format('HH:mm');
    const fullTimeLabel = timestamp.format('LLL');
    const hasReacted = (emoji: string) =>
        Boolean(currentUserId && message.reactions.some(r => r.emoji === emoji && r.userIds.includes(currentUserId)));
    const shouldShowActions = isHovered || showDeleteConfirm;
    const exitAnimation = useMemo(() => {
        if (prefersReducedMotion) {
            return { opacity: 0, y: -4 };
        }
        return {
            opacity: 0,
            scale: 0.92,
            x: isOwnMessage ? 8 : -8,
            y: -6,
            filter: 'blur(8px)',
            transition: {
                duration: 0.24,
                ease: [0.22, 0.72, 0.3, 1],
                filter: { duration: 0.18 }
            }
        };
    }, [isOwnMessage, prefersReducedMotion]);

    return (
        <motion.div
            initial={{ opacity: 0, x: isOwnMessage ? 16 : -16, scale: prefersReducedMotion ? 1 : 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={exitAnimation}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.85 }}
            layout="position"
            style={{ transformOrigin: isOwnMessage ? '100% 50%' : '0% 50%' }}
            className={clsx('message-container', isOwnMessage ? 'own' : 'other')}
        >
            {!isOwnMessage && (
                <div className="avatar-column">
                    {showAvatar && sender && (
                        <img src={sender.avatar} alt={sender.name} className="avatar" />
                    )}
                </div>
            )}

            <div
                className="content-column"
                ref={contentColumnRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {!isOwnMessage && showAvatar && sender && (
                    <div className="sender-name">
                        {sender.name}
                        {isAgentSender && <span className="bot-tag">AI</span>}
                        <span className="timestamp">{timeLabel}</span>
                    </div>
                )}

                {repliedMessage && repliedUser && (
                    <ReplyContext
                        repliedMessage={repliedMessage}
                        repliedUser={repliedUser}
                        onReplyClick={handleReply}
                    />
                )}

                <div className={clsx('bubble', isOwnMessage ? 'own' : 'other', isAgentSender && 'agent', isHovered && 'hovered')}>
                    <MessageContent content={message.content} users={state.users} />
                    <div className="bubble-meta">
                        {message.editedAt && <span className="message-edited">(edited)</span>}
                        <span className="bubble-timestamp" aria-label={fullTimeLabel} title={fullTimeLabel}>
                            {timeLabel}
                        </span>
                        <MessageStatus status={message.status} isOwnMessage={isOwnMessage} />
                    </div>
                </div>

                <ReactionList
                    reactions={message.reactions}
                    onReact={handleReaction}
                    hasReacted={hasReacted}
                    users={state.users}
                />
            </div>

            <AnimatePresence>
                {shouldShowActions && (
                    <motion.div
                        ref={actionsGroupRef}
                        initial={{ opacity: 0, scale: 0.9, y: 18, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.92, y: 10, filter: 'blur(4px)' }}
                        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                        className={clsx('actions-group', showDeleteConfirm && 'confirming')}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                    >
                        {showDeleteConfirm ? (
                            <DeleteConfirmDialog
                                onCancel={closeDeleteConfirm}
                                onConfirm={handleDeleteConfirm}
                                isDeleting={isDeleting}
                                error={deleteError}
                            />
                        ) : (
                            <>
                                <ReactionPanel
                                    onReact={handleReaction}
                                    hasReacted={hasReacted}
                                    shouldUseComplexAnimations={shouldUseComplexAnimations}
                                />
                                <ActionButtons
                                    onReply={handleReply}
                                    onDelete={isOwnMessage ? openDeleteConfirm : undefined}
                                    onAskAI={firstAgent ? handleAskAI : undefined}
                                    isOwnMessage={isOwnMessage}
                                    showAskAI={!isAgentSender && !!firstAgent}
                                />
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div >
    );
});
