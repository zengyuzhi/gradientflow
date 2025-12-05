import React, { useRef, useState } from 'react';
import { Reply, Trash2, Bot, ChevronDown } from 'lucide-react';
import { Agent } from '../../types/chat';
import { AgentSelector } from './AgentSelector';
import './styles.css';

interface ActionButtonsProps {
    onReply: () => void;
    onDelete?: () => void;
    onAskAI?: (agent: Agent) => void;
    isOwnMessage: boolean;
    showAskAI?: boolean;
    agents?: Agent[];
    onAgentSelectorOpen?: (isOpen: boolean) => void;
}

export const ActionButtons: React.FC<ActionButtonsProps> = React.memo(({
    onReply,
    onDelete,
    onAskAI,
    isOwnMessage,
    showAskAI = true,
    agents = [],
    onAgentSelectorOpen,
}) => {
    const [showAgentSelector, setShowAgentSelector] = useState(false);
    const askAIButtonRef = useRef<HTMLButtonElement>(null);

    const updateSelectorState = (isOpen: boolean) => {
        setShowAgentSelector(isOpen);
        onAgentSelectorOpen?.(isOpen);
    };

    const handleAgentSelect = (agent: Agent) => {
        updateSelectorState(false);
        onAskAI?.(agent);
    };

    const handleAskAIClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        updateSelectorState(!showAgentSelector);
    };

    const handleClose = () => {
        updateSelectorState(false);
    };

    return (
        <>
            <button className="action-btn" onClick={onReply} title="回复">
                <Reply size={16} />
            </button>
            {showAskAI && onAskAI && agents.length > 0 && (
                <>
                    <button
                        ref={askAIButtonRef}
                        className="action-btn ask-ai-btn"
                        onClick={handleAskAIClick}
                        title="Ask AI"
                    >
                        <Bot size={16} />
                        <ChevronDown size={10} style={{ marginLeft: -2 }} />
                    </button>
                    <AgentSelector
                        agents={agents}
                        triggerRef={askAIButtonRef}
                        isOpen={showAgentSelector}
                        onSelect={handleAgentSelect}
                        onClose={handleClose}
                    />
                </>
            )}
            {isOwnMessage && onDelete && (
                <button className="action-btn delete-btn" onClick={onDelete} title="删除">
                    <Trash2 size={16} />
                </button>
            )}
        </>
    );
});
