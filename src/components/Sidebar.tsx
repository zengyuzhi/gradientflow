import React, { useState, useMemo } from 'react';
import { useChat } from '../context/ChatContext';
import { Hash, Settings, Mic, Headphones, Search, Plus, X, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { api } from '../api/client';
import { User } from '../types/chat';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenAgentPanel: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onOpenAgentPanel }) => {
    const { state, dispatch } = useChat();
    const [activeChannel, setActiveChannel] = useState('general');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);
    if (!state.currentUser) return null;

    const trimmedQuery = searchQuery.trim().toLowerCase();

    // Memoize filtered users to prevent recalculation on every render
    const filteredUsers = useMemo(() => {
        return state.users.filter(user => user.name.toLowerCase().includes(trimmedQuery));
    }, [state.users, trimmedQuery]);

    const displayedUsers = trimmedQuery ? filteredUsers : state.users;
    const statusOrder: Array<User['status']> = ['online', 'busy', 'offline'];
    const statusLabels: Record<User['status'], string> = {
        online: '在线',
        busy: '忙碌',
        offline: '离线',
    };
    const groupedMembers = React.useMemo(() => {
        const grouped = new Map<User['status'] | 'other', User[]>();
        displayedUsers.forEach(user => {
            const status = statusOrder.includes(user.status) ? user.status : 'other';
            if (!grouped.has(status)) grouped.set(status, []);
            grouped.get(status)!.push(user);
        });

        const ordered: { status: User['status'] | 'other'; users: User[] }[] = [];
        statusOrder.forEach(status => {
            if (grouped.has(status)) ordered.push({ status, users: grouped.get(status)! });
        });
        if (grouped.has('other')) ordered.push({ status: 'other', users: grouped.get('other')! });
        return ordered;
    }, [displayedUsers]);

    const memberCountLabel = trimmedQuery
        ? `${filteredUsers.length}/${state.users.length}`
        : state.users.length;

    const handleLogout = async () => {
        try {
            await api.auth.logout();
        } catch (err) {
            console.error('Logout failed', err);
        } finally {
            dispatch({ type: 'LOGOUT' });
        }
    };

    return (
        <>
            {/* Mobile Overlay */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="sidebar-overlay"
                        onClick={onClose}
                    />
                )}
            </AnimatePresence>

            <aside className={clsx('sidebar', isOpen && 'open')}>
                <div className="sidebar-header">
                    <div className="logo">
                        <div className="logo-icon">
                            <img src="/gradient_flow_logo.png" alt="GradientFlow" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px' }} />
                        </div>
                        <div className="logo-text">
                            <span className="logo-title">GradientFlow</span>
                            <span className="logo-subtitle">
                                Powered By <img src="/parallax.png" alt="Parallax" className="logo-parallax-img" />
                            </span>
                        </div>
                    </div>
                    <button className="close-sidebar-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="sidebar-search">
                    <div className={clsx('search-input-wrapper', searchFocused && 'focused')}>
                        <Search size={16} className="search-icon" />
                        <input
                            type="text"
                            placeholder="搜索成员"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setSearchFocused(false)}
                        />
                        {searchQuery && (
                            <button className="clear-search" onClick={() => setSearchQuery('')} aria-label="清除搜索">
                                <X size={12} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="sidebar-content">
                    <div className="sidebar-section">
                        <div className="section-header">
                            <h3 className="section-title">频道</h3>
                            <button className="add-btn">
                                <Plus size={14} />
                            </button>
                        </div>
                        {['general', 'random', 'intros'].map(channel => (
                            <motion.div
                                key={channel}
                                className={clsx('nav-item', activeChannel === channel && 'active')}
                                onClick={() => setActiveChannel(channel)}
                                whileHover={{ x: 6 }}
                                transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                            >
                                <Hash size={18} className="nav-icon" />
                                <span>{channel}</span>
                            </motion.div>
                        ))}
                    </div>

                    <div className="sidebar-section agent-section">
                        <div className="section-header">
                            <h3 className="section-title">LLM Agents · {state.agents.length}</h3>
                            <button className="manage-btn" onClick={onOpenAgentPanel}>
                                <Settings size={14} />
                                <span>管理</span>
                            </button>
                        </div>
                        <div className="agent-list">
                            {state.agents.length === 0 ? (
                                <div className="agent-empty">未配置 Agent</div>
                            ) : (
                                state.agents.map(agent => (
                                    <button key={agent.id} className="agent-card" onClick={onOpenAgentPanel}>
                                        <div className="avatar-wrapper small">
                                            <img
                                                src={
                                                    agent.avatar ||
                                                    agent.user?.avatar ||
                                                    `https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`
                                                }
                                                alt={agent.name}
                                            />
                                            <span className={clsx('status-indicator', agent.status === 'inactive' ? 'offline' : 'online')} />
                                        </div>
                                        <div className="agent-info">
                                            <span className="agent-name">{agent.name}</span>
                                            <span className="agent-model">{agent.model?.name || agent.runtime?.type || '自定义运行时'}</span>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="sidebar-section">
                        <h3 className="section-title">成员 · {memberCountLabel}</h3>
                        <div className="member-list">
                            {displayedUsers.length === 0 ? (
                                <div className="member-empty">未找到成员</div>
                            ) : (
                                groupedMembers.map(group => (
                                    <div key={group.status} className="member-group">
                                        <div className="member-group-header">
                                            <span className="member-group-title">
                                                {group.status === 'other'
                                                    ? '其他'
                                                    : statusLabels[group.status as User['status']]}
                                            </span>
                                            <span className="member-group-count">{group.users.length}</span>
                                        </div>
                                        {group.users.map(user => (
                                            <motion.div
                                                key={user.id}
                                                className="member-item"
                                                whileHover={{ backgroundColor: 'var(--bg-tertiary)', x: 4 }}
                                            >
                                                <div className="avatar-wrapper small">
                                                    <img src={user.avatar} alt={user.name} />
                                                    <motion.span
                                                        layoutId={`${user.id}-status`}
                                                        className={`status-indicator ${user.status}`}
                                                        animate={{ scale: 1 }}
                                                        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                                                    />
                                                </div>
                                                <div className="member-info">
                                                    <span className={clsx('member-name', user.isLLM && 'is-llm')}>
                                                        {user.name}
                                                        {user.isLLM && <span className="bot-tag">BOT</span>}
                                                    </span>
                                                    <span className="member-status-text">{user.status}</span>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className="sidebar-footer">
                    <motion.div
                        className="user-card"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        <div className="avatar-wrapper">
                            <img src={state.currentUser.avatar} alt="Profile" className="avatar-small" />
                            <span className="status-indicator online" />
                        </div>
                        <div className="user-info">
                            <span className="name">{state.currentUser.name}</span>
                            <span className="status">#8834</span>
                        </div>
                        <div className="user-actions">
                            <button className="icon-btn-small"><Mic size={14} /></button>
                            <button className="icon-btn-small"><Headphones size={14} /></button>

                            <button className="icon-btn-small logout-btn" onClick={handleLogout} title="退出登录">
                                <LogOut size={14} />
                            </button>
                        </div>
                    </motion.div>
                </div>
            </aside>

            <style>{`
        .sidebar {
          width: 280px;
          /* High contrast frosted glass */
          background-color: var(--bg-glass);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-right: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          z-index: 50;
          height: 100%;
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .sidebar-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(15, 23, 42, 0.5);
            backdrop-filter: blur(4px);
            z-index: 40;
            display: none;
        }

        .sidebar-header {
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          border-bottom: 1px solid var(--border-light);
          background-color: rgba(255, 255, 255, 0.5);
        }

        .close-sidebar-btn {
            display: none;
            color: var(--text-secondary);
            padding: 4px;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .logo-icon {
          width: 36px;
          height: 36px;
          background: var(--accent-gradient);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.25);
          transition: transform 0.3s ease;
        }
        
        .logo-icon:hover {
          transform: rotate(12deg) scale(1.05);
        }
        
        .logo-text {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        
        .logo-title {
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.2;
          letter-spacing: -0.02em;
        }

        .logo-subtitle {
          font-size: 0.65rem;
          color: var(--text-tertiary);
          line-height: 1;
          display: flex;
          align-items: center;
          gap: 4px;
          font-weight: 500;
        }

        .logo-parallax-img {
          height: 14px;
          width: auto;
          object-fit: contain;
          opacity: 0.6;
          filter: grayscale(100%);
          transition: all 0.2s;
        }
        
        .logo:hover .logo-parallax-img {
            filter: none;
            opacity: 1;
        }

        .text-white { color: white; }

        .sidebar-search {
            padding: 20px 20px 0;
        }

        .search-input-wrapper {
            background-color: #ffffff;
            border: 1px solid var(--border-light);
            border-radius: var(--radius-lg);
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: all 0.2s ease;
            box-shadow: var(--shadow-sm);
        }

        .search-input-wrapper.focused {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 2px var(--accent-light);
        }

        .search-icon {
            color: var(--text-tertiary);
        }

        .search-input-wrapper input {
            background: transparent;
            border: none;
            outline: none;
            width: 100%;
            font-size: 0.85rem;
            color: var(--text-primary);
        }

        .search-input-wrapper input::placeholder {
            color: var(--text-tertiary);
        }

        .clear-search {
            border: none;
            background: rgba(0, 0, 0, 0.04);
            border-radius: 999px;
            padding: 3px;
            display: flex;
            color: var(--text-tertiary);
            cursor: pointer;
        }
        
        .clear-search:hover {
            background: rgba(0, 0, 0, 0.1);
            color: var(--text-primary);
        }

        .sidebar-content {
            flex: 1;
            overflow-y: auto;
            padding: 24px 20px;
            display: flex;
            flex-direction: column;
            gap: 32px;
        }

        .sidebar-section {
            display: flex;
            flex-direction: column;
        }

        .agent-section {
            gap: 8px;
        }

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
            padding: 0 4px;
        }

        .section-title {
          font-size: 0.65rem;
          text-transform: uppercase;
          color: var(--text-tertiary);
          font-weight: 700;
          letter-spacing: 0.08em;
          margin: 0;
        }

        .add-btn {
            color: var(--text-tertiary);
            transition: color 0.2s;
            padding: 4px;
            border-radius: 4px;
        }
        
        .add-btn:hover {
            color: var(--accent-primary);
            background: var(--accent-light);
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          cursor: pointer;
          margin-bottom: 2px;
          font-size: 0.9rem;
          font-weight: 500;
          transition: all 0.2s;
        }
        
        .nav-item:hover {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }

        .nav-item.active {
          background: var(--accent-light);
          color: var(--accent-primary);
          font-weight: 600;
        }

        .nav-icon {
            opacity: 0.8;
            transition: opacity 0.2s;
        }
        
        .nav-item.active .nav-icon {
            opacity: 1;
        }

        .member-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .member-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .member-group-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 8px;
            margin-bottom: 4px;
        }

        .member-group-title {
            color: var(--text-tertiary);
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 600;
        }

        .member-group-count {
            font-size: 0.6rem;
            background: var(--bg-tertiary);
            padding: 1px 6px;
            border-radius: 999px;
            color: var(--text-tertiary);
            font-weight: 600;
        }

        .member-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          cursor: pointer;
          transition: background 0.15s;
        }
        
        .member-item:hover {
            background: var(--bg-tertiary);
        }

        .member-empty {
            padding: 16px;
            border-radius: var(--radius-md);
            background-color: var(--bg-tertiary);
            color: var(--text-tertiary);
            text-align: center;
            font-size: 0.8rem;
            border: 1px dashed var(--border-medium);
        }

        .avatar-wrapper {
          position: relative;
          width: 36px;
          height: 36px;
        }
        
        .avatar-wrapper.small {
            width: 32px;
            height: 32px;
        }

        .avatar-wrapper img {
          width: 100%;
          height: 100%;
          border-radius: var(--radius-full);
          object-fit: cover;
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--bg-tertiary);
        }

        .status-indicator {
          position: absolute;
          bottom: 0px;
          right: 0px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid #ffffff;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.05);
        }

        .status-indicator.online { background-color: var(--success-primary); }
        .status-indicator.busy { background-color: var(--error-primary); }
        .status-indicator.offline { background-color: #cbd5e1; }

        .member-info {
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-width: 0;
        }

        .manage-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 999px;
            border: 1px solid var(--border-medium);
            color: var(--text-secondary);
            font-size: 0.65rem;
            background: transparent;
            transition: all 0.2s;
        }

        .manage-btn:hover {
            color: var(--accent-primary);
            border-color: var(--accent-primary);
            background-color: var(--bg-tertiary);
        }

        .agent-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .agent-card {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px;
            border-radius: var(--radius-lg);
            border: 1px solid var(--border-light);
            background-color: #ffffff;
            text-align: left;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: var(--shadow-sm);
        }

        .agent-card:hover {
            border-color: var(--accent-primary);
            box-shadow: var(--shadow-md);
            transform: translateY(-1px);
        }

        .agent-card .status-indicator {
            border-color: #ffffff;
        }

        .agent-info {
            display: flex;
            flex-direction: column;
            gap: 1px;
            min-width: 0;
        }

        .agent-name {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-primary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .agent-model {
            font-size: 0.65rem;
            color: var(--text-tertiary);
            background: var(--bg-tertiary);
            padding: 1px 6px;
            border-radius: 4px;
            width: fit-content;
        }

        .agent-empty {
            padding: 16px;
            border-radius: var(--radius-md);
            border: 1px dashed var(--border-medium);
            color: var(--text-tertiary);
            font-size: 0.8rem;
            text-align: center;
            background: var(--bg-tertiary);
        }

        .member-name {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .member-name.is-llm {
            color: var(--accent-primary);
        }

        .member-status-text {
            font-size: 0.7rem;
            color: var(--text-tertiary);
        }

        .bot-tag {
          font-size: 0.55rem;
          background-color: var(--accent-primary);
          color: white;
          padding: 1px 4px;
          border-radius: 3px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .sidebar-footer {
          padding: 16px;
          background-color: rgba(255, 255, 255, 0.5);
          border-top: 1px solid var(--border-light);
        }

        .user-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          background-color: #ffffff;
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          cursor: pointer;
        }
        
        .user-card:hover {
            box-shadow: var(--shadow-md);
            border-color: var(--border-medium);
        }
        
        .avatar-small {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
        }

        .user-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .user-info .name {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .user-info .status {
          font-size: 0.7rem;
          color: var(--text-tertiary);
        }

        .user-actions {
            display: flex;
            gap: 2px;
        }

        .icon-btn-small {
            padding: 6px;
            border-radius: 6px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            background: transparent;
        }

        .icon-btn-small:hover {
            background-color: var(--bg-tertiary);
            color: var(--text-primary);
        }

        .logout-btn {
            color: #ef4444;
        }

        .logout-btn:hover {
            background-color: #fef2f2;
            color: #b91c1c;
        }

        /* Mobile Responsive Styles */
        @media (max-width: 768px) {
            .sidebar {
                position: fixed;
                top: 0;
                left: 0;
                bottom: 0;
                transform: translateX(-100%);
                box-shadow: var(--shadow-xl);
                max-width: 85%;
                background-color: #ffffff; 
            }

            .sidebar.open {
                transform: translateX(0);
            }

            .sidebar-overlay {
                display: block;
            }

            .close-sidebar-btn {
                display: block;
            }
        }
      `}</style>
        </>
    );
};
