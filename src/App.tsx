import { useCallback, useEffect, useRef, useState } from 'react';
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
    const lastFetchedTimestampRef = useRef(0);
    const lastFullSyncRef = useRef(0);
    const knownUserIdsRef = useRef<Set<string>>(new Set());

    const updateLastFetchedTimestamp = useCallback((messages: { timestamp: number }[]) => {
        if (!messages.length) return;
        const latestTimestamp = messages[messages.length - 1].timestamp;
        lastFetchedTimestampRef.current = Math.max(lastFetchedTimestampRef.current, latestTimestamp);
    }, []);

    const bootstrap = useCallback(async () => {
        dispatch({ type: 'SET_AUTH_STATUS', payload: 'loading' });
        setError(null);
        try {
            const me = await api.auth.me();
            const [{ users }, { messages, users: messageUsers }] = await Promise.all([
                api.users.list(),
                api.messages.list({ limit: 100, conversationId: DEFAULT_CONVERSATION_ID }),
            ]);
            lastFetchedTimestampRef.current = 0;
            const allUsers = mergeUsers([...users, ...messageUsers, me.user]);
            knownUserIdsRef.current = new Set(allUsers.map((u) => u.id));
            updateLastFetchedTimestamp(messages);
            dispatch({
                type: 'HYDRATE',
                payload: { currentUser: me.user, users: allUsers, messages },
            });
        } catch (err: any) {
            console.error('Bootstrap failed', err);
            setError(err?.message || 'Failed to load session');
            dispatch({ type: 'SET_AUTH_STATUS', payload: 'unauthenticated' });
        }
    }, [dispatch, updateLastFetchedTimestamp]);

    useEffect(() => {
        bootstrap();
    }, [bootstrap]);

    useEffect(() => {
        if (state.authStatus !== 'authenticated') return;
        let cancelled = false;
        const pollMessages = async () => {
            try {
                const now = Date.now();
                const shouldFullSync = now - lastFullSyncRef.current > 30000 || !lastFetchedTimestampRef.current;

                const res = await api.messages.list({
                    limit: 100,
                    conversationId: DEFAULT_CONVERSATION_ID,
                    ...(shouldFullSync ? {} : { since: lastFetchedTimestampRef.current || undefined }),
                });
                if (!cancelled) {
                    if (res.messages.length) {
                        updateLastFetchedTimestamp(res.messages);
                        if (shouldFullSync) {
                            lastFullSyncRef.current = now;
                            dispatch({ type: 'SET_MESSAGES', payload: res.messages });
                        } else {
                            dispatch({ type: 'UPSERT_MESSAGES', payload: res.messages });
                        }
                    } else if (shouldFullSync) {
                        // No new messages, but we still want to reconcile deletions during a full sync
                        dispatch({ type: 'SET_MESSAGES', payload: res.messages });
                        lastFullSyncRef.current = now;
                    } else {
                        // Incremental fetch returned no updates; perform a lightweight reconciliation to drop
                        // messages that may have been deleted on the server.
                        const snapshot = await api.messages.list({
                            limit: 100,
                            conversationId: DEFAULT_CONVERSATION_ID,
                        });
                        if (!cancelled) {
                            lastFullSyncRef.current = now;
                            updateLastFetchedTimestamp(snapshot.messages);
                            dispatch({ type: 'SET_MESSAGES', payload: snapshot.messages });
                            if (snapshot.users.length) {
                                const newUsers = snapshot.users.filter((u) => !knownUserIdsRef.current.has(u.id));
                                if (newUsers.length) {
                                    newUsers.forEach((u) => knownUserIdsRef.current.add(u.id));
                                    dispatch({ type: 'SET_USERS', payload: newUsers });
                                }
                            }
                        }
                    }
                    if (res.users.length) {
                        const newUsers = res.users.filter((u) => !knownUserIdsRef.current.has(u.id));
                        if (newUsers.length) {
                            newUsers.forEach((u) => knownUserIdsRef.current.add(u.id));
                            dispatch({ type: 'SET_USERS', payload: newUsers });
                        }
                    }
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
    }, [dispatch, state.authStatus, updateLastFetchedTimestamp]);

    useEffect(() => {
        if (!state.users.length) return;
        knownUserIdsRef.current = new Set(state.users.map((u) => u.id));
    }, [state.users]);

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
