import React from 'react';
import { Reply, Trash2, Bot } from 'lucide-react';
import './styles.css';

interface ActionButtonsProps {
    onReply: () => void;
    onDelete?: () => void;
    onAskAI?: () => void;
    isOwnMessage: boolean;
    showAskAI?: boolean;
}

export const ActionButtons: React.FC<ActionButtonsProps> = React.memo(({
    onReply,
    onDelete,
    onAskAI,
    isOwnMessage,
    showAskAI = true,
}) => {
    return (
        <div className="action-buttons">
            <button className="action-btn" onClick={onReply} title="Reply">
                <Reply size={16} />
            </button>
            {showAskAI && onAskAI && (
                <button className="action-btn ask-ai-btn" onClick={onAskAI} title="Ask AI">
                    <Bot size={16} />
                </button>
            )}
            {isOwnMessage && onDelete && (
                <button className="action-btn delete-btn" onClick={onDelete} title="Delete">
                    <Trash2 size={16} />
                </button>
            )}
        </div>
    );
});
