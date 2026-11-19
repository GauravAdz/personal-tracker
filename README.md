# Personal Tracker — Local-First Offline PWA

Free-to-run, privacy-first, single-user Android-oriented PWA for workouts, body-weight measurements, configurable daily habits, and user-managed exercise restrictions. No accounts, cloud backend, telemetry, ads, or AI in V1.

## Development & Quality Gates

Use Node 24 (`nvm use` if you use nvm) and npm. From the project root:

```sh
npm ci
npm run dev
```

All five primary routes are implemented using hash URLs (`HashRouter`) and relative asset paths (`base: './'`):
- **Home (`/`)**: Today dashboard with Resume/Start workout CTA, quick daily habit check-ins, last workout summary, 7-day body-weight summary, and backup export reminder.
- **Workouts (`/#/workouts`)**: Routine editor, Gym Mode active workout session, fast set logger, deterministic double-progression badge, UTC rest countdown + optional Wake Lock, and optional nonblocking warm-up/cooldown checklist.
- **Exercises (`/#/exercises`)**: Offline curated exercise catalog (`75` exercises with local CC0/Unlicense SVG diagrams + fallback), favorites, notes, explicit user restrictions (`allowed`/`caution`/`excluded`), and muscle-priority filters.
- **Health (`/#/health`)**: Generic scheduled daily habits (AM/PM or custom slots, independent same-day done/skipped/undo, history-preserving archive) and body-weight tracker with 7-calendar-day SVG/text trend.
- **Settings (`/#/settings`)**: Persistent storage request (`navigator.storage.persist()`), plain-text JSON backup export, validated preview, and transactional replace-all restore.

Run the full quality gate:

```sh
npm run check
```

Individual commands:
- `npm run typecheck` — strict TypeScript check (`tsc --noEmit`)
- `npm run lint` — ESLint (`--max-warnings 0`)
- `npm run format:check` — Prettier check
- `npm run test:unit -- --run` — Vitest unit & integration tests
- `npm run build` — TypeScript + Vite production build (`dist/`)
- `npm run test:e2e` — Playwright critical-journey E2E tests against the production build (install browser once via `npx playwright install chromium`)

## Static Deployment

`npm ci && npm run build` produces a self-contained static site in `dist/`:
- Works on any static HTTPS host (**GitHub Pages**, **Cloudflare Pages**, **Netlify**, **Vercel**, or static Nginx/Caddy) with **zero server-side rewrite rules** because routing uses hash URLs (`/#/workouts`, etc.) and Vite builds with `base: './'` for root or subdirectory hosting.
- Always deploy behind **HTTPS** so the Web App Manifest, Workbox service worker, `crypto.randomUUID()`, `navigator.storage.persist()`, and Screen Wake Lock work properly.
- No environment secrets or API keys are required or supported in V1.

## Offline PWA, HTTPS, and `localhost` Expectations

- **Secure context required:** Service workers, Web App Manifest installation, `crypto.randomUUID()`, and `navigator.storage.persist()` require **HTTPS** in production or `http://localhost` / `http://127.0.0.1` locally. Opening `dist/index.html` over `file://` or plain HTTP on a LAN IP will not activate the service worker.
- **Test offline mode on the production build:** `npm run dev` does not model production Workbox precaching. Build and preview (`npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`), open `http://127.0.0.1:4173` once online so the service worker activates, reload once, and then switch to offline/airplane mode.
- **Prompt-only updates (workout-safe):** `vite-plugin-pwa` uses `registerType: 'prompt'` and `skipWaiting: false`. New builds display a non-blocking banner (`UpdatePrompt`) and never auto-reload an active workout until the user explicitly chooses **Reload to update**.
- **Cache budget and zero external CDNs:** Workbox precaches hashed JS/CSS, `index.html` (`navigateFallback`), manifest, icons, and local static assets under a 2 MiB per-file limit. No runtime external CDNs, fonts, or APIs are requested.

## Manual Android Chrome Install & Airplane-Mode Smoke Checklist

Automated Chromium and Pixel 7 emulation (`npm run test:e2e`) does not replace a physical device spot-check. Before releasing to daily gym use, verify on an Android phone running Chrome over HTTPS:

1. **Installability:** Open the deployed HTTPS URL in Android Chrome, tap the browser menu → **Install app** (or **Add to Home screen**), launch from the Home Screen icon, and verify standalone display with no address bar.
2. **Warm offline cache:** Navigate once across Home, Workouts, Exercises, Health, and Settings while online so the service worker is active and controlling the page.
3. **Airplane-mode gym session:** Enable **Airplane mode** on the device, reopen the installed PWA from the Home Screen, create or start a routine, log at least 3 sets (including an edit and an undo), verify the rest countdown timer starts and stays accurate after locking/unlocking the screen, force-close and reopen the PWA offline, confirm the active session and logged sets resume intact, and finish the workout.
4. **Daily habits & body weight offline:** Still in airplane mode, mark AM and PM habit slots independently on Health, log a body-weight check-in, confirm the 7-day trend summary updates, and verify Home reflects the changes without a hard reload.
5. **Backup & recovery:** Reconnect or stay offline, go to **Settings**, request persistent storage, download a JSON backup file, verify it saves cleanly to Android Downloads, and confirm **Last exported** updates.
6. **Viewport & touch targets:** Confirm there is no horizontal scrolling on ~360px width screens and all buttons/inputs are comfortably tappable with one hand in both light and dark system themes.

## Documented Platform Restrictions (V1)

- **No background push notifications or guaranteed background vibration:** When Android suspends or closes a PWA, web timers cannot reliably fire background notifications or vibrate. The rest timer and preparation timers persist/calculate against UTC wall-clock deadlines (`endsAt`) and immediately show accurate remaining time on reopen/resume.
- **Screen Wake Lock availability:** `navigator.wakeLock` only works in visible secure contexts and may be unavailable or denied on certain browsers or battery-saver modes; the app degrades non-fatally when unsupported or declined.
- **Browser-governed storage persistence:** `navigator.storage.persist()` may remain denied on mobile Chrome until the PWA is installed or used regularly. Clearing browser site data, changing origin, or uninstalling can erase IndexedDB — downloading periodic JSON backups remains essential.
- **Plain-text local backups:** Exported `.json` backups contain personal health and workout records in plain text (no encryption in V1). Store and transfer backup files privately.
- **Single-device V1 scope:** No accounts, cloud sync, multi-device merge, analytics SDK, or AI calls are included in V1.

## Project Documentation

- `AGENTS.md`: coding standards and execution contract.
- `docs/ARCHITECTURE.md`: domain contracts, invariants, security, and architecture.
- `docs/IMPLEMENTATION_TASKS.md`: task sequence, acceptance criteria, and release checklist.
- `docs/PROGRESS.md`: completed task checkpoints, verification history, and decisions.
