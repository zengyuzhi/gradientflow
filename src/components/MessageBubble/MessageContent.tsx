import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { User } from '../../types/chat';
import './styles.css';

interface MessageContentProps {
    content: string;
    users: User[];
}

export const MessageContent: React.FC<MessageContentProps> = ({ content, users }) => {
    const processedContent = useMemo(() => {
        return content.replace(/@(\w+)/g, (match, username) => {
            const user = users.find(u =>
                u.name.toLowerCase() === username.toLowerCase() ||
                u.id === username
            );
            return user ? `[@${username}](mention://${user.id})` : match;
        });
    }, [content, users]);

    return (
        <div className="bubble-text markdown-content">
            <ReactMarkdown
                components={{
                    a: ({ node, href, children, ...props }) => {
                        if (href?.startsWith('mention://')) {
                            const userId = href.replace('mention://', '');
                            const user = users.find(u => u.id === userId);
                            return (
                                <span
                                    className="mention-highlight"
                                    title={user ? `@${user.name}` : undefined}
                                >
                                    {children}
                                </span>
                            );
                        }
                        return <a href={href} {...props}>{children}</a>;
                    },
                    p: ({ children }) => <p style={{ margin: 0 }}>{children}</p>
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
};
