import { useCallback, useEffect, useState } from 'react';
import { ChatProvider, useChat } from './context/ChatContext';
import { Layout } from './components/Layout';
import { MessageList } from './components/MessageList';
import { MessageInput } from './components/MessageInput';
import { useLLM } from './hooks/useLLM';
import { api } from './api/client';
import { DEFAULT_CONVERSATION_ID, User } from './types/chat';
import { AuthScreen } from './components/AuthScreen';

const mergeUsers = (users: User[]) => {
    const map = new Map<string, User>();
    users.forEach((u) => map.set(u.id, u));
    return Array.from(map.values());
};

const LoadingScreen = ({ text, error, onRetry }: { text: string; error?: string | null; onRetry?: () => void }) => (
    <div className="loading-screen">
        <div className="spinner" />
        <div>{text}</div>
        {error && <div className="error">{error}</div>}
        {onRetry && (
            <button className="retry-btn" onClick={onRetry}>
                重试
            </button>
        )}
        <style>{`
            .loading-screen {
                display: flex;
                flex-direction: column;
                gap: 8px;
                align-items: center;
                justify-content: center;
                height: 100vh;
                color: var(--text-secondary);
            }
            .spinner {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: 4px solid #e5e7eb;
                border-top-color: var(--accent-primary);
                animation: spin 1s linear infinite;
            }
            .error {
                color: #b91c1c;
            }
            .retry-btn {
                padding: 8px 12px;
                border-radius: 10px;
                border: 1px solid var(--border-light);
                background: var(--bg-secondary);
                cursor: pointer;
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `}</style>
    </div>
);

const ChatApp = () => {
    useLLM(); // Initialize LLM listener

    return (
        <Layout>
            <MessageList />
            <MessageInput />
        </Layout>
    );
};

const AppShell = () => {
    const { state, dispatch } = useChat();
    const [error, setError] = useState<string | null>(null);

    const bootstrap = useCallback(async () => {
        dispatch({ type: 'SET_AUTH_STATUS', payload: 'loading' });
        setError(null);
        try {
            const me = await api.auth.me();
            const [{ users }, { messages, users: messageUsers }] = await Promise.all([
                api.users.list(),
                api.messages.list({ limit: 100, conversationId: DEFAULT_CONVERSATION_ID }),
            ]);
            const allUsers = mergeUsers([...users, ...messageUsers, me.user]);
            dispatch({
                type: 'HYDRATE',
                payload: { currentUser: me.user, users: allUsers, messages },
            });
        } catch (err: any) {
            console.error('Bootstrap failed', err);
            setError(err?.message || 'Failed to load session');
            dispatch({ type: 'SET_AUTH_STATUS', payload: 'unauthenticated' });
        }
    }, [dispatch]);

    useEffect(() => {
        bootstrap();
    }, [bootstrap]);

    useEffect(() => {
        if (state.authStatus !== 'authenticated') return;
        let cancelled = false;
        const pollMessages = async () => {
            try {
                const res = await api.messages.list({ limit: 100, conversationId: DEFAULT_CONVERSATION_ID });
                if (!cancelled) {
                    dispatch({ type: 'SET_MESSAGES', payload: res.messages });
                    dispatch({ type: 'SET_USERS', payload: res.users });
                }
            } catch (err) {
                console.error('message poll failed', err);
            }
        };
        pollMessages();
        const id = setInterval(pollMessages, 4000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [dispatch, state.authStatus]);

    useEffect(() => {
        if (state.authStatus !== 'authenticated' || !state.currentUser) return;
        let cancelled = false;
        const fetchTyping = async () => {
            try {
                const res = await api.typing.list();
                if (!cancelled) {
                    dispatch({ type: 'SET_TYPING_USERS', payload: res.typingUsers });
                }
            } catch (err) {
                console.error('typing poll failed', err);
            }
        };
        fetchTyping();
        const id = setInterval(fetchTyping, 2500);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [dispatch, state.authStatus, state.currentUser]);

    const showAuth = state.authStatus === 'unauthenticated';
    const loading = state.authStatus === 'loading';

    if (loading) {
        return <LoadingScreen text="Loading session..." error={error} onRetry={bootstrap} />;
    }

    if (showAuth) {
        return <AuthScreen onAuthenticated={bootstrap} error={error ?? undefined} />;
    }

    if (!state.currentUser) {
        return <LoadingScreen text="No user in session" onRetry={bootstrap} />;
    }

    return <ChatApp />;
};

function App() {
    return (
        <ChatProvider>
            <AppShell />
        </ChatProvider>
    );
}

export default App;
