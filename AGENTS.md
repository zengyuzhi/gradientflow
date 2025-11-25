## Overall principles
- Prefer small, focused changes instead of large refactors, unless explicitly requested.
- Keep UX coherent with a modern chat app that includes LLM bots.
- Follow existing React + TypeScript style; avoid introducing exotic patterns without a clear benefit.

## Frontend guidelines
- Animations: smooth but snappy; avoid overly long or distracting transitions.
- UI: minimalist style with high-quality visual details (subtle shadows, gradients, and hover states).
- Layout: keep structure simple, but invest in polished micro-interactions and spacing.
- Components: keep them focused and reusable; push cross-cutting logic into hooks where it makes sense.

## Backend guidelines
- Design features to be LLM-friendly (clear APIs, well-structured JSON responses, and stable contracts).
- Keep the chat room logic friendly to LLM bots (predictable message shapes, metadata for tools, etc.).
- Avoid breaking existing API contracts unless the change is coordinated with the frontend.

## Code
- Maintain a clear folder structure and modular code (small, focused functions/modules).
- Keep the architecture extensible for future upgrades and integrations.
- Place new components under `src/components`, hooks under `src/hooks`, types under `src/types`, and API clients under `src/api`.


admin账号：root@example.com
密码：1234567890
