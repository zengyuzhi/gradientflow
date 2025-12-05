import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { UI_CONFIG } from '../../constants/ui';
import './styles.css';

interface ReactionPanelProps {
    onReact: (emoji: string) => void;
    hasReacted: (emoji: string) => boolean;
    shouldUseComplexAnimations: boolean;
}

export const ReactionPanel: React.FC<ReactionPanelProps> = React.memo(({
    onReact,
    hasReacted,
    shouldUseComplexAnimations,
}) => {
    return (
        <div className="emoji-panel">
            {UI_CONFIG.REACTION_OPTIONS.map((emoji, index) => (
                <motion.button
                    key={emoji}
                    className={clsx('emoji-btn', hasReacted(emoji) && 'active')}
                    onClick={() => onReact(emoji)}
                    initial={shouldUseComplexAnimations ? { opacity: 0, scale: 0.5, y: 10 } : { opacity: 0 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={shouldUseComplexAnimations ? {
                        type: 'spring',
                        stiffness: 600,
                        damping: 20,
                        mass: 0.5,
                        delay: index * 0.01
                    } : { duration: 0.08 }}
                    whileHover={shouldUseComplexAnimations ? { scale: 1.25, rotate: -8, transition: { type: 'spring', stiffness: 400, damping: 15 } } : { scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    title={`React with ${emoji}`}
                >
                    {emoji}
                    {shouldUseComplexAnimations && <span className="emoji-glow" aria-hidden="true" />}
                </motion.button>
            ))}
        </div>
    );
});
