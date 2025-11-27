import React, { useState } from 'react';

import { Menu, Info, Hash, Users } from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { Sidebar } from './Sidebar';
import { AgentConfigPanel } from './AgentConfigPanel';
import { AboutModal } from './AboutModal';

interface LayoutProps {
  children: React.ReactNode;
}

import { useNetworkStatus } from '../hooks/useNetworkStatus';

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const isOnline = useNetworkStatus();
  const { state } = useChat();

  const onlineCount = state.users.filter(u => u.status === 'online').length;

  return (
    <div className="layout-container">
      {!isOnline && (
        <div className="offline-banner">
          You are currently offline. Changes may not be saved.
        </div>
      )}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onOpenAgentPanel={() => setIsAgentPanelOpen(true)}
      />

      {/* Main Content */}
      <main className="main-content">
        <div className="chat-header">
          <div className="chat-header-left">
            <button className="menu-btn mobile-only" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={22} />
            </button>
            <div className="chat-header-channel">
              <Hash size={18} className="channel-icon" />
              <span className="channel-name">general</span>
            </div>
            <div className="chat-header-meta">
              <Users size={14} />
              <span>{onlineCount} online</span>
            </div>
          </div>
          <div className="chat-header-right">
            <div className="chat-header-powered">
              Powered by <span className="parallax-text">Parallax</span>
            </div>
            <button className="info-btn" onClick={() => setIsAboutOpen(true)} title="About">
              <Info size={18} />
            </button>
          </div>
        </div>
        {children}
      </main>

      <AgentConfigPanel isOpen={isAgentPanelOpen} onClose={() => setIsAgentPanelOpen(false)} />
      <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />

      <style>{`
        .layout-container {
          display: flex;
          height: 100vh;
          width: 100vw;
          background-color: var(--bg-primary);
          overflow: hidden;
          position: relative;
        }

        .offline-banner {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          background-color: #ef4444;
          color: white;
          text-align: center;
          padding: 4px;
          font-size: 0.8rem;
          z-index: 100;
        }

        .main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          background-color: var(--bg-primary);
          position: relative;
          width: 100%; /* Ensure full width */
        }

        .chat-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 0 var(--spacing-md);
            height: 52px;
            border-bottom: 1px solid var(--border-light);
            background-color: var(--bg-primary);
        }

        .chat-header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .chat-header-channel {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .channel-icon {
            color: var(--text-tertiary);
        }

        .channel-name {
            font-weight: 700;
            font-size: 1.05rem;
            color: var(--text-primary);
        }

        .chat-header-meta {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            background: rgba(16, 185, 129, 0.1);
            border-radius: 999px;
            font-size: 0.75rem;
            color: #10b981;
        }

        .chat-header-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .chat-header-powered {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            background: linear-gradient(135deg, rgba(192, 132, 252, 0.1), rgba(124, 58, 237, 0.1));
            border-radius: 999px;
            font-size: 0.7rem;
            color: var(--text-secondary);
            border: 1px solid rgba(168, 85, 247, 0.15);
        }

        .parallax-text {
            font-weight: 700;
            background: linear-gradient(135deg, #c084fc, #a855f7, #7c3aed);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .menu-btn {
            color: var(--text-primary);
            padding: 6px;
            border-radius: 8px;
        }

        .menu-btn.mobile-only {
            display: none;
        }

        .info-btn {
            color: var(--text-secondary);
            padding: 6px;
            border-radius: 8px;
            transition: background-color 0.2s, color 0.2s;
        }

        .info-btn:hover {
            background-color: var(--bg-tertiary);
            color: var(--accent-primary);
        }

        @media (max-width: 768px) {
            .menu-btn.mobile-only {
                display: flex;
            }
            .chat-header-meta {
                display: none;
            }
            .chat-header-powered {
                padding: 4px 8px;
                font-size: 0.65rem;
            }
        }
      `}</style>
    </div>
  );
};
