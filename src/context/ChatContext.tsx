import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { Agent, ChatState, Message, User, Reaction } from '../types/chat';

const INITIAL_STATE: ChatState = {
    currentUser: null,
    users: [],
    agents: [],
    messages: [],
    typingUsers: [],
    replyingTo: undefined,
    authStatus: 'loading',
};

type Action =
    | { type: 'HYDRATE'; payload: { currentUser: User; users: User[]; messages: Message[]; agents?: Agent[] } }
    | { type: 'SET_AUTH_STATUS'; payload: ChatState['authStatus'] }
    | { type: 'LOGOUT' }
    | { type: 'SET_USERS'; payload: User[] }
    | { type: 'SET_AGENTS'; payload: Agent[] }
    | { type: 'SET_MESSAGES'; payload: Message[] }
    | { type: 'UPSERT_MESSAGES'; payload: Message[] }
    | { type: 'SEND_MESSAGE'; payload: Message }
    | { type: 'ADD_REACTION'; payload: { messageId: string; reaction: Reaction } }
    | { type: 'UPDATE_MESSAGE'; payload: Message }
    | { type: 'DELETE_MESSAGE'; payload: { id: string } }
    | { type: 'SET_REPLYING_TO'; payload: Message | undefined }
    | { type: 'SET_TYPING'; payload: { userId: string; isTyping: boolean } }
    | { type: 'SET_TYPING_USERS'; payload: string[] };

const mergeUsers = (users: User[]) => {
    const map = new Map<string, User>();
    users.forEach((u) => map.set(u.id, u));
    return Array.from(map.values());
};

const mergeMessages = (existing: Message[], incoming: Message[]) => {
    const map = new Map<string, Message>();
    existing.forEach((msg) => map.set(msg.id, msg));
    incoming.forEach((msg) => map.set(msg.id, msg));
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
};

const chatReducer = (state: ChatState, action: Action): ChatState => {
    switch (action.type) {
        case 'HYDRATE': {
            return {
                ...state,
                currentUser: action.payload.currentUser,
                users: mergeUsers(action.payload.users),
                agents: action.payload.agents ?? [],
                messages: action.payload.messages,
                authStatus: 'authenticated',
            };
        }
        case 'SET_AUTH_STATUS':
            return { ...state, authStatus: action.payload };
        case 'LOGOUT':
            return { ...INITIAL_STATE, authStatus: 'unauthenticated' };
        case 'SET_USERS':
            return { ...state, users: mergeUsers([...state.users, ...action.payload]) };
        case 'SET_AGENTS':
            return { ...state, agents: action.payload };
        case 'SET_MESSAGES':
            return { ...state, messages: mergeMessages([], action.payload) };
        case 'UPSERT_MESSAGES':
            return { ...state, messages: mergeMessages(state.messages, action.payload) };
        case 'SEND_MESSAGE':
            return { ...state, messages: [...state.messages, action.payload] };
        case 'ADD_REACTION': {
            const currentUserId = state.currentUser?.id;
            if (!currentUserId) return state;
            return {
                ...state,
                messages: state.messages.map((msg) => {
                    if (msg.id !== action.payload.messageId) return msg;

                    const existingReactionIndex = msg.reactions.findIndex((r) => r.emoji === action.payload.reaction.emoji);
                    const newReactions = [...msg.reactions];

                    if (existingReactionIndex >= 0) {
                        const existing = newReactions[existingReactionIndex];
                        if (existing.userIds.includes(currentUserId)) {
                            // Toggle off: Remove user
                            const newUserIds = existing.userIds.filter((id) => id !== currentUserId);
                            if (newUserIds.length === 0) {
                                // Remove reaction entirely if no users left
                                newReactions.splice(existingReactionIndex, 1);
                            } else {
                                newReactions[existingReactionIndex] = {
                                    ...existing,
                                    count: existing.count - 1,
                                    userIds: newUserIds,
                                };
                            }
                        } else {
                            // Add user to existing reaction
                            newReactions[existingReactionIndex] = {
                                ...existing,
                                count: existing.count + 1,
                                userIds: [...existing.userIds, currentUserId],
                            };
                        }
                    } else {
                        newReactions.push(action.payload.reaction);
                    }
                    return { ...msg, reactions: newReactions };
                }),
            };
        }
        case 'UPDATE_MESSAGE': {
            const exists = state.messages.some((msg) => msg.id === action.payload.id);
            const messages = exists
                ? state.messages.map((msg) => (msg.id === action.payload.id ? action.payload : msg))
                : [...state.messages, action.payload];
            return { ...state, messages };
        }
        case 'DELETE_MESSAGE': {
            const messages = state.messages.filter((msg) => msg.id !== action.payload.id);
            const replyingTo = state.replyingTo?.id === action.payload.id ? undefined : state.replyingTo;
            return { ...state, messages, replyingTo };
        }
        case 'SET_REPLYING_TO':
            return { ...state, replyingTo: action.payload };
        case 'SET_TYPING': {
            const { userId, isTyping } = action.payload;
            const existing = new Set(state.typingUsers);

            if (isTyping) {
                existing.add(userId);
            } else {
                existing.delete(userId);
            }

            return { ...state, typingUsers: Array.from(existing) };
        }
        case 'SET_TYPING_USERS':
            return { ...state, typingUsers: [...action.payload] };
        default:
            return state;
    }
};

// Context
interface ChatContextType {
    state: ChatState;
    dispatch: React.Dispatch<Action>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider = ({ children }: { children: ReactNode }) => {
    const [state, dispatch] = useReducer(chatReducer, INITIAL_STATE);

    return <ChatContext.Provider value={{ state, dispatch }}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
    const context = useContext(ChatContext);
    if (!context) throw new Error('useChat must be used within a ChatProvider');
    return context;
};
