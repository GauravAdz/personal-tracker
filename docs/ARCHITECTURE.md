# ARCHITECTURE — Personal Fitness & Health Tracker (V1)

**Status:** implementation contract · **Product:** single-user Android-first PWA · **Principle:** local-first, simple, testable, zero mandatory recurring cost.

## 1. Product contract

### V1 goals
- Gym Mode: start/resume/complete sessions, choose/create routines, record actual working/warm-up sets, rest timer, compare with previous performance.
- Exercise library: search/filter a curated, locally bundled subset of `yuhonas/free-exercise-db` (start with 60–100 relevant exercises), form instructions and 0/1 images when licensed and available, equipment and muscle tags.
- Progression: conservative, deterministic *suggestions* only; human-controlled load and rep changes.
- Personal restrictions: explicit user-maintained allowed/caution/excluded status per exercise; no automatic claims of injury safety.
- Daily Hub: configurable morning/evening routine check-ins (initial template may be minoxidil, without hardcoded dose), body-weight entries and a seven-calendar-day trend.
- Optional guided dynamic warm-up, exercise-specific warm-up sets, cooldown flows; all skippable.
- Works offline after initial installation; saves after every successful action; manual, versioned export/import backups; installable on Android Chrome.
- Accessibility: readable, responsive, keyboard-capable, large touch targets, works with low or no network.

### Explicit V1 non-goals
Cloud sync, authentication, shared accounts, AI APIs, Custom GPT Actions, food/calorie counting, notifications guaranteed after browser closure, advanced injury diagnosis, medication advice, live posture recognition, video hosting, multi-device merge, paid services, or automatic background backup to disk/cloud.

### Success criteria
1. Finish a full workout on Android with airplane mode on, reload midway, and recover the same session and sets.
2. No logged set or routine disappears after navigation/restart; importing a backup into a clean database recreates relevant history.
3. 1–2 taps to log a prefilled set (but actual value must be explicitly confirmed); usable with one hand.
4. New build updates do not reset data; a service-worker update does not auto-reload during an active session.
5. Base app incurs $0 mandatory subscription/API/server expense.

## 2. Frozen technology choices

| Concern | Selection | Reason/limit |
|---|---|---|
| UI | React + Vite + TypeScript strict | Small static SPA, no SSR/backend |
| Styling | Tailwind CSS + CSS variables | Accessible dark/light themes, low overhead |
| Routing | React Router (only if multiple URL routes need it) | Browser back support; avoid extra state library |
| Persistence | IndexedDB via Dexie | Indexed compound indexes, transactions, migrations |
| Validation | Zod | Untrusted JSON import and user input |
| UI data subscriptions | `dexie-react-hooks` `useLiveQuery` (when needed) | Keep DB source of truth; no query cache needed |
| Testing | Vitest, React Testing Library, fake-indexeddb, Playwright | Domain, components, repositories, offline E2E |
| Offline | `vite-plugin-pwa`, Workbox `generateSW` | App shell + selected exercise assets; update prompt |
| Charts | Lightweight SVG/CSS chart initially | Avoid a full chart framework for 1–2 visuals |
| Hosting | Any static HTTPS host | Free tier sufficient if eligible |
| Package tool | npm + `package-lock.json` | Single toolchain; reproducible installs |

Use compatible maintained packages available at installation time; commit exact resolved versions. Node version must meet installed Vite/Vitest toolchain constraints (start with Node 22+ and check their current official requirements). Do not add UI kits, state managers, date libraries or native wrappers without an actual task requirement.

## 3. System shape and dependency direction

```text
Android Chrome installed PWA
    ├── App shell, accessible navigation, design system
    ├── Features: gym | exercises | routines | health | measurements | settings
    ├── Domain: progression | restrictions | streaks | statistics | time
    ├── Services: workout orchestrator | backup validator/restore
    ├── Data repositories + Dexie schema/migrations
    └── Local exercise catalog + Workbox asset cache

Feature components -> feature hooks/services -> domain functions + repository interfaces
Concrete Dexie repositories -> interfaces and DB schema
Domain code NEVER imports React, Dexie, DOM, network or app components.
```

Recommended layout (add files only when needed):

```text
src/
  app/               App.tsx, navigation, app error boundary, theme
  features/
    exercises/       list/filter, details, selection, user override UI
    routines/        routine list + editor
    gym/             active session, set rows, rest timer, history
    health/          habit definitions, daily check-ins
    measurements/    body-weight form and trend
    settings/        backup/restore, preferences, storage status
  domain/
    models.ts        domain types and invariants
    progression.ts   pure algorithm
    restrictions.ts  pure filter/label logic
    analytics.ts     pure local trend calculations
    time.ts          UTC/local date helpers
  data/
    db.ts            Dexie schemas/migrations
    repositories/    narrow persistence adapters
    backup.ts        validation, export/import, rollback policy
    seed/            pinned catalog metadata + exercise data
  services/          session transactions, app workflow boundaries
  shared/            small design primitives, errors, utilities
  test/              fixtures and E2E helpers
public/              icons, LICENSE/credits, curated offline images
scripts/             build-time dataset preparation (never runtime fetch)
docs/                architecture, task cards, status
```

Keep domain modules *functional*, no service singleton magic. Presentational UI must not call `db.table.*`; repositories/services own reads/writes.

## 4. Persisted entities and relationships

### Identity, time and quantities
- Every user-created record uses `crypto.randomUUID()` on a secure context; exercise catalog IDs use `fedb:<upstreamId>`; IDs never derive from display name after seeding.
- UTC `...At` fields are ISO 8601 UTC timestamps (`new Date().toISOString()`). A `localDate` (`YYYY-MM-DD`) plus `timeZone` (IANA, e.g., `Europe/Vienna`) is stored on calendar-day records to preserve their original day grouping through DST/travel. Do not reconstruct historical local dates from the *current* time zone.
- Weight in **kg** internally, decimal permitted; all measurements validated as finite, realistic positive values where appropriate. External load can be 0 or null depending on exercise; null means not recorded/not applicable, never silently interpreted as 0.
- Deleted routines and edited catalog records never cascade-delete workout history. Store a short exercise snapshot in session exercise rows to preserve history labels.
- `createdAt` and `updatedAt` included on mutable records; all user changes have an explicit save path.

### Contracts (type-level guide; refine with Zod during implementation)

```ts
export type ID = string;
export type UTCISOString = string;
export type LocalDate = string;    // YYYY-MM-DD at record creation
export type IANATimeZone = string;

export interface CatalogExercise {
  id: ID;                       // fedb:Alternate_Incline_Dumbbell_Curl
  sourceId: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string | null;
  instructions: string[];
  category: string;
  imagePaths: string[];          // local, never arbitrary untrusted URL
}

export interface ExerciseOverride {
  exerciseId: ID;
  favorite: boolean;
  userNotes?: string;
  customName?: string;
  updatedAt: UTCISOString;
}

export interface ExerciseRestriction {
  exerciseId: ID;
  status: 'allowed' | 'caution' | 'excluded';
  note?: string;                 // supplied/managed by user, not AI-generated
  updatedAt: UTCISOString;
}

export interface MusclePreference {
  muscleGroup: string;
  priority: 'priority' | 'normal' | 'deprioritized';
  updatedAt: UTCISOString;
}

export interface RoutineExercise {
  id: ID;                       // stable item ID even when same exercise repeated
  exerciseId: ID;
  order: number;
  workingSets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
}
export interface Routine {
  id: ID;
  name: string;
  items: RoutineExercise[];
  createdAt: UTCISOString;
  updatedAt: UTCISOString;
}

export interface WorkoutSession {
  id: ID;
  routineId: ID | null;
  status: 'active' | 'completed' | 'cancelled';
  startedAt: UTCISOString;
  endedAt?: UTCISOString;
  note?: string;
}

export interface SessionExercise {
  id: ID;
  sessionId: ID;
  exerciseId: ID;
  exerciseNameSnapshot: string;
  equipmentSnapshot: string | null;
  order: number;
  targetSets: number;
  targetRepMin: number;
  targetRepMax: number;
  restSeconds: number;
}

export interface SetLog {
  id: ID;
  sessionId: ID;
  sessionExerciseId: ID;
  ordinal: number;              // 1-based within a session exercise
  kind: 'warmup' | 'working';
  externalLoadKg: number | null;
  reps: number;
  repsInReserve?: number;       // optional user observation (0..10)
  feedback?: 'easy' | 'normal' | 'hard' | 'discomfort';
  completedAt: UTCISOString;
}

export interface BodyWeightEntry {
  id: ID;
  weightKg: number;
  occurredAt: UTCISOString;
  localDate: LocalDate;
  timeZone: IANATimeZone;
  note?: string;
}

export interface HabitDefinition {
  id: ID;
  name: string;
  slots: { id: ID; label: string; localTime?: string }[];
  quantityLabel?: string;       // display only; user defines its meaning
  archived: boolean;
  createdAt: UTCISOString;
  updatedAt: UTCISOString;
}

export interface HabitLog {
  id: ID;
  habitId: ID;
  slotId: ID;
  localDate: LocalDate;
  timeZone: IANATimeZone;
  status: 'done' | 'skipped';
  occurredAt: UTCISOString;
  quantity?: number;            // optional observation, not a prescription
}

export interface AppSettings {
  id: 'singleton';
  preferredMassUnit: 'kg';
  lastExportedAt?: UTCISOString;
  restTimer?: { sessionId: ID; endsAt: UTCISOString };
  catalogVersion: string;
}
```

**Schema invariants:**
- At most ONE `active` session. Starting a new one must prompt to resume/finish/cancel existing; enforce in a Dexie `rw` transaction, not UI alone.
- A `SessionExercise` always belongs to an existing session; a `SetLog` must refer to its session + matching session exercise. Verify in service write path; IndexedDB has no foreign-key enforcement.
- A row's `(sessionExerciseId, ordinal)` is unique. A repeated tap must not create duplicate sets; UI disables during save and write transaction enforces uniqueness. Editing a set uses its existing ID, not append.
- Routine exercise order is unique within each routine; preserve order by explicit sorted list, not DB insertion order.
- `repMin >= 1`, `repMax >= repMin`, `workingSets >= 1`, `restSeconds >= 0`; `reps >= 0` if 0-rep intentional attempts are permitted, otherwise require `>=1` for completed reps; document whichever choice tests enforce. In V1, use reps >=1 for completed sets.
- `status=completed|cancelled` implies `endedAt` present. Cancelled sessions remain in history until separately explicitly deleted.
- A habit can have at most one log per `(habitId, localDate, slotId)`; toggling updates existing log, not creating a second.
- No medically inferred defaults: restriction status is explicitly selected; *unknown* status does not imply safe.

### IndexedDB schema / indexes
Use Dexie `db.version(1).stores(...)`; tests must verify indexes and upgrade behavior. Suggested tables:

```ts
routines:             'id, updatedAt, name'
sessions:             'id, status, startedAt, endedAt'
sessionExercises:     'id, sessionId, [sessionId+order], exerciseId'
setLogs:              'id, sessionId, sessionExerciseId, &[sessionExerciseId+ordinal], completedAt'
exerciseOverrides:    'exerciseId, updatedAt'
restrictions:         'exerciseId, status'
musclePreferences:    'muscleGroup, priority'
bodyWeights:          'id, localDate, occurredAt'
habits:               'id, updatedAt, archived'
habitLogs:            'id, habitId, &[habitId+localDate+slotId], localDate, occurredAt'
settings:             'id'
```

The exercise **catalog itself is immutable static build data** (small curated JSON plus optimized local images), not a mutable IndexedDB table. Avoid duplicating the entire catalog into IndexedDB unless measured performance justifies it. Never overwrite user preferences or log history on dataset update. Later migrations use new `db.version(n)` blocks with unit tests; never edit historical version contracts after users have data.

### Repository API boundaries
Implement narrow functions such as:
- `getExercises(filters)`, `getExerciseById(id)` against the static catalog + user overrides.
- `listRoutines()`, `saveRoutine(routine)`, `deleteRoutine(id)` (deleting templates never deletes sessions).
- `getActiveSession()`, `startSession(routineId|null)`, `appendSet(...)`, `updateSet(...)`, `finishSession(id)` and `cancelSession(id)` in a service that ensures transactions/invariants.
- `getLastCompletedWorkingSets(exerciseId, beforeSessionId)` for display and progression, with equipment identity scoped by exercise ID.
- `upsertHabitLog(...)`, `listHabitLogsForDay(...)`, `saveBodyWeight(...)`.
- `exportSnapshot()`, `validateSnapshot(file)`, `restoreSnapshotValidated(snapshot, explicitConfirmation)`.

Do NOT implement a generic CRUD framework. Export only the smallest API the UI needs.

## 5. Feature behavior, exact V1 rules

### A. Exercise library
- Seed **curated subset** from a pinned upstream Git commit. Store upstream commit, import script and license/credit manifest. Normalize nulls and duplicates, validate incoming JSON at build time, and preserve `fedb:<sourceId>` IDs.
- Search case-insensitive name; filter equipment and primary muscles. Images local with fallback placeholder; limit cache to core assets. No runtime image/API dependency in Gym Mode.
- Exercise detail: instructions, demo image toggle, primary/secondary muscles, equipment, user note, favorite, manually selected caution/exclusion.
- **License gate:** repository metadata says Unlicense, but upstream images may have separate provenance; audit image licensing/credit before bundling or redistributing. If unclear, ship with text-only or self-created media for that entry.

### B. Routine editor
- Create, rename, duplicate, delete routines; add/reorder exercises; set working sets, rep range, rest duration per item; defaults can be editable (e.g., 3 × 8–12, 120 s) but are UI conveniences, not clinical advice.
- A blocked exercise cannot be added through default picker; if an existing routine item becomes excluded, flag it and require explicit replacement/removal before starting. Caution items display the user-entered restriction note; do not auto-modify technique or weight.
- Session starts with a **snapshot** of routine items into `SessionExercise`, so editing a routine mid-workout never mutates current/historic sessions.

### C. Gym session / set logger
- Home and Gym Mode show Resume when session active. Navigate away, close tab or reload: return to same session with all saved sets.
- Session exercises show `Previous: load × reps` when same catalog exercise found in the most recent completed session; show `—` when unavailable. Previous session excludes warmups.
- Prefill input fields with an editable next-set suggestion, clearly tagged as *planned*, not *completed*. On **Log Set**, validate finite load and reps, create a single row transactionally, then start rest timer. Show undo/edit; undo deletes/marks the intended set and resets timer appropriately.
- Exercise can be reordered or skipped within a session; if the same exercise appears twice, logs remain separate through `sessionExerciseId`.
- Session can complete even if planned sets weren't all logged. Cancel must require confirmation and must not silently delete logs.
- Show network/offline indicator only if useful. No network request required to log sets.

### D. Progression engine (deterministic and explainable)
V1 rule: double progression based on last **completed session** for the same exercise ID, using working sets only, and only if comparable set targets exist. If enough information is missing, say `no suggestion`.
- Target rep range is taken from the active session item (`repMin`..`repMax`).
- If comparable working sets use the same recorded external load, all hit `repMax`, none reports `discomfort`, and any supplied RIR is not zero, label `eligible_to_increase`; do **not** assign an exact next load automatically. Mixed loads or missing required comparison data yield `no_suggestion`.
- Otherwise `repeat_load_or_adjust_reps`; for discomfort return `review_exercise` with no load recommendation.
- Never infer injury-safe substitutions from muscle tags. Include a human-readable reason (`all 3 sets met 12 reps`, `missing comparison`, etc.).
- More complex periodization, automated deloading, volume scoring and estimated 1RM excluded from V1. Tests cover insufficient history, mixed weights, missing feedback, bodyweight sets, and discomfort.

### E. Timer and wake lock
- Rest timer stores `endsAt` UTC as persistent setting; displayed remaining time = `Math.max(0, endsAt - Date.now())`, recalculated on visibility/reopen. A `setInterval` is only a display refresh, NOT time authority.
- Use `navigator.wakeLock` if supported in secure context; release outside Gym Mode; reacquire on visibility after release; gracefully degrade when unavailable/denied.
- Do not promise push alerts or vibration when Android has suspended/closed the PWA. UI timer works on resume; haptics/sounds only best effort while visible.
- PWA SW uses **update prompt**, not forced reload. Never refresh in the middle of a workout without user consent.

### F. Daily habits / medication check-ins
- Generic `HabitDefinition` and `HabitLog`, seed optional **AM/PM** habit template but user names/time slots/doses; no hardcoded twice-daily clinical instructions or doses.
- Mark done, undo, or skip each slot with timestamp. Local date and IANA zone recorded at event time, allowing independent AM/PM logs.
- Any absorption interval or inventory estimation is user-configurable informational UI only, disabled by default; do not label an arbitrary timer a medical safety guarantee.
- No clinical claims or dose recommendations; app only records user-observed events.

### G. Body weight / trends
- Log positive finite weight in kilograms, timestamp + original local date/time zone. Allow multiple measurements/day, show edit/delete.
- For the 7-calendar-day chart use **the most recent reading per local date** among the current day and preceding six calendar days, then average available days. Display `N of 7 days` to avoid implying seven measurements exist. Empty and single-day states clearly handled.
- Gym start may offer a skippable measurement prompt; never block workout logging.

### H. Warm-up/cooldown
- Optional checklists and timers, with user-selected preparation activities and general instructions only. No fixed cross-trainer resistance prescription for injured joints. All stages skippable; countdowns do not gate the workout.
- Initial content may include cross-trainer, dynamic mobility, light exercise-specific warm-up, stretching. Remove/modify based on user preferences or treating professional's guidance.

### I. Home dashboard
- Today's habits and quick log, Resume/Start Workout, last workout summary, weight trend, Settings/Backups.
- One obvious primary call to action; calm UI, no streak shaming or excessive achievement banners. Date labels derived from saved local date/time zone.

## 6. Import/export and durability (non-negotiable)

Snapshot format:

```json
{
  "format": "personal-tracker-backup",
  "schemaVersion": 1,
  "exportedAt": "2026-10-26T12:00:00.000Z",
  "catalogVersion": "fedb-<pinned-commit>",
  "data": {
    "routines": [], "sessions": [], "sessionExercises": [], "setLogs": [],
    "exerciseOverrides": [], "restrictions": [], "musclePreferences": [],
    "bodyWeights": [], "habits": [], "habitLogs": [], "settings": []
  }
}
```

- Export user data as a downloadable JSON file via user gesture, with clear filename/date; browser may not be permitted to save automatically. Exercise media/catalog not included (IDs + catalog version retained).
- **Validation first:** reject unknown format, future unsupported schema, invalid types, malformed dates/UUIDs, references to absent session rows, duplicate IDs/ordinals and oversized unexpected content. Produce a safe preview: counts, date range, schema version, and whether current local data will be replaced.
- V1 supports **replace-all restore only**; user confirms explicit overwrite. Create a downloadable backup of current data *before* destructive restore; do not begin until user acknowledges it. Restore through one Dexie transaction over every app table; report errors without partial data loss. No silent merge, deduplication or partial restore.
- Tests: export/import round trip, malformed file keeps DB unchanged, duplicate index rejects, unsupported version rejects, interrupted restore rollback, no media required in backup, and catalog-version differences preserve historical names.
- `navigator.storage.persist()` may be requested from a meaningful Settings action, but persistence is not guaranteed; warn that clearing browser storage, reinstalling/changing origin, or storage eviction can remove data. Display `Last exported` and a gentle local reminder when old.
- Backups contain personal health data in **plain text** unless encryption is later implemented; warn before sharing or uploading. No analytics or tracking by default.

## 7. Offline/PWA deployment behavior
- Manifest: stand-alone, descriptive name, icons, theme and background colors, appropriate start URL/scope.
- Workbox precache hashed build assets, offline fallback navigation to SPA shell, locally bundled exercise data, relevant images/icons. Avoid oversized blanket precache: select critical assets and document cache budget.
- Install/serve over HTTPS (localhost allowed for development). After one warm/online launch, app shell and Gym Mode must work in airplane mode. Test on **production build** rather than assuming `vite dev` models SW behavior.
- Prompt for service-worker update and postpone activation/reload until user accepts; show an update available indicator without obstructing an active workout.
- Remote sync, external CDNs, exercise GIF APIs, telemetry and runtime AI calls are disallowed for V1.

## 8. Security, privacy, accessibility
- Local data only by default. No credentials or keys in frontend source/config; `.env` examples must contain no secrets.
- Use React escaping for displayed user text; avoid `dangerouslySetInnerHTML`. Validate imports and numeric inputs; cap notes/name lengths; reject NaN/Infinity and oversized backups. Avoid persisting medication details to console logs.
- Responsive at 360px width; touch targets roughly >=44 CSS px where possible; semantic buttons and labels; dark mode; sufficient contrast; keyboard/tab/focus states; reduce-motion respect.
- User-visible failures with recovery action for quota errors and validation errors. App-wide error boundary with safe details only.

## 9. Test contracts and release gate

### Domain/unit
- Progression: all-top-reps, mixed reps, no previous sets, equipment/exercise mismatch, discomfort, null load, non-comparable set counts.
- Restrictions: manual exclude blocks picker, caution flags without auto-prescription, unknown is not cleared as safe.
- Calendar: midnight and DST transition, multiple logs/day, 7-calendar-day rolling average with missing days, distinct AM/PM habit slots.

### Database/integration
- One active session; concurrent rapid set tap doesn't create two sets; routine edit after workout start doesn't change snapshots; transaction rollback on partial failure; migration from v1 to v2 fixture when introduced.
- Backup schema validation, compatibility, round-trip, no mutation on invalid imports.

### UI/E2E (Chromium/mobile viewport; real Android spot-check)
1. Create routine, log sets, reload, resume, finish, verify history.
2. Start workout, go offline, log sets, reload offline (after SW activation), complete; no data loss.
3. Import good backup into clean state, verify counts; import corrupt backup, verify existing data remains.
4. Mark AM and PM habits, edit timestamp/status, chart displays weight trend.
5. Service-worker update becomes available while workout active: no automatic reload.

### Required scripts
- `npm run dev` (development server)
- `npm run typecheck` (TypeScript validation)
- `npm run lint` (ESLint)
- `npm run test:unit -- --run` (Vitest, non-watch)
- `npm run test:e2e` (Playwright; critical paths)
- `npm run build` (production output)
- `npm run check` (typecheck + lint + unit tests + build)

Use npm CI (`npm ci`) in GitHub Actions for lint/typecheck/unit/build; run targeted E2E in review/push or before release. Keep errors concise; fixing failing tests is mandatory, not an optional polish step.

## 10. Deferred enhancements — no pre-emptive implementation

- V1.1: exercise equivalency mapping curated and user-confirmed, better trend charts, CSV export, finer backup prompts.
- V1.2: Capacitor wrapper only if native/local notifications and platform features justify new maintenance.
- V2: optional multi-device sync with explicit backend/auth/conflict model; optional AI explanatory assistant via secure server proxy and usage budget. ChatGPT Plus should not be assumed to pay for API calls.
- Future personal modules should reuse `HabitDefinition` and event-style logs rather than being bolted into workouts. No abstraction until a second concrete consumer demands it.

## 11. Primary technical references (use official docs when implementing)
- Vite: https://vite.dev/guide/
- TypeScript: https://www.typescriptlang.org/docs/
- Dexie: https://dexie.org/docs/
- Zod: https://zod.dev/
- Vitest: https://vitest.dev/guide/
- Playwright: https://playwright.dev/docs/intro
- Vite PWA: https://vite-pwa-org.netlify.app/
- Exercise dataset: https://github.com/yuhonas/free-exercise-db (audit media rights)
- Web storage eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Wake lock: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
