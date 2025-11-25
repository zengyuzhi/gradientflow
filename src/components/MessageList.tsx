import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { MessageBubble } from './MessageBubble';
import { DateSeparator, shouldShowDateSeparator } from './DateSeparator';
import { AnimatePresence, motion } from 'framer-motion';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';

export const MessageList: React.FC = () => {
  const { state } = useChat();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const currentUserId = state.currentUser?.id;
  const typingUsers = state.typingUsers
    .map(id => state.users.find(u => u.id === id))
    .filter((user): user is NonNullable<typeof user> => Boolean(user));
  const typingNames = typingUsers.map(user => (user.id === currentUserId ? 'You' : user.name));
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(state.messages.length);

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    if (state.messages.length === 0) return;
    const scroll = () => {
      virtuosoRef.current?.scrollToIndex({
        index: state.messages.length - 1,
        behavior,
        align: 'end',
        offset: 8,
      });
      virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior });
    };
    scroll();
    setTimeout(scroll, 20);
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    setUnseenCount(0);
  }, [state.messages.length]);

  useEffect(() => {
    const previousCount = prevMessageCountRef.current;
    if (state.messages.length === 0) {
      prevMessageCountRef.current = 0;
      return;
    }

    if (state.messages.length < previousCount && isAtBottomRef.current) {
      scrollToBottom('auto');
    }

    prevMessageCountRef.current = state.messages.length;
  }, [scrollToBottom, state.messages.length]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom('auto');
    }
  }, [scrollToBottom, typingUsers.length]);

  const buildTypingText = () => {
    if (typingNames.length === 0) return '';
    if (typingNames.length === 1) {
      return typingNames[0] === 'You' ? 'You are typing' : `${typingNames[0]} is typing`;
    }
    if (typingNames.length === 2) return `${typingNames[0]} and ${typingNames[1]} are typing`;
    const others = typingNames.length - 2;
    return `${typingNames[0]}, ${typingNames[1]} and ${others} more are typing`;
  };

  const typingText = buildTypingText();

  return (
    <div className="message-list">
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%' }}
        data={state.messages}
        initialTopMostItemIndex={Math.max(0, state.messages.length - 1)}
        followOutput={'auto'}
        atBottomThreshold={64}
        atBottomStateChange={(atBottom) => {
          isAtBottomRef.current = atBottom;
          setShowScrollButton(!atBottom);
          if (atBottom) setUnseenCount(0);
        }}
        itemContent={(index, message) => {
          const isOwnMessage = message.senderId === currentUserId;
          const prevMessage = state.messages[index - 1];
          const showAvatar = !prevMessage || prevMessage.senderId !== message.senderId;
          const showDateSep = shouldShowDateSeparator(message, prevMessage);

          return (
            <div className="message-wrapper">
              {showDateSep && <DateSeparator timestamp={message.timestamp} />}
              <MessageBubble
                message={message}
                isOwnMessage={isOwnMessage}
                showAvatar={showAvatar}
              />
            </div>
          );
        }}
        components={{
          Footer: () => <div style={{ height: '20px' }} /> // Spacing at bottom
        }}
      />

      <AnimatePresence>
        {typingUsers.length > 0 && (
          <motion.div
            className="typing-indicator"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <div className="typing-card" aria-live="polite">
              <div className="typing-avatars" aria-hidden="true">
                {typingUsers.slice(0, 3).map((user, idx) => (
                  <img
                    key={user.id}
                    src={user.avatar}
                    alt=""
                    className="typing-avatar"
                    style={{ zIndex: typingUsers.length - idx }}
                  />
                ))}
                {typingUsers.length > 3 && (
                  <span className="typing-extra">+{typingUsers.length - 3}</span>
                )}
              </div>
              <div className="typing-copy">
                <span className="typing-text">{typingText}</span>
                <span className="typing-dots" aria-hidden="true">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showScrollButton && (
          <div className="scroll-btn-container">
            <motion.button
              className="scroll-bottom-btn"
              initial={{ opacity: 0, scale: 0.6, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.6, y: 20 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              whileHover={{ scale: 1.1, y: -2 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => scrollToBottom()}
              aria-label="Scroll to bottom"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
              {unseenCount > 0 && (
                <span className="scroll-btn-badge" aria-label={`${unseenCount} new messages`}>
                  {unseenCount > 99 ? '99+' : unseenCount}
                </span>
              )}
            </motion.button>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .message-list {
          flex: 1;
          display: flex;
          flex-direction: column;
          background-color: var(--bg-primary);
          position: relative;
          height: 100%; /* Important for Virtuoso */
        }

        .message-wrapper {
            padding: 0 var(--content-gutter);
            max-width: var(--content-max-width);
            margin: 0 auto;
            width: 100%;
            box-sizing: border-box;
        }

        .message-list::before,
        .message-list::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          height: 12px;
          pointer-events: none;
          z-index: 5;
        }

        .message-list::before {
          top: 0;
          background: linear-gradient(180deg, rgba(var(--bg-secondary-rgb), 0.9), rgba(var(--bg-secondary-rgb), 0));
        }

        .message-list::after {
          bottom: 0;
          background: linear-gradient(0deg, rgba(var(--bg-secondary-rgb), 0.6), rgba(var(--bg-secondary-rgb), 0));
        }

        .typing-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 var(--content-gutter);
          position: absolute;
          bottom: 20px;
          left: 0;
          right: 0;
          z-index: 10;
          pointer-events: none;
          box-sizing: border-box;
        }

        .typing-card {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: rgba(var(--bg-secondary-rgb), 0.85);
          border-radius: 20px;
          border: 1px solid var(--border-light);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          pointer-events: auto;
          width: fit-content;
          max-width: min(100%, var(--content-max-width));
          transition: all 0.2s ease;
        }

        .typing-avatars {
          display: flex;
          align-items: center;
        }

        .typing-avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid var(--bg-primary);
          box-shadow: var(--shadow-sm);
          object-fit: cover;
          background: var(--bg-secondary);
        }

        .typing-avatar:not(:first-child),
        .typing-extra {
          margin-left: -8px;
        }

        .typing-extra {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid var(--bg-primary);
          background: var(--bg-secondary);
          color: var(--text-secondary);
          font-weight: 600;
          font-size: 0.65rem;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--shadow-sm);
        }

        .typing-copy {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          color: var(--text-secondary);
          font-size: 0.85rem;
        }

        .typing-text {
          white-space: nowrap;
          font-weight: 500;
          color: var(--text-primary);
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .typing-dots {
          display: inline-flex;
          gap: 3px;
          padding-top: 2px;
        }

        .dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background-color: var(--text-secondary);
        }

        @media (prefers-reduced-motion: no-preference) {
          .dot {
            animation: typingPulse 1.3s infinite ease-in-out both;
          }

          .dot:nth-child(1) { animation-delay: 0s; }
          .dot:nth-child(2) { animation-delay: 0.18s; }
          .dot:nth-child(3) { animation-delay: 0.36s; }

          @keyframes typingPulse {
            0%, 100% { opacity: 0.4; transform: scale(0.86); }
            50% { opacity: 1; transform: scale(1.14); }
          }
        }

        .scroll-btn-container {
          position: absolute;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          justify-content: center;
          height: 0;
          overflow: visible;
          z-index: 50;
          pointer-events: none;
        }

        .scroll-bottom-btn {
          pointer-events: auto;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.3)),
            linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
          border: 1px solid rgba(255,255,255,0.6);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #0b4f80;
          cursor: pointer;
          position: relative;
          transition: all 0.22s cubic-bezier(0.25, 0.8, 0.25, 1);
          overflow: hidden;
          z-index: 1;
        }

        .scroll-bottom-btn::after {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(79, 172, 254, 0.25), transparent 65%);
          opacity: 0;
          transition: opacity 0.25s ease;
          z-index: 0;
        }

        .scroll-bottom-btn:hover {
          color: white;
          box-shadow: 0 10px 26px rgba(51, 144, 236, 0.38);
          transform: translateY(-4px);
        }

        .scroll-bottom-btn:hover::after {
          opacity: 1;
        }

        .scroll-btn-badge {
          position: absolute;
          top: -5px;
          right: -5px;
          min-width: 18px;
          height: 18px;
          padding: 0 4px;
          border-radius: 9px;
          background: linear-gradient(140deg, #ff758c, #ff7eb3);
          color: white;
          font-weight: 700;
          font-size: 0.7rem;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          border: 2px solid var(--bg-primary);
        }

        .scroll-bottom-btn svg {
          position: relative;
          z-index: 1;
        }

        @media (prefers-reduced-motion: no-preference) {
          .scroll-bottom-btn {
            animation: scrollPulse 3s ease-in-out infinite;
          }

          @keyframes scrollPulse {
            0%, 100% { box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15); transform: scale(1); }
            50% { box-shadow: 0 12px 26px rgba(51, 144, 236, 0.24); transform: scale(1.04); }
          }
        }
      `}</style>
    </div>
  );
};
