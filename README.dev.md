# Active LLM Group Chat - Developer Notes

This document focuses on architecture, data contracts, and recommended workflows for extending the project. Use it as the companion reference to the public README.

---

## 1. Project layout & key dependencies
- `src/`: React + TypeScript + Vite frontend
  - `api/`: API client wrappers (see `src/api/client.ts`); keep HTTP+JSON details here, not inside components.
  - `components/`: UI building blocks.
    - `MessageBubble/`: Decomposed message components (`MessageContent`, `ReactionList`, etc.).
    - `ErrorBoundary.tsx`: React error boundary for catching UI crashes.
    - `AuthScreen`, `Sidebar`, `MessageList`, `MessageInput`, `Layout`, etc.
  - `context/ChatContext.tsx`: global reducer + provider, owns cross-cutting chat state.
  - `hooks/`:
    - `useLLM.ts`: frontend LLM simulation logic (reaction + auto-reply).
    - `useNetworkStatus.ts`: monitors online/offline state.
  - `types/`: shared TS models (`User`, `Message`, etc.) that mirror backend payloads.
- `server/`: Express + lowdb backend
  - `server.js`: API entry point, routes, and lowdb wiring.
  - `data.json`: default persisted data (users/messages/typing); safe to delete in local dev to reset.
- Scripts: `npm run dev`, `npm run server`, `npm run build`, `npm run preview`, `npm run lint`
- Major deps: React 18, TypeScript, Vite, framer-motion, lucide-react, clsx, Express, lowdb, bcryptjs, jsonwebtoken, cookie-parser, cors, **react-virtuoso**, **react-markdown**, **react-hot-toast**, **dayjs**

---

## 2. State model (`src/types/chat.ts`)
```ts
export interface User {
  id: string;
  name: string;
  avatar: string;
  isLLM: boolean;
  status: 'online' | 'offline' | 'busy';
  email?: string;
  createdAt?: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  timestamp: number;
  reactions: Reaction[];
  replyToId?: string;
  mentions?: string[];
}

export interface ChatState {
  currentUser: User | null;
  users: User[];
  messages: Message[];
  typingUsers: string[];
  replyingTo?: Message;
  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
}
```

---

## 3. Frontend workflow
- **Auth & bootstrap (`src/App.tsx`)**
  - call `/auth/me` when mounting; if successful, fetch `/users` + `/messages` and dispatch `HYDRATE`
  - failure drops the app into `AuthScreen`
- **Polling**
  - messages: fetch `/messages` every ~4s, merge+dedupe into state, backfill newly discovered users
  - typing: poll `/typing` every ~2.5s and update `typingUsers`
- **Sending input (`MessageInput.tsx`)**
  - textarea autogrows, `Enter` sends, `Shift+Enter` inserts newline
  - lightweight mention suggestions are computed from the current input (not persisted)
  - `POST /messages` on submit, then dispatch `SEND_MESSAGE`; API response may include updated users -> `SET_USERS`
  - typing indicator uses `POST /typing { isTyping: true/false }` + local `SET_TYPING`
- **Rendering (`MessageList` / `MessageBubble`)**
  - **Virtualized list** (`react-virtuoso`) handles large message histories efficiently.
  - sequential render with grouped timestamps, reply previews, reaction aggregations, and hover actions
- **LLM simulation (`useLLM.ts`)**
  - reacts on the last non-LLM message with a 40% chance
  - auto replies to messages mentioning `@GPT-4`/`gpt` after a 2s timeout
  - all logic is client-side; replacing this with real inference is the main integration point for external LLMs

---

## 4. Component responsibilities
- `AuthScreen.tsx`: login/register forms, calls `/auth/register` + `/auth/login`, handles error states
- `Layout.tsx`: overall chrome, mobile top bar toggles the sidebar overlay, **offline banner**
- `Sidebar.tsx`: channel placeholders, current user card, member list with presence dots + BOT labels
- `MessageList.tsx`: **virtualized** scroll container, auto-scroll to latest message, typing indicator row
- `MessageBubble/`: Directory containing composed message parts:
  - `index.tsx`: Main container
  - `MessageContent.tsx`: Renders markdown text
  - `ReactionList.tsx`: Displays reactions
  - `ActionButtons.tsx`: Hover actions (reply, react, delete)
- `MessageInput.tsx`: multiline composer with reply pill, attachment buttons placeholder, typing dispatch
- `ErrorBoundary.tsx`: Catches render errors and displays a fallback UI
- `useLLM.ts`: fake bot logic; safe to swap with real inference hooks
- `ChatContext.tsx`: reducer + context wiring; actions include `HYDRATE`, `SET_AUTH_STATUS`, `SET_USERS`, `SET_MESSAGES`, `SEND_MESSAGE`, `SET_REPLY`, `SET_TYPING`, `UPDATE_REACTIONS`

---

## 5. Backend overview (`server/server.js`)
- **Stack**: Express + lowdb (JSONFile adapter), bcryptjs for password hashing, jsonwebtoken, cookie-parser, cors
- **Storage**: defaults to `server/data.json`; ensures default `llm1` bot exists at startup
- **Session**: JWT stored as httpOnly cookie (Authorization Bearer is also accepted)
- **CORS**: allowlist defined by `CLIENT_ORIGIN` (comma separated), default `http://localhost:5173`
- **Env vars**
  - `PORT` (default 4000)
  - `CLIENT_ORIGIN`
  - `JWT_SECRET`
  - `DB_PATH`
- **Routes**
  - `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
  - `GET /messages`, `POST /messages`
  - `GET /users`
  - `GET /typing`, `POST /typing`

---

## 6. Local scripts & tips
1. `npm install`
2. `npm run server` (honor env vars above)
3. `npm run dev` (set `VITE_API_URL` when pointing to a remote API)
4. `npm run build`, `npm run preview`, `npm run lint` as needed

Data is persisted in `server/data.json`. Delete the file to reset (it will be regenerated with the default users/bot). For production deployments switch to a real database and configure a strong `JWT_SECRET`.

---

## 7. Extension ideas
- Move LLM logic server-side; optionally expose `/llm` endpoints and push responses via polling or WebSocket/SSE
- Replace polling with WebSocket/SSE to cut latency and request volume
- Persist mentions + notifications, add unread badges, or per-user reaction state
- Add channels/rooms: attach `channelId` to messages and filter lists based on the active channel
- Harden production posture: HTTPS, secure sameSite cookies, rate limiting, input validation, audit logging, monitoring
