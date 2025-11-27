import React from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        className="about-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />
                    <div className="about-modal-wrapper">
                        <motion.div
                            className="about-modal"
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        >
                            <button className="about-close" onClick={onClose}>
                                <X size={20} />
                            </button>

                            <div className="about-logo-section">
                                <img src="/parallax.png" alt="Parallax" className="about-logo" />
                                <div className="about-hackathon-badge">黑客松项目</div>
                            </div>

                            <div className="about-content">
                                <h2>多智能体协作空间</h2>
                                <p className="about-tagline">
                                    基于 Parallax 构建的下一代 LLM 群聊工作区
                                </p>

                                <div className="about-features">
                                    <div className="about-feature">
                                        <span className="feature-icon">🤖</span>
                                        <div>
                                            <div className="feature-title">多智能体系统</div>
                                            <div className="feature-desc">多个 LLM Agent 实时协作，共同完成复杂任务</div>
                                        </div>
                                    </div>
                                    <div className="about-feature">
                                        <span className="feature-icon">⚡</span>
                                        <div>
                                            <div className="feature-title">主动式响应</div>
                                            <div className="feature-desc">Agent 主动参与对话，无需被动等待指令</div>
                                        </div>
                                    </div>
                                    <div className="about-feature">
                                        <span className="feature-icon">🔗</span>
                                        <div>
                                            <div className="feature-title">Parallax 集成</div>
                                            <div className="feature-desc">基于 Parallax 强大的 LLM 基础设施构建</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="about-footer">
                                    <div className="powered-by-large">
                                        <span>技术支持</span>
                                        <span className="parallax-text-footer">Parallax</span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>

                    <style>{`
                        .about-overlay {
                            position: fixed;
                            inset: 0;
                            background: rgba(15, 23, 42, 0.7);
                            backdrop-filter: blur(8px);
                            z-index: 9998;
                        }

                        .about-modal-wrapper {
                            position: fixed;
                            inset: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 24px;
                            pointer-events: none;
                            z-index: 9999;
                        }

                        .about-modal {
                            position: relative;
                            pointer-events: auto;
                            width: 90%;
                            max-width: 420px;
                            max-height: calc(100vh - 48px);
                            background: linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%);
                            border-radius: 24px;
                            border: 1px solid rgba(139, 92, 246, 0.3);
                            box-shadow: 0 25px 80px rgba(124, 58, 237, 0.3);
                            overflow: hidden;
                            overflow-y: auto;
                        }

                        .about-close {
                            position: absolute;
                            top: 16px;
                            right: 16px;
                            color: rgba(255, 255, 255, 0.6);
                            padding: 8px;
                            border-radius: 8px;
                            transition: all 0.2s;
                            z-index: 10;
                        }

                        .about-close:hover {
                            background: rgba(255, 255, 255, 0.1);
                            color: white;
                        }

                        .about-logo-section {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            padding: 40px 24px 24px;
                            background: linear-gradient(180deg, rgba(139, 92, 246, 0.15), transparent);
                        }

                        .about-logo {
                            height: 60px;
                            width: auto;
                            filter: drop-shadow(0 4px 20px rgba(168, 85, 247, 0.4));
                        }

                        .parallax-text-footer {
                            font-weight: 700;
                            background: linear-gradient(135deg, #c084fc, #a855f7, #7c3aed);
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            background-clip: text;
                            font-size: 1rem;
                        }

                        .about-hackathon-badge {
                            margin-top: 16px;
                            padding: 6px 16px;
                            background: linear-gradient(135deg, #c084fc, #a855f7);
                            border-radius: 999px;
                            color: white;
                            font-size: 0.8rem;
                            font-weight: 600;
                            letter-spacing: 0.02em;
                        }

                        .about-content {
                            padding: 24px;
                        }

                        .about-content h2 {
                            margin: 0 0 8px;
                            font-size: 1.5rem;
                            color: white;
                            text-align: center;
                        }

                        .about-tagline {
                            margin: 0 0 24px;
                            text-align: center;
                            color: rgba(255, 255, 255, 0.7);
                            font-size: 0.9rem;
                        }

                        .about-features {
                            display: flex;
                            flex-direction: column;
                            gap: 16px;
                        }

                        .about-feature {
                            display: flex;
                            align-items: flex-start;
                            gap: 12px;
                            padding: 14px;
                            background: rgba(255, 255, 255, 0.05);
                            border-radius: 14px;
                            border: 1px solid rgba(255, 255, 255, 0.08);
                        }

                        .feature-icon {
                            font-size: 1.5rem;
                            line-height: 1;
                        }

                        .feature-title {
                            font-weight: 600;
                            color: white;
                            font-size: 0.9rem;
                            margin-bottom: 2px;
                        }

                        .feature-desc {
                            color: rgba(255, 255, 255, 0.6);
                            font-size: 0.8rem;
                        }

                        .about-footer {
                            margin-top: 24px;
                            padding-top: 20px;
                            border-top: 1px solid rgba(255, 255, 255, 0.1);
                        }

                        .powered-by-large {
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            gap: 10px;
                        }

                        .powered-by-large span {
                            color: rgba(255, 255, 255, 0.5);
                            font-size: 0.85rem;
                        }

                        .powered-by-large img {
                            height: 24px;
                            width: auto;
                        }

                        /* Responsive positioning */
                        @media (max-width: 480px) {
                            .about-modal-wrapper {
                                align-items: flex-end;
                                padding: 0;
                            }

                            .about-modal {
                                width: 100%;
                                max-width: 100%;
                                border-radius: 24px 24px 0 0;
                                max-height: 90vh;
                            }

                            .about-logo-section {
                                padding: 32px 20px 20px;
                            }

                            .about-logo {
                                height: 48px;
                            }

                            .about-content {
                                padding: 20px;
                            }

                            .about-content h2 {
                                font-size: 1.3rem;
                            }

                            .about-feature {
                                padding: 12px;
                            }
                        }

                        @media (min-width: 481px) and (max-width: 768px) {
                            .about-modal {
                                width: 85%;
                                max-width: 400px;
                            }
                        }

                        @media (min-width: 769px) and (max-width: 1024px) {
                            .about-modal {
                                max-width: 440px;
                            }
                        }

                        @media (min-width: 1025px) {
                            .about-modal {
                                max-width: 460px;
                            }

                            .about-logo {
                                height: 70px;
                            }
                        }

                        /* Height-based adjustments for landscape mobile */
                        @media (max-height: 600px) {
                            .about-logo-section {
                                padding: 24px 20px 16px;
                            }

                            .about-logo {
                                height: 40px;
                            }

                            .about-hackathon-badge {
                                margin-top: 10px;
                                padding: 4px 12px;
                                font-size: 0.7rem;
                            }

                            .about-content {
                                padding: 16px;
                            }

                            .about-features {
                                gap: 10px;
                            }

                            .about-feature {
                                padding: 10px;
                            }

                            .about-footer {
                                margin-top: 16px;
                                padding-top: 14px;
                            }
                        }
                    `}</style>
                </>
            )}
        </AnimatePresence>
    );
};
