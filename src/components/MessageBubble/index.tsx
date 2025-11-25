import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Message, DEFAULT_CONVERSATION_ID } from '../../types/chat';
import { useChat } from '../../context/ChatContext';
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
    const currentUserId = state.currentUser?.id;
    const sender = state.users.find(u => u.id === message.senderId);
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

    const repliedMessage = message.replyToId ? state.messages.find(m => m.id === message.replyToId) : null;
    const repliedUser = repliedMessage ? state.users.find(u => u.id === repliedMessage.senderId) : null;

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
            dispatch({ type: 'DELETE_MESSAGE', payload: { id: res.deletedMessageId } });

            try {
                const refreshed = await api.messages.list({ limit: 100, conversationId: conversation });
                dispatch({ type: 'SET_MESSAGES', payload: refreshed.messages });
                dispatch({ type: 'SET_USERS', payload: refreshed.users });
            } catch (refreshErr) {
                console.error('Failed to refresh messages after delete', refreshErr);
            }

            setShowDeleteConfirm(false);
            toast.success('Message deleted');
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
                                    isOwnMessage={isOwnMessage}
                                />
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div >
    );
});
