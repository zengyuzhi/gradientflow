import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Agent } from '../../types/chat';
import './styles.css';

interface AgentSelectorProps {
    agents: Agent[];
    triggerRef: React.RefObject<HTMLButtonElement | null>;
    isOpen: boolean;
    onSelect: (agent: Agent) => void;
    onClose: () => void;
}

export const AgentSelector: React.FC<AgentSelectorProps> = React.memo(({
    agents,
    triggerRef,
    isOpen,
    onSelect,
    onClose,
}) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [position, setPosition] = useState({ top: 0, left: 0, alignRight: false });
    const dropdownRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    // Sort agents: active first, then by name
    const sortedAgents = useMemo(() => {
        return [...agents].sort((a, b) => {
            if (a.status === 'active' && b.status !== 'active') return -1;
            if (a.status !== 'active' && b.status === 'active') return 1;
            return a.name.localeCompare(b.name);
        });
    }, [agents]);

    const activeCount = useMemo(() => {
        return sortedAgents.filter(a => a.status === 'active').length;
    }, [sortedAgents]);

    // Find first active agent index for initial selection
    const firstActiveIndex = useMemo(() => {
        const idx = sortedAgents.findIndex(a => a.status === 'active');
        return idx >= 0 ? idx : 0;
    }, [sortedAgents]);

    // Reset active index when opening
    useEffect(() => {
        if (isOpen) {
            setActiveIndex(firstActiveIndex);
        }
    }, [isOpen, firstActiveIndex]);

    // Calculate position based on trigger button
    useEffect(() => {
        if (!isOpen || !triggerRef.current) return;

        const updatePosition = () => {
            const trigger = triggerRef.current;
            if (!trigger) return;

            const rect = trigger.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const dropdownWidth = 260;
            const dropdownHeight = 280;

            // Check if dropdown should align to right or left
            const alignRight = rect.left + dropdownWidth > viewportWidth - 16;

            // Position below the trigger button
            let top = rect.bottom + 8;
            let left = alignRight ? rect.right - dropdownWidth : rect.left;

            // Clamp within viewport
            left = Math.max(16, Math.min(left, viewportWidth - dropdownWidth - 16));

            // If too close to bottom, position above
            if (top + dropdownHeight > window.innerHeight - 16) {
                top = rect.top - dropdownHeight - 8;
            }

            setPosition({ top, left, alignRight });
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen, triggerRef]);

    // Handle click outside
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(target) &&
                triggerRef.current &&
                !triggerRef.current.contains(target)
            ) {
                onClose();
            }
        };

        // Use mousedown to close before click event propagates
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose, triggerRef]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen || sortedAgents.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActiveIndex(prev => (prev + 1) % sortedAgents.length);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActiveIndex(prev => (prev - 1 + sortedAgents.length) % sortedAgents.length);
                break;
            case 'Enter':
                e.preventDefault();
                if (activeIndex >= 0 && activeIndex < sortedAgents.length) {
                    const selectedAgent = sortedAgents[activeIndex];
                    if (selectedAgent && selectedAgent.status === 'active') {
                        onSelect(selectedAgent);
                    }
                }
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
        }
    }, [isOpen, sortedAgents, activeIndex, onSelect, onClose]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const handleAgentClick = (agent: Agent, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (agent.status === 'active') {
            onSelect(agent);
        }
    };

    if (typeof document === 'undefined' || sortedAgents.length === 0) return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    ref={dropdownRef}
                    className="agent-selector-dropdown"
                    style={{ top: position.top, left: position.left }}
                    initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -4 }}
                    transition={prefersReducedMotion
                        ? { duration: 0.15 }
                        : { type: 'spring', stiffness: 500, damping: 30, mass: 0.8 }
                    }
                >
                    <div className="agent-selector-header">
                        <div className="agent-selector-header-text">
                            <div className="agent-selector-title">选择 AI Agent</div>
                            <div className="agent-selector-subtitle">{activeCount} 位在线 · {sortedAgents.length} 个可用</div>
                        </div>
                        <span className="agent-selector-count">{activeCount}/{sortedAgents.length}</span>
                    </div>
                    <div className="agent-selector-list">
                        {sortedAgents.map((agent, index) => {
                            const isActive = agent.status === 'active';
                            const avatar = agent.avatar || agent.user?.avatar || '';

                            return (
                                <button
                                    key={agent.id}
                                    className={clsx(
                                        'agent-selector-item',
                                        index === activeIndex && 'active',
                                        !isActive && 'inactive'
                                    )}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onMouseDown={(e) => handleAgentClick(agent, e)}
                                    disabled={!isActive}
                                >
                                    <div className="agent-selector-avatar-wrapper">
                                        <img
                                            src={avatar}
                                            alt={agent.name}
                                            className="agent-selector-avatar"
                                        />
                                        <span className={clsx('agent-selector-status', isActive ? 'online' : 'offline')} />
                                    </div>
                                    <div className="agent-selector-info">
                                        <div className="agent-selector-name">
                                            {agent.name}
                                            {!isActive && (
                                                <span className="agent-selector-offline">离线</span>
                                            )}
                                        </div>
                                        <div className="agent-selector-model" title={agent.model?.name || 'Unknown Model'}>
                                            {agent.model?.name || 'Unknown Model'}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
});
