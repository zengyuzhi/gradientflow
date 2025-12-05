import React from 'react';
import { X, Shield, Check, Server, Database, Search, Globe, DollarSign, Lock } from 'lucide-react';

interface PrivacyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PrivacyItem {
  label: string;
  value: string;
  status: 'local' | 'private' | 'none';
  icon: React.ReactNode;
}

export const PrivacyPanel: React.FC<PrivacyPanelProps> = ({ isOpen, onClose }) => {
  const privacyItems: PrivacyItem[] = [
    {
      label: 'LLM 推理',
      value: 'Parallax 本地节点',
      status: 'local',
      icon: <Server size={16} />,
    },
    {
      label: '数据存储',
      value: '本地数据库',
      status: 'local',
      icon: <Database size={16} />,
    },
    {
      label: 'RAG 向量库',
      value: 'ChromaDB 本地',
      status: 'local',
      icon: <Database size={16} />,
    },
    {
      label: '网络搜索',
      value: 'DuckDuckGo (隐私优先)',
      status: 'private',
      icon: <Search size={16} />,
    },
    {
      label: '外部 API 调用',
      value: '无',
      status: 'none',
      icon: <Globe size={16} />,
    },
  ];

  // Mock stats - in real implementation, these would come from context/API
  const stats = {
    messagesProcessed: 142,
    estimatedCloudCost: 2.84,
    actualCost: 0,
  };

  const getStatusColor = (status: PrivacyItem['status']) => {
    switch (status) {
      case 'local':
        return '#10b981'; // green
      case 'private':
        return '#10b981'; // green
      case 'none':
        return '#10b981'; // green (none is good for external APIs)
      default:
        return '#6b7280';
    }
  };

  const getStatusBadge = (status: PrivacyItem['status']) => {
    switch (status) {
      case 'local':
        return '本地';
      case 'private':
        return '隐私';
      case 'none':
        return '安全';
      default:
        return '';
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`privacy-panel-backdrop${isOpen ? ' open' : ''}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`privacy-panel${isOpen ? ' open' : ''}`}>
        {/* Header */}
        <div className="privacy-panel-header">
          <div className="privacy-panel-title">
            <Shield size={20} />
            <span>隐私审计</span>
          </div>
          <button className="privacy-panel-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="privacy-panel-content">
          {/* Status Banner */}
          <div className="privacy-status-banner">
          <div className="privacy-status-icon">
            <Shield size={24} />
          </div>
          <div className="privacy-status-info">
            <span className="privacy-status-label">当前状态</span>
            <span className="privacy-status-value">全部本地运行</span>
          </div>
          <div className="privacy-status-badge">
            <Check size={14} />
            <span>安全</span>
          </div>
        </div>

        {/* Privacy Items */}
        <div className="privacy-section">
          <div className="privacy-section-title">数据流向</div>
          <div className="privacy-items">
            {privacyItems.map((item, index) => (
              <div key={index} className="privacy-item">
                <div className="privacy-item-left">
                  <div className="privacy-item-icon" style={{ color: getStatusColor(item.status) }}>
                    {item.icon}
                  </div>
                  <div className="privacy-item-info">
                    <span className="privacy-item-label">{item.label}</span>
                    <span className="privacy-item-value">{item.value}</span>
                  </div>
                </div>
                <div
                  className="privacy-item-badge"
                  style={{ backgroundColor: `${getStatusColor(item.status)}15`, color: getStatusColor(item.status) }}
                >
                  <Check size={12} />
                  <span>{getStatusBadge(item.status)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cost Savings */}
        <div className="privacy-section">
          <div className="privacy-section-title">
            <DollarSign size={16} />
            <span>成本节省</span>
          </div>
          <div className="privacy-cost-card">
            <div className="privacy-cost-row">
              <span className="privacy-cost-label">已处理消息</span>
              <span className="privacy-cost-value">{stats.messagesProcessed} 条</span>
            </div>
            <div className="privacy-cost-row">
              <span className="privacy-cost-label">云端 API 估算</span>
              <span className="privacy-cost-value cloud">${stats.estimatedCloudCost.toFixed(2)}</span>
            </div>
            <div className="privacy-cost-row highlight">
              <span className="privacy-cost-label">您的实际成本</span>
              <span className="privacy-cost-value local">${stats.actualCost.toFixed(2)}</span>
            </div>
            <div className="privacy-cost-savings">
              <span>已节省</span>
              <span className="savings-amount">${stats.estimatedCloudCost.toFixed(2)}</span>
            </div>
          </div>
        </div>
        </div>

        {/* Footer Notice */}
        <div className="privacy-footer">
          <Lock size={14} />
          <span>您的数据从未离开本地网络</span>
        </div>
      </div>

      <style>{`
        .privacy-panel-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(4px);
          z-index: 49;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
        }

        .privacy-panel-backdrop.open {
          opacity: 1;
          visibility: visible;
        }

        .privacy-panel {
          position: fixed;
          top: 0;
          right: 0;
          width: 360px;
          height: 100vh;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(16px);
          border-left: 1px solid var(--border-light);
          z-index: 50;
          transform: translateX(100%);
          transition: transform 0.3s ease;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .privacy-panel.open {
          transform: translateX(0);
        }

        .privacy-panel-header {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-light);
          background: rgba(255, 255, 255, 0.8);
        }

        .privacy-panel-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 600;
          font-size: 1rem;
          color: var(--text-primary);
        }

        .privacy-panel-title svg {
          color: #10b981;
        }

        .privacy-panel-close {
          padding: 6px;
          border-radius: 8px;
          color: var(--text-tertiary);
          transition: all 0.2s ease;
        }

        .privacy-panel-close:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .privacy-panel-content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          min-height: 0;
          padding-bottom: 16px;
        }

        .privacy-status-banner {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 16px;
          padding: 16px;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 12px;
        }

        .privacy-status-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          background: rgba(16, 185, 129, 0.15);
          border-radius: 12px;
          color: #10b981;
        }

        .privacy-status-info {
          display: flex;
          flex-direction: column;
          flex: 1;
        }

        .privacy-status-label {
          font-size: 0.75rem;
          color: var(--text-tertiary);
        }

        .privacy-status-value {
          font-size: 1rem;
          font-weight: 600;
          color: #10b981;
        }

        .privacy-status-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 12px;
          background: #10b981;
          color: white;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .privacy-section {
          padding: 0 16px;
          margin-bottom: 20px;
        }

        .privacy-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .privacy-items {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .privacy-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: 10px;
          transition: all 0.2s ease;
        }

        .privacy-item:hover {
          border-color: rgba(16, 185, 129, 0.3);
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.1);
        }

        .privacy-item-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .privacy-item-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: rgba(16, 185, 129, 0.1);
          border-radius: 8px;
        }

        .privacy-item-info {
          display: flex;
          flex-direction: column;
        }

        .privacy-item-label {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--text-primary);
        }

        .privacy-item-value {
          font-size: 0.75rem;
          color: var(--text-tertiary);
        }

        .privacy-item-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.7rem;
          font-weight: 600;
        }

        .privacy-cost-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: 12px;
          padding: 16px;
        }

        .privacy-cost-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--border-light);
        }

        .privacy-cost-row:last-of-type {
          border-bottom: none;
        }

        .privacy-cost-row.highlight {
          background: rgba(16, 185, 129, 0.05);
          margin: 8px -16px 0;
          padding: 12px 16px;
          border-radius: 0 0 12px 12px;
          border-bottom: none;
        }

        .privacy-cost-label {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }

        .privacy-cost-value {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .privacy-cost-value.cloud {
          color: #ef4444;
          text-decoration: line-through;
          opacity: 0.7;
        }

        .privacy-cost-value.local {
          color: #10b981;
          font-size: 1.1rem;
        }

        .privacy-cost-savings {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 2px dashed rgba(16, 185, 129, 0.3);
        }

        .privacy-cost-savings span:first-child {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }

        .savings-amount {
          font-size: 1.25rem;
          font-weight: 700;
          color: #10b981;
        }

        .privacy-footer {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 16px;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%);
          border-top: 1px solid var(--border-light);
          color: #10b981;
          font-size: 0.8rem;
          font-weight: 500;
        }

        @media (max-width: 768px) {
          .privacy-panel {
            width: 100%;
          }
        }
      `}</style>
    </>
  );
};
