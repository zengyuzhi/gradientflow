import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { Bot } from 'lucide-react';
import { Reaction, User } from '../../types/chat';
import './styles.css';

interface ReactionListProps {
    reactions: Reaction[];
    onReact: (emoji: string) => void;
    hasReacted: (emoji: string) => boolean;
    users?: User[];
}

export const ReactionList: React.FC<ReactionListProps> = React.memo(({
    reactions,
    onReact,
    hasReacted,
    users = [],
}) => {
    // 获取所有 agent 用户的 ID
    const agentUserIds = useMemo(() => {
        return new Set(users.filter(u => u.type === 'agent').map(u => u.id));
    }, [users]);

    // 检查反应是否包含 agent
    const hasAgentReacted = (reaction: Reaction) => {
        return reaction.userIds.some(id => agentUserIds.has(id));
    };

    // 获取反应的 agent 名称
    const getAgentNames = (reaction: Reaction) => {
        return reaction.userIds
            .filter(id => agentUserIds.has(id))
            .map(id => users.find(u => u.id === id)?.name || 'AI')
            .join(', ');
    };

    if (reactions.length === 0) return null;

    return (
        <div className="reactions-list">
            <AnimatePresence>
                {reactions.map((reaction) => {
                    const active = hasReacted(reaction.emoji);
                    const isAgentReaction = hasAgentReacted(reaction);
                    const agentNames = isAgentReaction ? getAgentNames(reaction) : '';
                    const title = isAgentReaction
                        ? `${reaction.count} reacted with ${reaction.emoji} (AI: ${agentNames})`
                        : `${reaction.count} reacted with ${reaction.emoji}`;
                    return (
                        <motion.button
                            key={reaction.emoji}
                            className={clsx('reaction-pill', active && 'active', isAgentReaction && 'agent-reaction')}
                            onClick={() => onReact(reaction.emoji)}
                            initial={{ opacity: 0, y: 6, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.9 }}
                            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                            whileHover={{ y: -2, scale: 1.06 }}
                            whileTap={{ scale: 0.94 }}
                            title={title}
                        >
                            <span>{reaction.emoji}</span>
                            <span className="count">{reaction.count}</span>
                            {isAgentReaction && <Bot size={10} className="agent-icon" />}
                        </motion.button>
                    );
                })}
            </AnimatePresence>
        </div>
    );
});
