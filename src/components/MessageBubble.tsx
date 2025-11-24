import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Message } from '../types/chat';
import { useChat } from '../context/ChatContext';
import { Reply, MoreHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { api } from '../api/client';

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  showAvatar: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwnMessage, showAvatar }) => {
  const { state, dispatch } = useChat();
  const currentUserId = state.currentUser?.id;
  const sender = state.users.find(u => u.id === message.senderId);
  const reactionOptions = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HOVER_IN_DELAY = 80;
  const HOVER_OUT_DELAY = 220;

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
    }
  };

  const handleReply = () => {
    dispatch({ type: 'SET_REPLYING_TO', payload: message });
  };

  const handleMouseEnter = () => {
    clearHoverTimeout();
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, HOVER_IN_DELAY);
  };

  const handleMouseLeave = () => {
    clearHoverTimeout();
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, HOVER_OUT_DELAY);
  };

  useEffect(() => () => clearHoverTimeout(), []);

  const timestamp = useMemo(() => new Date(message.timestamp), [message.timestamp]);
  const timeLabel = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fullTimeLabel = timestamp.toLocaleString();
  const hasReacted = (emoji: string) =>
    Boolean(currentUserId && message.reactions.some(r => r.emoji === emoji && r.userIds.includes(currentUserId)));

  return (
    <motion.div
      initial={{ opacity: 0, x: isOwnMessage ? 16 : -16, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: isOwnMessage ? 10 : -10 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      layout
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
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {!isOwnMessage && showAvatar && sender && (
          <div className="sender-name">
            {sender.name}
            {sender.isLLM && <span className="bot-tag">BOT</span>}
            <span className="timestamp">{timeLabel}</span>
          </div>
        )}

        {repliedMessage && repliedUser && (
          <div className="reply-context" onClick={handleReply}>
            <div className="reply-bar" />
            <div className="reply-content-wrapper">
              <span className="reply-author">{repliedUser.name}</span>
              <span className="reply-text">{repliedMessage.content}</span>
            </div>
          </div>
        )}

        <div className={clsx('bubble', isOwnMessage ? 'own' : 'other', isHovered && 'hovered')}>
          <span className="bubble-text">{message.content}</span>
          <span className="bubble-timestamp" aria-label={fullTimeLabel} title={fullTimeLabel}>
            {timeLabel}
          </span>
        </div>

        {message.reactions.length > 0 && (
          <div className="reactions-list">
            <AnimatePresence>
              {message.reactions.map((reaction) => {
                const active = hasReacted(reaction.emoji);
                return (
                  <motion.button
                    key={reaction.emoji}
                    className={clsx('reaction-pill', active && 'active')}
                    onClick={() => handleReaction(reaction.emoji)}
                    initial={{ opacity: 0, y: 6, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                    whileHover={{ y: -2, scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    title={`${reaction.count} reacted with ${reaction.emoji}`}
                  >
                    <span>{reaction.emoji}</span>
                    <span className="count">{reaction.count}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 18, filter: 'blur(6px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.92, y: 10, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            className="actions-group"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="emoji-panel">
              {reactionOptions.map((emoji, index) => (
                <motion.button
                  key={emoji}
                  className={clsx('emoji-btn', hasReacted(emoji) && 'active')}
                  onClick={() => handleReaction(emoji)}
                  initial={{ opacity: 0, scale: 0.5, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 20,
                    delay: index * 0.04
                  }}
                  whileHover={{ scale: 1.25, rotate: -8, transition: { type: 'spring', stiffness: 400, damping: 15 } }}
                  whileTap={{ scale: 0.9 }}
                  title={`React with ${emoji}`}
                >
                  {emoji}
                  <span className="emoji-glow" aria-hidden="true" />
                </motion.button>
              ))}
            </div>
            <div className="action-buttons">
              <button className="action-btn" onClick={handleReply} title="Reply">
                <Reply size={16} />
              </button>
              <button className="action-btn" title="More">
                <MoreHorizontal size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .message-container {
          display: flex;
          gap: var(--spacing-sm);
          margin-bottom: 2px;
          padding: 2px 0;
          position: relative;
          align-items: flex-end;
        }

        .message-container.own {
          flex-direction: row-reverse;
        }

        .avatar-column {
          width: 36px;
          flex-shrink: 0;
          display: flex;
          margin-bottom: 4px;
        }

        .avatar {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          object-fit: cover;
        }

        .content-column {
          display: flex;
          flex-direction: column;
          max-width: 75%;
          align-items: flex-start;
          position: relative;
        }

        .message-container.own .content-column {
          align-items: flex-end;
        }

        .sender-name {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-secondary);
          margin-bottom: 2px;
          margin-left: 12px;
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
        }

        .timestamp {
          font-size: 0.7rem;
          color: var(--text-tertiary);
          font-weight: 400;
          margin-left: var(--spacing-xs);
        }

        .bot-tag {
          font-size: 0.6rem;
          background-color: var(--accent-primary);
          color: white;
          padding: 1px 4px;
          border-radius: 4px;
        }

        .bubble {
          padding: 8px 12px;
          border-radius: var(--radius-xl);
          font-size: 1rem;
          line-height: 1.4;
          position: relative;
          box-shadow: var(--shadow-sm);
          transition: background-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
          border: 1px solid transparent;
          background-image: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.02));
          transform-origin: center;
          will-change: transform, box-shadow;
          display: inline-flex;
          gap: 8px;
          align-items: flex-end;
        }

        .bubble-text {
          white-space: pre-wrap;
          word-wrap: break-word;
          word-break: break-word;
        }

        .bubble-timestamp {
          font-size: 0.7rem;
          color: var(--text-tertiary);
          opacity: 0;
          transform: translateY(4px);
          transition: opacity 0.18s ease, transform 0.18s ease;
        }

        .bubble.hovered .bubble-timestamp {
          opacity: 0.9;
          transform: translateY(0);
        }

        @media (max-width: 768px) {
          .bubble-timestamp {
            opacity: 0.8;
            transform: translateY(0);
          }
        }

        .bubble::after {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: calc(var(--radius-xl) + 2px);
          pointer-events: none;
          background: radial-gradient(circle at 20% 20%, rgba(51, 144, 236, 0.14), transparent 55%);
          opacity: 0;
          transition: opacity 0.2s ease, transform 0.2s ease;
        }

        .bubble.hovered {
          box-shadow: var(--shadow-lg), 0 0 0 1px rgba(0, 0, 0, 0.04);
          transform: translateY(-1px);
        }

        .bubble.hovered::after {
          opacity: 1;
          transform: scale(1.01);
        }

        .bubble.own {
          background-color: var(--message-own-bg);
          color: var(--message-own-text);
          border-bottom-right-radius: 4px;
          border-color: rgba(51, 144, 236, 0.16);
        }

        .bubble.other {
          background-color: var(--message-other-bg);
          color: var(--message-other-text);
          border-bottom-left-radius: 4px;
          border-color: rgba(0, 0, 0, 0.05);
        }

        .bubble.own.hovered {
          background-color: #e8ffd4;
          box-shadow: var(--shadow-lg), 0 4px 16px rgba(51, 144, 236, 0.15);
        }

        .bubble.other.hovered {
          background-color: #f8fafc;
          box-shadow: var(--shadow-lg), 0 4px 16px rgba(0, 0, 0, 0.08);
        }

        .reply-context {
          display: flex;
          align-items: stretch;
          gap: var(--spacing-xs);
          margin-bottom: 4px;
          font-size: 0.85rem;
          cursor: pointer;
          padding-left: 4px;
        }

        .reply-bar {
          width: 3px;
          background-color: var(--accent-primary);
          border-radius: 2px;
        }
        
        .reply-content-wrapper {
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .reply-author {
          font-weight: 600;
          color: var(--accent-primary);
          font-size: 0.8rem;
        }

        .reply-text {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 200px;
          color: var(--text-secondary);
        }

        .reactions-list {
          display: flex;
          gap: 4px;
          margin-top: 4px;
          flex-wrap: wrap;
        }

        .reaction-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          background: radial-gradient(circle at 20% 20%, rgba(51, 144, 236, 0.08), transparent 40%), rgba(255,255,255,0.9);
          border: 1px solid rgba(0, 0, 0, 0.04);
          border-radius: 999px;
          font-size: 0.75rem;
          color: var(--text-primary);
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease;
          box-shadow: 0 8px 18px rgba(0,0,0,0.08);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          position: relative;
          overflow: hidden;
        }

        .reaction-pill:hover {
          border-color: rgba(51, 144, 236, 0.2);
          box-shadow: 0 10px 22px rgba(51, 144, 236, 0.16);
        }

        .reaction-pill.active {
          background: linear-gradient(145deg, #3ea1ff, #2a77ff);
          border-color: rgba(255,255,255,0.35);
          color: #fff;
          box-shadow: 0 10px 24px rgba(62, 161, 255, 0.25);
        }

        .actions-group {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          background: linear-gradient(120deg, rgba(255,255,255,0.92), rgba(255,255,255,0.78));
          border: 1px solid rgba(255,255,255,0.5);
          border-radius: var(--radius-full);
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.14);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          position: absolute;
          top: -48px;
          z-index: 10;
          overflow: hidden;
        }

        .message-container.own .actions-group {
          right: 0;
          flex-direction: row-reverse;
        }

        .message-container.other .actions-group {
          left: 0;
        }

        .emoji-panel {
            display: flex;
            gap: 6px;
            padding-right: 10px;
            border-right: 1px solid rgba(0,0,0,0.05);
            position: relative;
        }
        
        .message-container.own .emoji-panel {
            padding-right: 0;
            padding-left: 10px;
            border-right: none;
            border-left: 1px solid rgba(0,0,0,0.05);
        }

        .emoji-panel::before {
          content: '';
          position: absolute;
          inset: -10px -6px;
          background: radial-gradient(circle at 20% 20%, rgba(51, 144, 236, 0.12), transparent 40%);
          filter: blur(12px);
          z-index: 0;
          pointer-events: none;
        }

        .actions-group .emoji-btn {
            position: relative;
            padding: 8px;
            border-radius: 14px;
            font-size: 1.15rem;
            transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1.4), box-shadow 0.2s ease, background-color 0.2s ease;
            background: rgba(255,255,255,0.8);
            border: 1px solid rgba(0,0,0,0.04);
            box-shadow: 0 6px 14px rgba(0,0,0,0.08);
            z-index: 1;
        }

        .actions-group .emoji-btn:hover {
            transform: translateY(-2px) scale(1.12);
            box-shadow: 0 10px 26px rgba(0, 0, 0, 0.12);
            background: #fff;
        }

        .actions-group .emoji-btn.active {
            box-shadow: 0 12px 28px rgba(51, 144, 236, 0.2);
            background: linear-gradient(145deg, #e6f3ff, #ffffff);
            border-color: rgba(51, 144, 236, 0.24);
        }

        .emoji-glow {
          position: absolute;
          inset: -6px;
          border-radius: 16px;
          background: radial-gradient(circle, rgba(51, 144, 236, 0.08), transparent 55%);
          opacity: 0;
          transition: opacity 0.2s ease;
          z-index: -1;
        }

        .actions-group .emoji-btn:hover .emoji-glow,
        .actions-group .emoji-btn.active .emoji-glow {
          opacity: 1;
        }

        .action-buttons {
            display: flex;
            gap: 2px;
        }

        .action-btn {
          padding: 6px;
          border-radius: 50%;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.2s;
        }

        .action-btn:hover {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }
      `}</style>
    </motion.div>
  );
};
