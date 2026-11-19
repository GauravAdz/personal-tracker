# IMPLEMENTATION_TASKS — One-task-at-a-time Codex queue

**Use:** Complete tasks in ascending order. For each task, Codex reads `AGENTS.md`, the task card, and only relevant sections of `ARCHITECTURE.md`. Commit/checkpoint after validation. Do **not** implement future tasks early. Tests are part of each task, not a separate post-project phase.

## Global definition of done (DoD)
- Only task-specific scope changed; types and validation align with architecture; no stubbed false success.
- No TypeScript errors, lint errors, failing affected unit tests; production builds after all app-facing tasks.
- Every new business invariant has a happy-path + one failure-path test.
- UI loading/empty/error states, mobile viewport and accessible labels where UI changed.
- Persisted operations survive reload; no secrets, cloud dependencies or paid APIs introduced.
- Update `docs/PROGRESS.md` with task ID and tests actually run; short Codex completion summary.

## Phase 0 — foundation and durability

### T01 — Scaffold + quality gates
**Depends:** none. **Read:** Architecture §2, §3, §9.
**Touch:** app/root configs, `src/app/`, `.github/workflows/ci.yml`, package files.
**Implement:** Vite React TS strict app, Tailwind, minimal route/navigation layout (Home, Workouts, Exercises, Health, Settings), ESLint, Prettier, Vitest, React Testing Library, Playwright configuration, npm scripts, responsive baseline theme, minimal CI. Use Node version compatible with installed package versions; commit lockfile. Don't add all feature pages beyond placeholders.
**Accept:** `npm ci`, `npm run check` pass; `npm run dev` renders mobile shell; accessible navigation works; CI defined; no backend.

### T02 — Domain models + runtime validation
**Depends:** T01. **Read:** Architecture §4 and invariants.
**Touch:** `src/domain/models.ts`, `src/domain/time.ts`, `src/data/validation.ts`, tests.
**Implement:** Types and Zod schemas for all persisted entities, finite input validations, UTC/local-date helper with IANA zone, ID helper; share input schemas between UI and backup importer. Reject invalid/non-finite values.
**Accept:** Valid examples parse; malformed timestamps, reversed rep ranges, NaN, invalid UUIDs, empty habit slots fail; local-date tests cover DST and midnight.

### T03 — Dexie database + repositories
**Depends:** T02. **Read:** Architecture §3, §4.
**Touch:** `src/data/db.ts`, `src/data/repositories/`, repository tests.
**Implement:** Dexie v1 schema/indexes, typed repository boundaries; write session-start and append-set transactions, active-session invariant, unique index for set ordinal and habit slot, parent-reference validation. Use `fake-indexeddb` in unit tests.
**Accept:** Start two simultaneous sessions rejected/redirected; double append cannot duplicate ordinal; on transaction failure no partial rows; compile and unit tests pass.

### T04 — Backup & restore foundation
**Depends:** T03. **Read:** Architecture §6, §8.
**Touch:** `src/data/backup.ts`, `src/features/settings/BackupPanel.tsx`, tests.
**Implement:** Export envelope with schema/catalog versions, Zod validation, file-size limit, semantic referential checks, preview, explicit replace-all confirmation, whole-database Dexie transaction restore. Before replace require user-triggered download of current snapshot and clear acknowledgement. Display last-export date and plaintext health-data warning.
**Accept:** Round trip preserving all rows and IDs; corrupt/future-version/duplicate/orphan backup rejected with no DB mutation; browser download flow manually testable; rollback proven by test.

### T05 — Installability and real offline shell
**Depends:** T01, preferably T04. **Read:** Architecture §7 and §9.
**Touch:** `vite.config.ts`, manifest/icons, `src/app/UpdatePrompt.tsx`, E2E.
**Implement:** `vite-plugin-pwa` with app-shell precache, offline fallback, SW update **prompt** (not forced autoUpdate), iOS/Android-safe icon basics, installation metadata, persistent storage request in Settings with denied/fallback explanation.
**Accept:** Production build loads offline after online activation; no runtime external CDN; new SW does not auto-reload active workout; localhost and HTTPS expectations documented.

## Phase 1 — exercise and routine foundation

### T06 — Offline exercise-catalog import
**Depends:** T02, T05. **Read:** Architecture §5A.
**Touch:** `scripts/prepare-exercises.*`, `src/data/seed/`, `public/exercises/`, credits/licenses.
**Implement:** Reproducible import from a **pinned upstream commit**, choosing 60–100 common exercises; normalize, validate and produce small static catalog; preserve stable `fedb:` IDs; optimize only legally usable image assets, with fallback. Store original source SHA and provenance manifest. Never call dataset API at runtime.
**Accept:** Import script deterministic; test IDs unique and all image paths resolvable or fallback; no network needed for catalog after build; license provenance documented.

### T07 — Searchable exercise library
**Depends:** T06, T03. **Read:** Architecture §5A, §8.
**Touch:** `src/features/exercises/`, repository/collation helpers, tests.
**Implement:** Name search, primary-muscle/equipment filters, exercise details, start/end image toggle, favorite and user notes persisted via `ExerciseOverride`.
**Accept:** Empty/filter states correct; exercise details view offline; favorites survive reload; accessible touch UI.

### T08 — Routine editor
**Depends:** T07, T03. **Read:** Architecture §5B and §4.
**Touch:** `src/features/routines/`, routine repository, tests.
**Implement:** CRUD, duplicate, reorder, exercise select, per-item working-set count/rep bounds/rest duration; automatic validation; simple default routine can be seeded for demo only if distinguishable from real user data.
**Accept:** Create/edit/delete/duplicate works offline; invalid ranges rejected; identical exercises can appear twice with distinct routine item IDs; history unaffected by template deletion.

### T09 — User restrictions + priorities
**Depends:** T07, T08. **Read:** Architecture §5A–B and §5 restrictions.
**Touch:** `src/domain/restrictions.ts`, `src/features/exercises/RestrictionEditor.tsx`, `src/features/routines/`, tests.
**Implement:** Explicit `allowed/caution/excluded` per exercise, user-entered note; separate optional muscle-priority preferences (inform filters, not injury diagnoses). Picker hides excluded by default and routine start flags an excluded existing item. No AI or auto-generated injury technique advice.
**Accept:** Excluded cannot silently enter a new workout; caution displays note; unknown not called safe; restriction editing does not erase old logs.

## Phase 2 — primary value: Gym Mode

### T10 — Start / resume / finish workout
**Depends:** T08, T03, T09. **Read:** Architecture §5B–C.
**Touch:** `src/services/workout.ts`, `src/features/gym/`, tests.
**Implement:** Routine snapshot into `WorkoutSession` + `SessionExercise` records; active session routing, resume on reload, reorder/skip exercises, end/cancel with confirmation, session history summary. Only one active session.
**Accept:** After reload active screen and ordering match; edits to template don't mutate active session; cancel keeps logs; non-empty/empty sessions handled.

### T11 — Fast set logging + history
**Depends:** T10. **Read:** Architecture §5C and schema.
**Touch:** `src/features/gym/SetLogger.tsx`, session service/repositories, tests.
**Implement:** Show planned vs actual separately; prior completed working-set values (same exercise ID); keyboard-friendly numeric input, 1-tap confirmation, edit/undo, duplicate-tap guard, autosave, warmup vs working sets.
**Accept:** Log at least 3 sets; reload and edit without duplication; same exercise twice remains separated; previous values correct; tap twice does not create 2 rows.

### T12 — Rest countdown + wake lock
**Depends:** T11. **Read:** Architecture §5E.
**Touch:** `src/features/gym/RestTimer.tsx`, `src/domain/time.ts`, small hook/service, tests.
**Implement:** Timer based on persisted `endsAt` UTC; start after logged set, pause/skip/adjust/restart, refresh from wall clock after hide/reload; optional screen Wake Lock with release/reacquire and supported/denied fallbacks. Don't promise background notifications.
**Accept:** Fake-clock unit tests for suspension/reopen; timer correct after reload; no zombie intervals; Wake Lock failure nonfatal.

### T13 — Progression engine and explanation
**Depends:** T11. **Read:** Architecture §5D.
**Touch:** `src/domain/progression.ts`, tests, Gym UI small badge.
**Implement:** Pure function taking target rep range, previous comparable working sets, current feedback and optional RIR. Return `eligible_to_increase | repeat_load_or_adjust_reps | review_exercise | no_suggestion` with explainable reason. UI shows suggestion, never modifies load without user action.
**Accept:** Table-driven tests for all-reps-top, mixed reps, inconsistent loads, missing history, discomfort, bodyweight/null loads, noncomparable sets. No AI dependency.

## Phase 3 — daily tracking

### T14 — Generic daily habits
**Depends:** T03, T02. **Read:** Architecture §5F.
**Touch:** `src/features/health/`, habit repository, tests.
**Implement:** Create/edit/archive scheduled habits with AM/PM or arbitrary user slots; mark done/skipped/undo by calendar day; persisted event timestamps, quantities optional. Optional initial AM/PM example, but no assumed clinical doses/timing/absorption guarantees.
**Accept:** Two same-day slots independent; repeated tap updates same row; date rollover and IANA zone handled; archive preserves history.

### T15 — Body-weight records and trend
**Depends:** T03, T02. **Read:** Architecture §5G.
**Touch:** `src/domain/analytics.ts`, `src/features/measurements/`, tests.
**Implement:** Add/edit/delete check-in with kg and timestamp; current/previous readings, simple SVG trend for 7 calendar days; average latest reading per day, show N/7 availability; skippable prompt before workout if enabled.
**Accept:** Missing days not counted as zero; multiple weights in one day collapsed only for trend; edits persist; chart accessible as text summary.

### T16 — Dashboard integration
**Depends:** T10, T14, T15. **Read:** Architecture §5I.
**Touch:** `src/features/home/`, nav.
**Implement:** Compact Today screen: routine check-ins, Resume/Start, last workout, weight trend summary, last export reminder, Settings link. Clear loading/empty states and one obvious workout call to action.
**Accept:** Works after empty install, with sample data and fully offline; dashboard reflects recent changes without hard reload.

## Phase 4 — optional workflows and release hardening

### T17 — Guided warm-up / cooldown (nonblocking)
**Depends:** T10, T12. **Read:** Architecture §5H.
**Touch:** `src/features/gym/PreparationFlow.tsx`, tests.
**Implement:** User-editable optional checklist and timer for cross-trainer/dynamic mobility/light warm-up and cooldown; skip buttons. No default strain-safe prescriptions or forced wait.
**Accept:** Can bypass entirely; progress does not block logging; timer correct after background; preferences persist when appropriate.

### T18 — Critical E2E, deployment and recovery QA
**Depends:** all previous tasks. **Read:** Architecture §6–§9.
**Touch:** Playwright specs, CI, README/setup, minor bugfixes only.
**Implement:** Automated main journey (create routine → log → reload → resume → finish), backup/restore, offline production-build scenario, validation errors, mobile layout and upgrade-prompt test; manual Android Chrome install/airplane-mode smoke checklist; static deployment docs.
**Accept:** `npm run check` + critical E2E pass, no failing TypeScript/ESLint; empty/new install and restored install verified; `npm ci && npm run build` produce deployable `dist/`; unresolved platform restrictions documented.

## Release acceptance checklist
- [ ] Logs sets while offline, reloading does not lose state.
- [ ] No duplicate logs on rapid tap; editing/deleting is explicit.
- [ ] Rest timer resumes from saved deadline, Wake Lock errors handled.
- [ ] Data survives app update; offline SW update isn't forced mid-workout.
- [ ] Backup export/restore tested from clean DB; malformed restore leaves data intact.
- [ ] All exercise images audited or replaced with legally reusable media.
- [ ] No OpenAI key/server/cloud telemetry; personal medical records remain local.
- [ ] Device check at ~360px mobile width, larger mobile and desktop.
- [ ] `npm run check` and critical `npm run test:e2e` pass.

## Guard against scope creep
If a task suggests a missing capability, first decide whether it's necessary for that task's acceptance criteria. If not, write one line under `docs/PROGRESS.md` as a deferred idea. Do not install extra frameworks or pre-build speculative interfaces.
