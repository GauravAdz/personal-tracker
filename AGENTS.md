# Codex Rules — Personal Tracker

## Goal and scope
Build a free-to-run, privacy-first, single-user Android-oriented PWA for workouts, body-weight measurements, configurable daily routines, and manually curated exercise restrictions. No account, cloud backend, OpenAI API, advertising, analytics SDK, or paid service in V1.

## Source of truth
1. `docs/ARCHITECTURE.md`: domain contracts, invariants, security, architecture.
2. `docs/IMPLEMENTATION_TASKS.md`: task order, exact acceptance criteria.
3. `docs/PROGRESS.md`: completed tasks, blockers, brief decisions.
Read only the task-relevant sections, plus this file. If these conflict, stop and note the mismatch; do not silently redesign.

## Code rules
- React + Vite + TypeScript (`strict`) + Tailwind; Dexie/IndexedDB; Zod at untrusted boundaries. npm + lockfile; no unapproved dependencies.
- No backend, auth, third-party runtime requests, telemetry, or AI in V1. Do not ship client-side secrets.
- Separate `features/` UI, `domain/` pure rules, and `data/` repositories/migrations. Components must not write to Dexie directly.
- Database is the source of truth for persisted state. All significant actions save immediately; restore active sessions after restart.
- Log facts (actual reps, weights, timestamps), never silently fill achieved values from targets. Stable UUIDs for user records and namespaced IDs for catalog exercises.
- Store event times in UTC ISO 8601; separately store local date and IANA time zone when calendar-day semantics matter. Weight in kg internally.
- Medical restrictions are user-managed and conservative. No generated injury, medication, dosage, exercise-safety or rehab prescriptions. Unsafe/unknown != approved.
- Add tests for new business rules and migrations. Prefer small readable functions, explicit errors, accessibility, and simple interfaces over speculative abstractions.
- Avoid unrelated refactors, broad dependency additions, network APIs, excessive comments, and duplicate boilerplate.

## Execution contract
Implement **one task ID** per request unless explicitly authorized otherwise. Inspect only relevant files, implement, run targeted checks, and update `docs/PROGRESS.md`. Do not move to the next task automatically. Ask only when genuinely blocked by an irreversible decision; otherwise document a narrow assumption.

For each completion, respond in <=12 concise lines:
`TASK / RESULT / FILES / TESTS (commands + pass/fail) / DECISIONS / NEXT TASK`.
Do not paste full files or lengthy logs; include only relevant error excerpts. Never claim tests passed if they were not run.

## Common checks
`npm run typecheck`, `npm run lint`, `npm run test:unit -- --run`, `npm run build`.
`npm run test:e2e` only for tasks involving critical user journeys or when requested. If a script isn't configured yet, say so; do not invent success.
