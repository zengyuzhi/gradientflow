import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Sparkles, Search, Database, Zap, Users, Briefcase, Code, Plane, Coffee } from 'lucide-react';

interface Message {
    id: number;
    role: string;
    content: string;
    delay: number;
    tool?: 'search' | 'rag' | 'analyze';
}

interface Agent {
    name: string;
    icon: any;
    color: string;
    gradient?: string;
}

interface Scenario {
    id: string;
    name: string;
    icon: any;
    script: Message[];
    agents: Record<string, Agent>;
}

const SCENARIOS: Scenario[] = [
    {
        id: 'research',
        name: "科研协作",
        icon: Briefcase,
        agents: {
            user: { name: '阿历克斯', icon: User, color: '#3b82f6' },
            researcher: { name: '陈博士', icon: User, color: '#6366f1' },
            ai_assistant: { name: 'Gradient AI', icon: Sparkles, color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)' },
            manager: { name: '莎拉', icon: User, color: '#10b981' },
        },
        script: [
            { id: 1, role: 'user', content: '咱们上周讨论的那篇 Transformer 论文，核心观点是什么来着？', delay: 500 },
            { id: 2, role: 'ai_assistant', content: '根据群聊记忆，你们讨论的是《Attention Is All You Need》。核心观点：完全基于注意力机制，抛弃了 RNN 和 CNN。', delay: 2200, tool: 'rag' },
            { id: 3, role: 'researcher', content: '对！能结合我们的私有数据分析下可行性吗？', delay: 3600 },
            { id: 4, role: 'ai_assistant', content: '该架构与现有分布式训练集群高度兼容，预计效率提升 40%。建议先在小规模数据集验证。', delay: 5200, tool: 'analyze' },
            { id: 5, role: 'manager', content: '太好了！阿历克斯，下周能出个 Demo 吗？', delay: 6600 },
            { id: 6, role: 'user', content: '有 AI 辅助的话没问题！@Gradient 帮我准备环境配置。', delay: 8000 },
            { id: 7, role: 'ai_assistant', content: '已生成 Docker 配置和依赖清单，发送到你的邮箱了。', delay: 9600, tool: 'analyze' },
        ]
    },
    {
        id: 'marketing',
        name: "营销创意",
        icon: Coffee,
        agents: {
            user: { name: '艾玛', icon: User, color: '#f43f5e' },
            creative: { name: '文案师', icon: User, color: '#f59e0b' },
            ai_assistant: { name: 'Gradient AI', icon: Sparkles, color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)' },
            designer: { name: '设计师', icon: User, color: '#14b8a6' },
        },
        script: [
            { id: 1, role: 'user', content: '新品「樱花拿铁」需要一个 Slogan，主打春日限定！', delay: 500 },
            { id: 2, role: 'ai_assistant', content: '分析了近三年春季饮品爆款文案，高频词：「浪漫」「邂逅」「粉色治愈」「初恋」', delay: 2200, tool: 'search' },
            { id: 3, role: 'creative', content: '这个怎么样：「一口樱花，邂逅你的春日浪漫」', delay: 3600 },
            { id: 4, role: 'ai_assistant', content: 'A/B 测试模拟显示点击率比去年提升 25%！已生成 3 版海报草图供选择。', delay: 5200, tool: 'analyze' },
            { id: 5, role: 'designer', content: '第二版不错，但背景能换成京都樱花道吗？', delay: 6600 },
            { id: 6, role: 'ai_assistant', content: '已重新生成，添加了京都岚山的樱花隧道元素，保持了品牌色调一致性。', delay: 8200, tool: 'analyze' },
            { id: 7, role: 'user', content: '完美！直接发给运营排期吧。', delay: 9600 },
        ]
    },
    {
        id: 'coding',
        name: "代码调试",
        icon: Code,
        agents: {
            user: { name: '麦克', icon: User, color: '#06b6d4' },
            senior: { name: '技术主管', icon: User, color: '#475569' },
            ai_assistant: { name: 'Gradient AI', icon: Sparkles, color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)' },
            qa: { name: 'QA 工程师', icon: User, color: '#eab308' },
        },
        script: [
            { id: 1, role: 'user', content: '生产环境崩了！RecursionError: maximum recursion depth exceeded', delay: 500 },
            { id: 2, role: 'ai_assistant', content: '检测到堆栈溢出。分析最近 3 次提交，定位到 utils.py 的 parse_tree 函数。', delay: 2200, tool: 'analyze' },
            { id: 3, role: 'senior', content: '是不是基准条件没写对？', delay: 3600 },
            { id: 4, role: 'ai_assistant', content: '是的，第 42 行缺少空节点判断。已生成修复补丁并添加了边界测试用例。', delay: 5200, tool: 'rag' },
            { id: 5, role: 'qa', content: '我来跑一下回归测试，稍等...', delay: 6600 },
            { id: 6, role: 'ai_assistant', content: '已在沙箱环境预跑测试，全部 147 个用例通过，无副作用。', delay: 8200, tool: 'analyze' },
            { id: 7, role: 'user', content: '太强了，直接提 PR！@技术主管 帮忙 review 一下。', delay: 9600 },
        ]
    },
    {
        id: 'travel',
        name: "旅行规划",
        icon: Plane,
        agents: {
            user: { name: '麦克', icon: User, color: '#f97316' },
            friend: { name: '艾米', icon: User, color: '#ec4899' },
            ai_assistant: { name: 'Gradient AI', icon: Sparkles, color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)' },
            friend2: { name: '汤姆', icon: User, color: '#22c55e' },
        },
        script: [
            { id: 1, role: 'user', content: '五一假期想去京都，大家有推荐吗？', delay: 500 },
            { id: 2, role: 'ai_assistant', content: '记得艾米去年去过清水寺，评价很高。麦克你喜欢摄影，推荐伏见稻荷大社的千本鸟居！', delay: 2200, tool: 'rag' },
            { id: 3, role: 'friend', content: '哇 AI 记性真好！清水寺夕阳超美，强烈推荐！', delay: 3600 },
            { id: 4, role: 'friend2', content: '我想去吃怀石料理，有推荐的餐厅吗？', delay: 5000 },
            { id: 5, role: 'ai_assistant', content: '已生成「摄影+美食」5 天行程，包含 3 家米其林餐厅预订建议和最佳拍摄时间。', delay: 6600, tool: 'search' },
            { id: 6, role: 'user', content: '帮我看看机票，要直飞的！', delay: 8000 },
            { id: 7, role: 'ai_assistant', content: '国航 CA921 最合适，现在预订 8 折优惠。已同步到群日历，需要我帮忙预订吗？', delay: 9600, tool: 'search' },
        ]
    }
];

const ToolIcon: React.FC<{ tool: string }> = ({ tool }) => {
    const icons: Record<string, any> = {
        search: Search,
        rag: Database,
        analyze: Zap,
    };
    const Icon = icons[tool];
    return Icon ? <Icon size={10} /> : null;
};

export const SimulatedChat: React.FC = () => {
    const [scenarioIndex, setScenarioIndex] = useState(0);
    const [visibleMessages, setVisibleMessages] = useState<Message[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const [activeTool, setActiveTool] = useState<string | null>(null);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const chatContainerRef = React.useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTo({
                top: chatContainerRef.current.scrollHeight,
                behavior: "smooth"
            });
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [visibleMessages, isTyping]);

    const currentScenario = SCENARIOS[scenarioIndex];
    const onlineCount = Object.keys(currentScenario.agents).length;

    const switchScenario = useCallback((index: number) => {
        setScenarioIndex(index);
        setVisibleMessages([]);
        setIsTyping(false);
        setActiveTool(null);
        setIsAutoPlaying(true);
    }, []);

    useEffect(() => {
        let timeouts: ReturnType<typeof setTimeout>[] = [];

        const playScript = () => {
            setVisibleMessages([]);
            setActiveTool(null);

            currentScenario.script.forEach((msg, index) => {
                const typingDelay = msg.delay - 1000;
                if (typingDelay > 0 && msg.role === 'ai_assistant') {
                    timeouts.push(setTimeout(() => {
                        setIsTyping(true);
                        if (msg.tool) setActiveTool(msg.tool);
                    }, typingDelay));
                }

                timeouts.push(setTimeout(() => {
                    setIsTyping(false);
                    setActiveTool(null);
                    setVisibleMessages(prev => [...prev, msg]);

                    if (index === currentScenario.script.length - 1 && isAutoPlaying) {
                        timeouts.push(setTimeout(() => {
                            setScenarioIndex(prev => (prev + 1) % SCENARIOS.length);
                        }, 4000));
                    }
                }, msg.delay));
            });
        };

        playScript();
        return () => timeouts.forEach(clearTimeout);
    }, [scenarioIndex, isAutoPlaying]);

    return (
        <div className="simulated-chat-card">
            {/* Tab Bar */}
            <div className="tab-bar">
                {SCENARIOS.map((scenario, idx) => {
                    const TabIcon = scenario.icon;
                    return (
                        <motion.button
                            key={scenario.id}
                            className={`tab-item ${idx === scenarioIndex ? 'active' : ''}`}
                            onClick={() => switchScenario(idx)}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <TabIcon size={14} />
                            <span>{scenario.name}</span>
                        </motion.button>
                    );
                })}
            </div>

            {/* Header */}
            <div className="chat-header">
                <div className="header-left">
                    <div className="window-controls">
                        <div className="dot red" />
                        <div className="dot yellow" />
                        <div className="dot green" />
                    </div>
                </div>
                <div className="header-center">
                    <AnimatePresence mode="wait">
                        <motion.span
                            key={scenarioIndex}
                            className="chat-title"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                        >
                            {currentScenario.name}
                        </motion.span>
                    </AnimatePresence>
                </div>
                <div className="header-right">
                    <div className="online-indicator">
                        <Users size={12} />
                        <span>{onlineCount}</span>
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="chat-messages" ref={chatContainerRef}>
                <AnimatePresence mode="popLayout">
                    {visibleMessages.map((msg) => {
                        const config = currentScenario.agents[msg.role];
                        if (!config) return null;

                        const Icon = config.icon;
                        const isAI = msg.role === 'ai_assistant';
                        const isUser = msg.role === 'user';

                        return (
                            <motion.div
                                key={`${scenarioIndex}-${msg.id}`}
                                className={`message-row ${isUser ? 'user-row' : 'agent-row'}`}
                                initial={{ opacity: 0, y: 15, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                layout
                            >
                                {!isUser && (
                                    <motion.div
                                        className="avatar"
                                        style={{ background: config.gradient || config.color }}
                                        whileHover={{ scale: 1.1 }}
                                    >
                                        <Icon size={12} color="white" />
                                        {isAI && <div className="ai-ring" />}
                                    </motion.div>
                                )}
                                <div className={`message-bubble ${isUser ? 'user-bubble' : isAI ? 'ai-bubble' : 'agent-bubble'}`}>
                                    {!isUser && (
                                        <div className="bubble-header">
                                            <span className="agent-name" style={{ color: config.color }}>{config.name}</span>
                                            {msg.tool && (
                                                <span className="tool-badge">
                                                    <ToolIcon tool={msg.tool} />
                                                    {msg.tool === 'search' ? '搜索' : msg.tool === 'rag' ? '记忆' : '分析'}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <div className="message-content">{msg.content}</div>
                                </div>
                                {isUser && (
                                    <motion.div
                                        className="avatar"
                                        style={{ background: config.color }}
                                        whileHover={{ scale: 1.1 }}
                                    >
                                        <Icon size={12} color="white" />
                                    </motion.div>
                                )}
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {/* Typing indicator */}
                <AnimatePresence>
                    {isTyping && (
                        <motion.div
                            className="message-row agent-row"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                        >
                            <div className="avatar ai-avatar">
                                <Sparkles size={12} color="white" />
                                <div className="ai-ring" />
                            </div>
                            <div className="typing-bubble">
                                {activeTool && (
                                    <span className="typing-tool">
                                        <ToolIcon tool={activeTool} />
                                        {activeTool === 'search' ? '正在搜索...' : activeTool === 'rag' ? '正在检索记忆...' : '正在分析...'}
                                    </span>
                                )}
                                <div className="typing-dots">
                                    <span /><span /><span />
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <style>{`
                .simulated-chat-card {
                    width: 100%;
                    max-width: 450px;
                    min-height: 0;
                    box-sizing: border-box;
                    background: linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.5) 100%);
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(255, 255, 255, 0.5);
                    border-radius: 20px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    box-shadow:
                        0 20px 40px -10px rgba(0,0,0,0.1),
                        0 0 0 1px rgba(255,255,255,0.2) inset;
                    font-family: 'Inter', sans-serif;
                }

                .tab-bar {
                    display: flex;
                    gap: 4px;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.5);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.3);
                    overflow-x: auto;
                    scrollbar-width: none;
                    flex-shrink: 0;
                }

                .tab-bar::-webkit-scrollbar {
                    display: none;
                }

                .tab-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    border-radius: 10px;
                    font-size: 0.75rem;
                    font-weight: 500;
                    color: #64748b;
                    background: transparent;
                    border: 1px solid transparent;
                    cursor: pointer;
                    white-space: nowrap;
                    transition: all 0.2s;
                }

                .tab-item:hover {
                    background: rgba(139, 92, 246, 0.08);
                    color: #8b5cf6;
                }

                .tab-item.active {
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(99, 102, 241, 0.1));
                    color: #8b5cf6;
                    border-color: rgba(139, 92, 246, 0.3);
                    font-weight: 600;
                }

                .chat-header {
                    padding: 10px 16px;
                    background: rgba(255, 255, 255, 0.3);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    flex-shrink: 0;
                }

                .header-left, .header-right {
                    flex: 1;
                }

                .header-center {
                    flex: 2;
                    text-align: center;
                }

                .header-right {
                    display: flex;
                    justify-content: flex-end;
                }

                .window-controls {
                    display: flex;
                    gap: 6px;
                }

                .dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    transition: transform 0.2s;
                }
                .dot:hover { transform: scale(1.2); }
                .red { background: #ff5f56; }
                .yellow { background: #ffbd2e; }
                .green { background: #27c93f; }

                .chat-title {
                    font-size: 0.8rem;
                    color: #475569;
                    font-weight: 600;
                }

                .online-indicator {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 0.7rem;
                    color: #10b981;
                    background: rgba(16, 185, 129, 0.1);
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-weight: 500;
                }

                .chat-messages {
                    flex: 1;
                    min-height: 0;
                    padding: 14px;
                    overflow-y: auto;
                    overflow-x: hidden;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .message-row {
                    display: flex;
                    gap: 8px;
                    align-items: flex-end;
                    width: 100%;
                    flex-shrink: 0;
                }

                .user-row {
                    justify-content: flex-end;
                }

                .avatar {
                    width: 26px;
                    height: 26px;
                    border-radius: 9px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                    position: relative;
                    cursor: pointer;
                }

                .ai-avatar {
                    background: linear-gradient(135deg, #8b5cf6, #6366f1);
                }

                .ai-ring {
                    position: absolute;
                    inset: -3px;
                    border-radius: 11px;
                    border: 2px solid rgba(139, 92, 246, 0.3);
                    animation: pulse-ring 2s infinite;
                }

                @keyframes pulse-ring {
                    0%, 100% { opacity: 0.5; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.05); }
                }

                .message-bubble {
                    padding: 8px 12px;
                    border-radius: 14px;
                    font-size: 0.8rem;
                    line-height: 1.45;
                    max-width: 82%;
                    position: relative;
                }

                .user-bubble {
                    background: linear-gradient(135deg, #3b82f6, #2563eb);
                    color: white;
                    border-bottom-right-radius: 5px;
                    box-shadow: 0 2px 10px rgba(59, 130, 246, 0.3);
                }

                .agent-bubble {
                    background: rgba(255, 255, 255, 0.9);
                    color: #1e293b;
                    border-bottom-left-radius: 5px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                }

                .ai-bubble {
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(99, 102, 241, 0.05));
                    border: 1px solid rgba(139, 92, 246, 0.2);
                    color: #1e293b;
                    border-bottom-left-radius: 5px;
                }

                .bubble-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 3px;
                }

                .agent-name {
                    font-size: 0.65rem;
                    font-weight: 700;
                }

                .tool-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    font-size: 0.55rem;
                    color: #8b5cf6;
                    background: rgba(139, 92, 246, 0.1);
                    padding: 2px 5px;
                    border-radius: 5px;
                    font-weight: 500;
                }

                .message-content {
                    white-space: pre-wrap;
                }

                .typing-bubble {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                    padding: 8px 12px;
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(99, 102, 241, 0.05));
                    border: 1px solid rgba(139, 92, 246, 0.2);
                    border-radius: 14px;
                    border-bottom-left-radius: 5px;
                }

                .typing-tool {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 0.65rem;
                    color: #8b5cf6;
                    font-weight: 500;
                }

                .typing-dots {
                    display: flex;
                    gap: 4px;
                }

                .typing-dots span {
                    width: 5px;
                    height: 5px;
                    background: #8b5cf6;
                    border-radius: 50%;
                    animation: bounce 1.4s infinite ease-in-out both;
                }

                .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
                .typing-dots span:nth-child(2) { animation-delay: -0.16s; }

                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
                    40% { transform: scale(1); opacity: 1; }
                }

                /* 响应式适配 */
                @media (max-width: 1200px) {
                    .simulated-chat-card {
                        max-width: 400px;
                    }
                }

                @media (max-width: 1024px) {
                    .simulated-chat-card {
                        max-width: 100%;
                        min-height: 350px;
                    }

                    .message-bubble {
                        font-size: 0.78rem;
                    }

                    .chat-messages {
                        padding: 10px;
                        gap: 8px;
                    }

                    .tab-item {
                        padding: 5px 10px;
                        font-size: 0.7rem;
                    }

                    .tab-item span {
                        display: none;
                    }
                }

                @media (max-width: 480px) {
                    .tab-bar {
                        padding: 8px 10px;
                    }

                    .tab-item {
                        padding: 6px 10px;
                    }

                    .tab-item span {
                        display: inline;
                    }
                }
            `}</style>
        </div>
    );
};
