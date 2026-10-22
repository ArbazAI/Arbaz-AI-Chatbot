# Arbaz AI

Arbaz AI is a cross-platform conversational assistant for coding, math, science, writing, and technical questions in English, Hindi, and Hinglish.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret for live Gemini chat: `GEMINI_API_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/arbaz-ai/app/index.tsx` — primary chat experience
- `artifacts/arbaz-ai/lib/chat.ts` — streaming client, local identity replies, and safe command simulations
- `artifacts/api-server/src/routes/gemini.ts` — validated, rate-limited Gemini streaming endpoint
- `lib/api-spec/openapi.yaml` — API contract source of truth

## Architecture decisions

- Gemini credentials remain on the API server; never place them in Expo client configuration.
- Chat history is stored locally on the device; no account or server-side conversation storage is used.
- Device commands are simulated with safety guidance; the app does not execute operating-system actions.

## Product

The app supports streamed Gemini chat, local chat history, formatted and copyable code, text-to-speech playback, and browser speech recognition where available.

## User preferences

The user requested a dark, futuristic interface with blue and purple accents and a visible “Created by Arbaz Khan” badge.

## Gotchas

- Add a rotated `GEMINI_API_KEY` through Replit Secrets before expecting live Gemini responses.
- Browser speech recognition is only available in browsers that implement the Web Speech API; native clients show an explanatory fallback.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
