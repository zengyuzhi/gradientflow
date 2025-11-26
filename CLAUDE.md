# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Active LLM Group Chat application - a React + TypeScript frontend with an Express + lowdb backend. It features a modern chat interface similar to Telegram/Discord with LLM bot integration, user authentication, persistent messages, reactions, replies, and typing indicators.

## Development Commands

### Frontend (React + Vite)
```bash
npm run dev          # Start Vite dev server at http://localhost:5173
npm run build        # Build for production (TypeScript check + Vite build)
npm run preview      # Preview production build
npm run lint         # Run ESLint (TypeScript/React)
```

### Backend (Express Server)
```bash
npm run server       # Start Express API at http://localhost:4000
```

### Testing
```bash
npm run test         # Run tests with Vitest
```

### Environment Variables
- Frontend: `VITE_API_URL` - API URL (default: http://localhost:4000)
- Backend:
  - `PORT` - API port (default: 4000)
  - `CLIENT_ORIGIN` - Allowed origins (comma-separated)
  - `JWT_SECRET` - JWT signing secret (critical for security)
  - `DB_PATH` - lowdb JSON path (default: server/data.json)

## Architecture & Key Patterns

### Frontend Architecture
- **State Management**: Centralized via `ChatContext` (React Context + useReducer)
- **API Communication**: All HTTP calls through `src/api/client.ts`
- **Component Structure**:
  - `src/components/` - UI components (MessageBubble/, Sidebar, etc.)
  - `src/hooks/` - Custom hooks (useLLM, useNetworkStatus)
  - `src/types/` - TypeScript types shared between frontend/backend
- **Message Rendering**: Uses react-virtuoso for virtualized scrolling (performance)
- **Real-time Updates**: Polling-based (messages every ~4s, typing every ~2.5s)

### Backend Architecture
- **Stack**: Express + lowdb (JSON file storage)
- **Authentication**: JWT-based (httpOnly cookies + Bearer token fallback)
- **Data Storage**: `server/data.json` (delete to reset)
- **API Routes**:
  - Auth: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`
  - Messages: `GET/POST /messages`
  - Users: `GET /users`
  - Typing: `GET/POST /typing`
  - Agents: `GET/POST/PUT/DELETE /agents/:id`

### Key Type Definitions (src/types/chat.ts)
- `User`: Includes type (human/agent/system), agentId for AI users
- `Agent`: Complete agent configuration with capabilities, model, runtime
- `Message`: Includes role, conversationId, status, reactions, mentions
- `ChatState`: Global state shape for the chat context

## Agent System

The application supports AI agents that act as chat participants:
- Agents have capabilities: `answer_active`, `answer_passive`, `like`, `summarize`
- Each agent has its own User entity with `type: 'agent'`
- Agent configuration includes model settings, system prompt, and runtime config
- LLM behavior currently simulated client-side in `useLLM.ts` (ready for real integration)

## Important Implementation Notes

1. **Message Virtualization**: MessageList uses react-virtuoso for performance with large message histories
2. **Markdown Support**: Messages support full Markdown rendering via react-markdown
3. **Typing Indicators**: Implemented via polling with TTL cleanup on server
4. **Reply System**: Messages can reference other messages via `replyToId`
5. **Reaction System**: Aggregated reactions with user tracking
6. **Error Boundaries**: Implemented to catch and display render errors gracefully
7. **Network Status**: Monitors online/offline state with banner notification

## Development Guidelines

1. **Code Style**: Follow existing React + TypeScript patterns, use existing utilities
2. **Component Creation**: Check existing components first, follow naming conventions
3. **API Changes**: Maintain backward compatibility, update types in both frontend/backend
4. **State Updates**: Use ChatContext actions, avoid direct state manipulation
5. **Performance**: Consider virtualization for lists, memoization for expensive operations
6. **Security**: Never commit secrets, use environment variables for sensitive data

## Testing Credentials (Development Only)
- Admin account: root@example.com / 1234567890

## Data Reset
To reset the application data:
1. Stop the server
2. Delete `server/data.json`
3. Restart the server (will recreate with default data)

## Current Focus Areas
- Implementing real LLM integration (replacing client-side simulation)
- Agent management UI and configuration
- Enhanced message features (edit history, status tracking)
- Performance optimizations for large chat histories