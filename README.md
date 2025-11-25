# Active LLM Group Chat

A React + Vite group chat showcase with an Express + lowdb backend. It ships a lightweight auth flow, persistent messages and member lists, plus a triggerable LLM bot that can react or reply on its own. The layout mirrors Telegram/Discord, so it doubles as a starting template for internal prototypes, demos, and “LLM in chat” experiments.

> The current LLM behavior is still simulated on the frontend via `useLLM`. Messages, users, and typing states are stored by the local API inside `server/data.json` and can be swapped for any real backend or model service.

---

## Feature Highlights
- Accounts & sessions: email registration/login with JWT (httpOnly cookie + Bearer fallback), `/auth/me` refresh, DiceBear avatars.
- Message UX: text bubbles, reply preview, @ mentions, aggregated reactions, and hover actions that feel close to a modern IM client.
- Typing + polling: typing indicators are reported via `/typing`, messages are polled through `/messages` to keep everyone in sync.
- Members & sidebar: placeholder channels + member list (presence dots, BOT badge) with a mobile-friendly collapsible sidebar.
- LLM simulation: bundled `llm1` (GPT-4) bot that has a 40% chance to add a reaction and auto-replies 2s after seeing `@GPT-4` or `gpt`.
- Persistence: users, messages, and typing states live in `server/data.json`; deleting the file resets the sandbox (the default LLM user is re-created on boot).
- Dev experience: single repo, separate dev servers for frontend/backend, TypeScript types shared between UI and API payloads.

---

## Quick Start

### Requirements
- Node.js 18+ (18/20 recommended)
- npm or a compatible package manager

### Local workflow
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the API (defaults to `http://localhost:4000`, storing data under `server/data.json`):
   ```bash
   npm run server
   ```
   Optional environment variables:
   - `PORT`: API port, default `4000`
   - `CLIENT_ORIGIN`: comma separated origins allowed to hit the API
   - `JWT_SECRET`: JWT signing secret (change it for any non-local use!)
   - `DB_PATH`: lowdb JSON storage path, default `server/data.json`
3. Start the frontend (points to the local API unless overridden) and open `http://localhost:5173`:
   ```bash
   npm run dev
   # point to a remote API if needed
   VITE_API_URL="http://localhost:4000" npm run dev
   ```

Suggested flow: register or log in -> send a few messages, add reactions, quote reply -> type `@GPT-4` or include `gpt` to trigger the bot -> shrink the window/mobile to test the responsive sidebar toggle.

---

## Frontend Overview
- `ChatContext`: reducer that owns `authStatus`, `currentUser`, `users`, `messages`, `typingUsers`, and `replyingTo`.
- `App.tsx`: entry point; validates `/auth/me`, hydrates `/users` + `/messages`, and starts message/typing polling.
- `MessageInput.tsx`: multiline editor with @ suggestions, reply ribbon, typing reports, and `POST /messages` submission.
- `MessageList` / `MessageBubble`: renders messages, reply previews, reactions, and their hover interactions.
- `Sidebar` / `Layout`: channel + member list plus the responsive mobile drawer shell.
- `useLLM.ts`: frontend-only simulation that can be replaced by real inference or server callbacks.

### Tech stack (frontend)
- React 18 + TypeScript + Vite
- Styling via utility classes + small custom components (no heavy UI framework)
- `framer-motion` for subtle animations, `lucide-react` for icons, `clsx` for conditional classNames

---

## Backend API (TL;DR)
- Auth: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- Messages: `GET /messages?limit=100&before=timestamp`, `POST /messages` (`content`, optional `replyToId`)
- Users: `GET /users`
- Typing: `GET /typing`, `POST /typing` (`isTyping`, server cleans up with TTL)

### Tech stack (backend)
- Express, lowdb (JSON file storage)
- `bcryptjs` for password hashing
- `jsonwebtoken` for JWT issuance/verification
- `cookie-parser` and `cors` for auth cookies + CORS handling

---

## Data & Reset
- Default storage: `server/data.json`
- Reset: stop the API, delete the file, restart to re-seed the default members/LLM bot
- Production tips: move to a proper database, rotate `JWT_SECRET`, add HTTPS, rate limits, validation, logging, and monitoring

---

## When To Use It
- Need a "works out of the box" chat demo with login, persistence, and an LLM bot
- Want an end-to-end React + TS + Vite + Express + lowdb scaffold to plug into a real backend/model
- Demoing UX flows, running workshops, or providing an interactive artifact for product discussions

---

## Possible Extensions
- Swap `useLLM` for real inference (e.g., expose a `/llm` API or push bot messages from the server)
- Replace polling with WebSocket/SSE transport for lower latency
- Persist @ mentions, highlight them in the UI, and wire notification hooks
- Add multi-channel / DM models (filter by `channelId`)
- Harden prod readiness: HTTPS, secure sameSite cookies, rate limits, schema validation, logging, alerting
