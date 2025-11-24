import { useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { DEFAULT_CONVERSATION_ID } from '../types/chat';

export const useLLM = () => {
    const { state, dispatch } = useChat();

    useEffect(() => {
        if (!state.currentUser) return;
        const lastMessage = state.messages[state.messages.length - 1];
        if (!lastMessage) return;

        // Only respond if the last message is NOT from the LLM and mentions the LLM or is a general trigger
        // For this mock, we assume the LLM user ID is 'llm1'
        const llmId = 'llm1';

        if (lastMessage.senderId !== llmId) {
            // Reaction Logic: 40% chance to react


            const mentionsLLM = lastMessage.content.includes('@GPT-4') || lastMessage.content.toLowerCase().includes('gpt');

            if (mentionsLLM) {
                // Simulate "Typing" (could add typing state later)

                const timeoutId = setTimeout(() => {
                    const responses = [
                        "I'm just a simulated AI, but I think that's a great idea!",
                        "Could you elaborate on that?",
                        "I can help you with code, writing, or analysis. Just ask!",
                        "That's interesting. Tell me more.",
                        "I've noted that down.",
                        "As an AI language model, I don't have feelings, but I understand the sentiment.",
                        "Interesting point! 🤔",
                        "I agree with you.",
                        "Let me think about that..."
                    ];
                    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

                    dispatch({
                        type: 'SEND_MESSAGE',
                        payload: {
                            id: Date.now().toString(),
                            content: randomResponse,
                            senderId: llmId,
                            timestamp: Date.now(),
                            reactions: [],
                            conversationId: DEFAULT_CONVERSATION_ID,
                            role: 'assistant',
                            metadata: { model: 'mock-llm', parentMessageId: lastMessage.id },
                            replyToId: lastMessage.id, // Auto-reply to the message
                            mentions: lastMessage.senderId ? [lastMessage.senderId] : [],
                        },
                    });
                }, 2000); // 2 second delay

                return () => clearTimeout(timeoutId);
            }
        }
    }, [state.messages, dispatch]);
};
