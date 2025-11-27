import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, Loader2, Sparkles, Zap, BrainCircuit, Network } from 'lucide-react';
import { api } from '../api/client';
import { useChat } from '../context/ChatContext';

interface AuthScreenProps {
    onAuthenticated: () => Promise<void>;
    error?: string;
}

type TouchedFields = {
    name: boolean;
    email: boolean;
    password: boolean;
};

const FEATURE_HIGHLIGHTS = [
    {
        icon: <Network className="w-5 h-5" />,
        title: '多智能体编排',
        desc: '实时监控上下文信号，自动调度 Agent 工具链。',
    },
    {
        icon: <BrainCircuit className="w-5 h-5" />,
        title: '统一记忆体',
        desc: '成员与 LLM 共享同一条时间线，历史可回溯。',
    },
    {
        icon: <Zap className="w-5 h-5" />,
        title: '主动式响应',
        desc: 'Agent 主动参与协作，无需被动等待指令。',
    },
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated, error }) => {
    const { dispatch } = useChat();
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(error || null);
    const [messageTone, setMessageTone] = useState<'error' | 'success'>('error');
    const [showPassword, setShowPassword] = useState(false);
    const [shakeError, setShakeError] = useState(false);
    const [touched, setTouched] = useState<TouchedFields>({ name: false, email: false, password: false });

    const isRegisterMode = mode === 'register';

    const runBlockingValidation = () => {
        const emailInvalid = !EMAIL_PATTERN.test(email.trim());
        const passwordInvalid = password.trim().length < 8;
        const nameInvalid = isRegisterMode && name.trim().length < 2;
        return emailInvalid || passwordInvalid || nameInvalid;
    };

    const triggerShake = () => {
        setShakeError(true);
        setTimeout(() => setShakeError(false), 600);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setTouched({ name: true, email: true, password: true });
        setLoading(true);
        setMessage(null);
        setMessageTone('error');

        if (runBlockingValidation()) {
            setLoading(false);
            triggerShake();
            setMessage('请先修复表单中的错误提示');
            setMessageTone('error');
            dispatch({ type: 'SET_AUTH_STATUS', payload: 'unauthenticated' });
            return;
        }

        try {
            if (isRegisterMode) {
                await api.auth.register({ email: email.trim(), password, name: name.trim() || email.split('@')[0] });
                setMessageTone('success');
                setMessage('注册成功，正在自动登录…');
            } else {
                await api.auth.login({ email: email.trim(), password });
                setMessageTone('success');
                setMessage('登录成功，正在进入聊天室…');
            }
            await onAuthenticated();
        } catch (err: any) {
            triggerShake();
            const status = err?.status as number | undefined;
            const raw = (err?.message as string) || '';
            const reason = raw || (status ? `请求失败（${status}）` : '请求失败');
            let friendly: string;

            if (isRegisterMode) {
                if (status === 409) {
                    friendly = '邮箱已被注册，请直接登录或更换邮箱';
                } else if (status === 400) {
                    friendly = raw || '注册信息不完整或密码太短';
                } else {
                    friendly = `注册失败：${reason}`;
                }
            } else {
                if (status === 401) {
                    friendly = '邮箱或密码不正确';
                } else {
                    friendly = `登录失败：${reason}`;
                }
            }

            if (raw && !friendly.includes(raw) && status !== 409) {
                friendly = `${friendly}（${raw}）`;
            }

            setMessageTone('error');
            setMessage(friendly);
            dispatch({ type: 'SET_AUTH_STATUS', payload: 'unauthenticated' });
        } finally {
            setLoading(false);
        }
    };

    const handleModeChange = (next: 'login' | 'register') => {
        setMode(next);
        setTouched({ name: false, email: false, password: false });
        setMessage(null);
        setMessageTone('error');
        setShakeError(false);
    };

    const fieldErrors = useMemo(() => {
        const next = {
            name: '',
            email: '',
            password: '',
        };

        if (touched.email) {
            if (!email.trim()) {
                next.email = '邮箱不能为空';
            } else if (!EMAIL_PATTERN.test(email.trim())) {
                next.email = '请输入有效邮箱地址';
            }
        }

        if (touched.password) {
            if (!password.trim()) {
                next.password = '密码不能为空';
            } else if (password.trim().length < 8) {
                next.password = '至少 8 位字符';
            }
        }

        if (isRegisterMode && touched.name) {
            if (!name.trim()) {
                next.name = '昵称不能为空';
            } else if (name.trim().length < 2) {
                next.name = '至少输入 2 个字符';
            }
        }

        return next;
    }, [email, password, name, touched, isRegisterMode]);

    return (
        <div className="auth-screen">
            <div className="ambient ambient-one" />
            <div className="ambient ambient-two" />
            <div className="ambient ambient-three" />

            <div className="auth-container">
                <div className="brand-section">
                    <div className="brand-header">
                        <div className="pill">
                            <Sparkles size={16} className="text-amber-500" />
                            <span>Active LLM Chatroom</span>
                        </div>
                        <h1>
                            下一代<br />
                            <span className="text-gradient">多智能体协作</span>空间
                        </h1>
                        <p className="brand-desc">
                            为团队与 AI 构建的"常在线"协作环境。
                            <br />
                            无缝集成 Parallax 基础设施，让智能体真正融入工作流。
                        </p>
                    </div>

                    <div className="features-list">
                        {FEATURE_HIGHLIGHTS.map((feature, index) => (
                            <div className="feature-item" key={feature.title} style={{ animationDelay: `${0.1 * (index + 1)}s` }}>
                                <div className="feature-icon">{feature.icon}</div>
                                <div className="feature-content">
                                    <div className="feature-title">{feature.title}</div>
                                    <div className="feature-desc">{feature.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="parallax-badge">
                        <div className="parallax-content">
                            <span className="powered-by">Powered By</span>
                            <div className="parallax-logo-wrapper">
                                <img src="/parallax.png" alt="Parallax" className="parallax-logo" />
                            </div>
                        </div>
                        <div className="parallax-glow" />
                    </div>
                </div>

                <div className="auth-panel">
                    <div className="auth-card">
                        <div className="card-header">
                            <h2>{isRegisterMode ? '创建新身份' : '欢迎回来'}</h2>
                            <p className="auth-subtitle">
                                {isRegisterMode ? '注册以接入 Parallax 协作网络' : '登录以连接您的智能体工作区'}
                            </p>
                        </div>

                        <form onSubmit={handleSubmit} noValidate>
                            {isRegisterMode && (
                                <div className="field">
                                    <label htmlFor="name">昵称</label>
                                    <input
                                        id="name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                                        placeholder="您的称呼"
                                        autoComplete="name"
                                        className={fieldErrors.name ? 'error' : ''}
                                    />
                                    {fieldErrors.name && <span className="field-error-msg">{fieldErrors.name}</span>}
                                </div>
                            )}
                            <div className="field">
                                <label htmlFor="email">邮箱</label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                                    placeholder="name@company.com"
                                    autoComplete="email"
                                    className={fieldErrors.email ? 'error' : ''}
                                />
                                {fieldErrors.email && <span className="field-error-msg">{fieldErrors.email}</span>}
                            </div>
                            <div className="field">
                                <label htmlFor="password">密码</label>
                                <div className="input-wrapper">
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                                        placeholder="••••••••"
                                        autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                                        className={fieldErrors.password ? 'error' : ''}
                                    />
                                    <button
                                        type="button"
                                        className="toggle-password"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                    </button>
                                </div>
                                {fieldErrors.password && <span className="field-error-msg">{fieldErrors.password}</span>}
                            </div>

                            <div className={`auth-message ${messageTone} ${message ? 'visible' : ''} ${shakeError ? 'shake' : ''}`}>
                                {message}
                            </div>

                            <button type="submit" disabled={loading} className="submit-btn">
                                {loading ? <Loader2 className="animate-spin" size={20} /> : (isRegisterMode ? '立即注册' : '登录')}
                            </button>
                        </form>

                        <div className="auth-footer">
                            {isRegisterMode ? '已有账号？' : '还没有账号？'}
                            <button onClick={() => handleModeChange(isRegisterMode ? 'login' : 'register')}>
                                {isRegisterMode ? '直接登录' : '免费注册'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                .auth-screen {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #f8fafc;
                    color: #0f172a;
                    position: relative;
                    overflow: hidden;
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                }

                .ambient {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(120px);
                    opacity: 0.6;
                    z-index: 0;
                    animation: float 25s infinite ease-in-out;
                }
                .ambient-one {
                    width: 600px;
                    height: 600px;
                    background: radial-gradient(circle, #dbeafe 0%, rgba(219, 234, 254, 0) 70%);
                    top: -150px;
                    left: -150px;
                }
                .ambient-two {
                    width: 500px;
                    height: 500px;
                    background: radial-gradient(circle, #e0e7ff 0%, rgba(224, 231, 255, 0) 70%);
                    bottom: -100px;
                    right: -100px;
                    animation-delay: -5s;
                }
                .ambient-three {
                    width: 400px;
                    height: 400px;
                    background: radial-gradient(circle, #cffafe 0%, rgba(207, 250, 254, 0) 70%);
                    top: 40%;
                    left: 40%;
                    opacity: 0.4;
                    animation-delay: -10s;
                }

                .auth-container {
                    position: relative;
                    z-index: 1;
                    display: grid;
                    grid-template-columns: 1.2fr 1fr;
                    gap: 100px;
                    max-width: 1280px;
                    width: 100%;
                    padding: 40px;
                    align-items: center;
                }

                /* Brand Section */
                .brand-section {
                    display: flex;
                    flex-direction: column;
                    gap: 48px;
                }

                .brand-header {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }

                .pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 20px;
                    background: #fff;
                    border: 1px solid #e2e8f0;
                    border-radius: 100px;
                    font-size: 0.95rem;
                    font-weight: 600;
                    color: #475569;
                    width: fit-content;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.03);
                    transition: transform 0.3s ease;
                }
                
                .pill:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(0,0,0,0.05);
                }

                h1 {
                    font-size: 4rem;
                    line-height: 1.1;
                    font-weight: 800;
                    letter-spacing: -0.03em;
                    margin: 0;
                    color: #0f172a;
                }

                .text-gradient {
                    background: linear-gradient(135deg, #2563eb 0%, #4f46e5 50%, #7c3aed 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-size: 200% auto;
                    animation: gradientMove 5s ease infinite;
                }

                .brand-desc {
                    font-size: 1.25rem;
                    line-height: 1.6;
                    color: #475569;
                    margin: 0;
                    max-width: 540px;
                    font-weight: 400;
                }

                .features-list {
                    display: flex;
                    flex-direction: column;
                    gap: 32px;
                }

                .feature-item {
                    display: flex;
                    gap: 20px;
                    align-items: flex-start;
                    opacity: 0;
                    animation: slideUp 0.6s ease-out forwards;
                    padding: 16px;
                    border-radius: 20px;
                    transition: background 0.3s ease;
                }
                
                .feature-item:hover {
                    background: rgba(255, 255, 255, 0.5);
                }

                .feature-icon {
                    width: 56px;
                    height: 56px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #eff6ff;
                    border: 1px solid #dbeafe;
                    border-radius: 16px;
                    color: #2563eb;
                    flex-shrink: 0;
                    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08);
                }
                
                .feature-icon svg {
                    width: 28px;
                    height: 28px;
                }

                .feature-content {
                    flex: 1;
                    padding-top: 2px;
                }

                .feature-title {
                    font-size: 1.1rem;
                    font-weight: 700;
                    color: #0f172a;
                    margin-bottom: 6px;
                }

                .feature-desc {
                    font-size: 1rem;
                    color: #64748b;
                    line-height: 1.5;
                }

                /* Parallax Badge */
                .parallax-badge {
                    position: relative;
                    margin-top: 24px;
                    padding: 3px;
                    border-radius: 24px;
                    background: linear-gradient(135deg, #f1f5f9, #fff, #f1f5f9);
                    width: fit-content;
                    overflow: hidden;
                    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.06);
                    transition: transform 0.3s ease;
                }
                
                .parallax-badge:hover {
                    transform: translateY(-2px);
                }

                .parallax-content {
                    background: #fff;
                    padding: 16px 28px;
                    border-radius: 21px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .powered-by {
                    font-size: 0.8rem;
                    text-transform: uppercase;
                    letter-spacing: 0.15em;
                    color: #94a3b8;
                    font-weight: 700;
                }

                .parallax-logo-wrapper {
                    display: flex;
                    align-items: center;
                }

                .parallax-logo {
                    height: 36px;
                    width: auto;
                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.05));
                }
                
                .parallax-glow {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent);
                    transform: skewX(-20deg) translateX(-150%);
                    animation: shimmer 4s infinite;
                    pointer-events: none;
                }

                /* Auth Panel */
                .auth-panel {
                    display: flex;
                    justify-content: center;
                }

                .auth-card {
                    width: 100%;
                    max-width: 440px;
                    background: rgba(255, 255, 255, 0.85);
                    backdrop-filter: blur(24px);
                    border: 1px solid #fff;
                    border-radius: 32px;
                    padding: 48px;
                    box-shadow: 
                        0 20px 40px -12px rgba(0, 0, 0, 0.08),
                        0 0 0 1px rgba(255, 255, 255, 0.5) inset;
                    animation: fadeIn 0.8s ease-out;
                }

                .card-header {
                    text-align: center;
                    margin-bottom: 40px;
                }

                .card-header h2 {
                    font-size: 2rem;
                    font-weight: 800;
                    margin: 0 0 12px;
                    color: #0f172a;
                    letter-spacing: -0.02em;
                }

                .auth-subtitle {
                    color: #64748b;
                    font-size: 1rem;
                    margin: 0;
                    line-height: 1.5;
                }

                form {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }

                .field {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                label {
                    font-size: 0.9rem;
                    font-weight: 600;
                    color: #334155;
                    margin-left: 4px;
                }

                input {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 16px;
                    padding: 14px 18px;
                    color: #0f172a;
                    font-size: 1.05rem;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }

                input:focus {
                    outline: none;
                    border-color: #3b82f6;
                    background: #fff;
                    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12);
                }
                
                input:hover:not(:focus) {
                    border-color: #cbd5e1;
                }

                input.error {
                    border-color: #ef4444;
                    background: #fef2f2;
                }

                .field-error-msg {
                    font-size: 0.85rem;
                    color: #ef4444;
                    margin-left: 4px;
                }

                .input-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                }

                .input-wrapper input {
                    width: 100%;
                    padding-right: 52px;
                }

                .toggle-password {
                    position: absolute;
                    right: 14px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    color: #94a3b8;
                    cursor: pointer;
                    padding: 6px;
                    border-radius: 8px;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10;
                }

                .toggle-password:hover {
                    color: #64748b;
                    background: rgba(0,0,0,0.04);
                }

                .submit-btn {
                    background: linear-gradient(135deg, #2563eb, #1d4ed8);
                    color: white;
                    border: none;
                    border-radius: 16px;
                    padding: 16px;
                    font-size: 1.05rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    margin-top: 12px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    box-shadow: 0 8px 20px -4px rgba(37, 99, 235, 0.3);
                }

                .submit-btn:hover:not(:disabled) {
                    transform: translateY(-2px);
                    box-shadow: 0 12px 24px -6px rgba(37, 99, 235, 0.4);
                }
                
                .submit-btn:active:not(:disabled) {
                    transform: translateY(0);
                }

                .submit-btn:disabled {
                    opacity: 0.7;
                    cursor: not-allowed;
                    transform: none;
                }

                .auth-message {
                    font-size: 0.9rem;
                    padding: 14px;
                    border-radius: 12px;
                    text-align: center;
                    display: none;
                    font-weight: 500;
                }

                .auth-message.visible {
                    display: block;
                    animation: slideUp 0.3s ease-out;
                }

                .auth-message.error {
                    background: #fef2f2;
                    color: #ef4444;
                    border: 1px solid #fecaca;
                }

                .auth-message.success {
                    background: #f0fdf4;
                    color: #16a34a;
                    border: 1px solid #bbf7d0;
                }

                .auth-footer {
                    margin-top: 32px;
                    text-align: center;
                    font-size: 0.95rem;
                    color: #64748b;
                }

                .auth-footer button {
                    background: none;
                    border: none;
                    color: #2563eb;
                    font-weight: 600;
                    cursor: pointer;
                    margin-left: 6px;
                    transition: color 0.2s;
                }

                .auth-footer button:hover {
                    color: #1d4ed8;
                    text-decoration: underline;
                }

                @keyframes float {
                    0%, 100% { transform: translate(0, 0); }
                    50% { transform: translate(20px, -20px); }
                }

                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }

                @keyframes shimmer {
                    0% { transform: skewX(-20deg) translateX(-150%); }
                    100% { transform: skewX(-20deg) translateX(150%); }
                }

                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
                
                @keyframes gradientMove {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }

                .shake {
                    animation: shake 0.4s ease-in-out;
                }

                @media (max-width: 1024px) {
                    .auth-container {
                        grid-template-columns: 1fr;
                        gap: 60px;
                        padding: 32px;
                    }

                    .brand-section {
                        text-align: center;
                        align-items: center;
                    }
                    
                    .brand-header {
                        align-items: center;
                    }

                    .features-list {
                        align-items: center;
                        text-align: left;
                    }

                    .feature-item {
                        max-width: 480px;
                        width: 100%;
                    }

                    h1 {
                        font-size: 3rem;
                    }
                }
            `}</style>
        </div>
    );
};
