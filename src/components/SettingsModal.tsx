import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Loader2, Shield, Cpu, KeyRound, Link2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api/client';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [endpoint, setEndpoint] = useState('');
    const [model, setModel] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [clearKey, setClearKey] = useState(false);
    const [hasStoredKey, setHasStoredKey] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        const fetchConfig = async () => {
            try {
                setLoading(true);
                const res = await api.llm.getConfig();
                setEndpoint(res.endpoint || '');
                setModel(res.model || '');
                setHasStoredKey(Boolean(res.hasApiKey));
                setApiKey('');
                setClearKey(false);
                setError('');
            } catch (err) {
                console.error('Failed to load LLM config', err);
                const anyErr = err as any;
                if (anyErr?.status === 401) {
                    setError('未登录或会话已过期，请重新登录后再配置 AI。');
                } else {
                    setError(err instanceof Error ? err.message : '加载配置失败，请稍后重试。');
                }
            } finally {
                setLoading(false);
            }
        };
        fetchConfig();
    }, [isOpen]);

    const onSave = async () => {
        if (!endpoint.trim()) {
            setError('Endpoint is required');
            setStatus('error');
            return;
        }
        try {
            setSaving(true);
            setStatus('idle');
            setError('');
            const res = await api.llm.saveConfig({
                endpoint: endpoint.trim(),
                model: model.trim(),
                apiKey,
                clearApiKey: clearKey,
            });
            setHasStoredKey(Boolean(res.hasApiKey));
            setApiKey('');
            setClearKey(false);
            setStatus('saved');
            setTimeout(() => setStatus('idle'), 2000);
        } catch (err) {
            console.error('Failed to save LLM config', err);
            setStatus('error');
            setError(err instanceof Error ? err.message : '保存配置失败，请稍后重试。');
        } finally {
            setSaving(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        className="settings-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                    />
                    <motion.div
                        className="settings-modal"
                        initial={{ scale: 0.95, opacity: 0, y: '-45%' }}
                        animate={{ scale: 1, opacity: 1, y: '-50%' }}
                        exit={{ scale: 0.95, opacity: 0, y: '-45%' }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    >
                        <div className="settings-header">
                            <div className="header-content">
                                <div className="settings-title">设置</div>
                                <div className="settings-subtitle">配置 AI 接口地址、模型和 API Key</div>
                            </div>
                            <button className="close-btn" onClick={onClose} aria-label="关闭设置">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="settings-content">
                            {error && (
                                <motion.div
                                    className="error-banner"
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                >
                                    <AlertCircle size={16} className="error-icon" />
                                    <span>{error}</span>
                                </motion.div>
                            )}

                            <div className="settings-section">
                                <div className="section-header">
                                    <Sparkles size={16} className="section-icon" />
                                    <span>AI (LLM) 配置</span>
                                </div>

                                <div className="form-group">
                                    <label className="input-label">
                                        <span>接口地址</span>
                                    </label>
                                    <div className="input-wrapper">
                                        <div className="input-icon-left">
                                            <Link2 size={14} />
                                        </div>
                                        <input
                                            type="text"
                                            value={endpoint}
                                            onChange={(e) => setEndpoint(e.target.value)}
                                            placeholder="https://your-llm-endpoint/v1"
                                            disabled={loading}
                                            className="settings-input has-icon"
                                        />
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group flex-1">
                                        <label className="input-label">
                                            <span>模型名称</span>
                                            <span className="optional-tag">可选</span>
                                        </label>
                                        <div className="input-wrapper">
                                            <div className="input-icon-left">
                                                <Cpu size={14} />
                                            </div>
                                            <input
                                                type="text"
                                                value={model}
                                                onChange={(e) => setModel(e.target.value)}
                                                placeholder="gpt-4o-mini"
                                                disabled={loading}
                                                className="settings-input has-icon"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="input-label">
                                        <span>API Key</span>
                                        <span className="optional-tag">可选</span>
                                    </label>
                                    <div className="input-wrapper">
                                        <div className="input-icon-left">
                                            <KeyRound size={14} />
                                        </div>
                                        <input
                                            type="password"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder={hasStoredKey ? '••••••••••••••••' : 'sk-...'}
                                            disabled={loading}
                                            className="settings-input has-icon"
                                        />
                                    </div>
                                    <div className="input-footer">
                                        <label className="checkbox-wrapper">
                                            <input
                                                type="checkbox"
                                                checked={clearKey}
                                                onChange={(e) => setClearKey(e.target.checked)}
                                                disabled={loading}
                                            />
                                            <span className="checkbox-label">清空已存 Key</span>
                                        </label>
                                        <span className="hint-text">留空则保留已存 Key</span>
                                    </div>
                                </div>
                            </div>

                            <div className="settings-footer-note">
                                <Shield size={14} />
                                <span>配置将安全存储，优先用于摘要生成服务。</span>
                            </div>
                        </div>

                        <div className="settings-footer">
                            <button className="btn-secondary" onClick={onClose} disabled={saving}>
                                取消
                            </button>
                            <button
                                className={`btn-primary ${status === 'saved' ? 'success' : ''}`}
                                onClick={onSave}
                                disabled={saving || loading || !endpoint.trim()}
                            >
                                {saving ? (
                                    <>
                                        <Loader2 size={16} className="spinner" />
                                        <span>保存中...</span>
                                    </>
                                ) : status === 'saved' ? (
                                    <>
                                        <CheckCircle2 size={16} />
                                        <span>已保存</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={16} />
                                        <span>保存配置</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

const styles = `
.settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(255, 255, 255, 0.4);
    backdrop-filter: blur(8px);
    z-index: 9998;
}

.settings-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 100%;
    max-width: 460px;
    background: #ffffff;
    border-radius: 20px;
    box-shadow: 
        0 10px 40px -10px rgba(0, 0, 0, 0.08),
        0 0 0 1px rgba(0, 0, 0, 0.03);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    overflow: hidden;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #1f2937;
}

.settings-header {
    padding: 24px 28px 12px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
}

.header-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.settings-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: #111827;
    letter-spacing: -0.02em;
}

.settings-subtitle {
    font-size: 0.875rem;
    color: #6b7280;
}

.close-btn {
    padding: 8px;
    border-radius: 10px;
    color: #9ca3af;
    transition: all 0.2s;
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: -4px;
    margin-right: -8px;
}

.close-btn:hover {
    background: #f3f4f6;
    color: #111827;
}

.settings-content {
    padding: 12px 28px 28px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.settings-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: #374151;
    font-size: 0.95rem;
    padding-bottom: 8px;
    border-bottom: 1px solid #f3f4f6;
}

.section-icon {
    color: #8b5cf6;
}

.form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-row {
    display: flex;
    gap: 16px;
}

.flex-1 {
    flex: 1;
}

.input-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.875rem;
    font-weight: 500;
    color: #4b5563;
}

.optional-tag {
    font-size: 0.7rem;
    padding: 2px 6px;
    background: #f3f4f6;
    color: #6b7280;
    border-radius: 4px;
    font-weight: 500;
}

.input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
}

.input-icon-left {
    position: absolute;
    left: 12px;
    color: #9ca3af;
    pointer-events: none;
    display: flex;
    align-items: center;
}

.settings-input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #e5e7eb;
    background: #ffffff;
    color: #111827;
    font-size: 0.9rem;
    transition: all 0.2s;
    outline: none;
}

.settings-input.has-icon {
    padding-left: 36px;
}

.settings-input:focus {
    border-color: #8b5cf6;
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
}

.settings-input::placeholder {
    color: #d1d5db;
}

.input-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
}

.checkbox-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
}

.checkbox-wrapper input[type="checkbox"] {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1px solid #d1d5db;
    accent-color: #8b5cf6;
}

.checkbox-label {
    font-size: 0.8rem;
    color: #6b7280;
}

.hint-text {
    font-size: 0.75rem;
    color: #9ca3af;
}

.error-banner {
    background: #fef2f2;
    border: 1px solid #fee2e2;
    color: #b91c1c;
    padding: 12px 16px;
    border-radius: 12px;
    font-size: 0.875rem;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    line-height: 1.4;
}

.error-icon {
    color: #ef4444;
    flex-shrink: 0;
    margin-top: 2px;
}

.settings-footer-note {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: #9ca3af;
    font-size: 0.75rem;
    margin-top: auto;
    padding-top: 12px;
}

.settings-footer {
    padding: 16px 28px;
    border-top: 1px solid #f3f4f6;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    background: #ffffff;
}

.btn-secondary {
    padding: 8px 16px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 500;
    color: #4b5563;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-secondary:hover {
    background: #f3f4f6;
    color: #111827;
}

.btn-primary {
    padding: 8px 20px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 600;
    color: white;
    background: #111827;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.btn-primary:hover:not(:disabled) {
    background: #000000;
    transform: translateY(-1px);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
}

.btn-primary.success {
    background: #10b981;
}

.spinner {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
    .settings-modal {
        width: 100%;
        height: 100%;
        max-height: 100%;
        border-radius: 0;
        top: 0;
        left: 0;
        transform: none !important;
    }
    
    .settings-content {
        flex: 1;
    }
}
`;

if (typeof document !== 'undefined') {
    const styleId = 'settings-modal-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    } else {
        document.getElementById(styleId)!.textContent = styles;
    }
}
