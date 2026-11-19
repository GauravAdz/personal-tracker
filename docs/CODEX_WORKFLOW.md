# CODEX_WORKFLOW — Minimize tokens without sacrificing correctness

## Why this packaging is efficient
Never paste the entire product blueprint into every Codex chat. Codex can reference checked-in files. `AGENTS.md` contains stable rules (short, always useful); architecture details are in a lookup document; tasks are small. Commands and tests are explicit so Codex spends fewer tokens guessing or arguing over architecture.

## 0. One-time setup
1. Create a Git repository and copy this package's `AGENTS.md` + `docs/` to its root.
2. Open Codex with working directory set to the repo root. Start on a new branch for the app.
3. Keep each Codex interaction on a **single task ID**. Commit after review/acceptance so rollback and diffs stay small.
4. For best results, use a Codex model/configuration with repository file access, command execution and test-running; tools and model choices vary by environment.

## 1. First Codex prompt (copy exactly)

```text
Implement T01 only from docs/IMPLEMENTATION_TASKS.md.
Obey AGENTS.md and relevant sections of docs/ARCHITECTURE.md.
Run required checks, fix failures, update docs/PROGRESS.md.
Do not implement future tasks or add unapproved dependencies.
Reply in the short format required by AGENTS.md.
```

## 2. Every later Codex prompt (replace XX)

```text
Implement TXX only from docs/IMPLEMENTATION_TASKS.md.
Follow AGENTS.md; read only relevant architecture sections and affected code.
Run targeted tests and applicable checks; update docs/PROGRESS.md.
Stop after this task and summarize briefly.
```

### One-line alternative when Codex already has repository context

```text
Implement TXX per repo task card and AGENTS.md. Test, update PROGRESS.md, stop.
```

## 3. Example task review prompt

```text
Review TXX changes against its acceptance criteria. Focus on data loss,
wrong persistence behavior, security, and failing tests. Report actionable
problems with file:line references; do not rewrite unrelated modules.
```

## 4. Example targeted bug-fix prompt

```text
Fix only the failing test/error below. Find root cause, add regression test,
run relevant checks, and keep the change focused:
<paste SHORT exact error, not full terminal output>
```

## 5. Rules that actually save tokens

| Do | Avoid |
|---|---|
| Point to one task ID | Re-explaining all product goals |
| Store decisions in checked-in docs | Conversational memory as sole specification |
| Request 1 vertical slice | "Build the full app" mega-prompts |
| Let Codex inspect relevant files | Pasting entire repository files into prompts |
| Use shared types, schema and tests | Repeating validation in every screen |
| Ask for short test results and diff summary | Printing massive logs or whole-file output |
| Run narrow tests while coding; full checks at boundaries | Rerunning all browser tests after every tiny change |
| Make decisions explicit once | Re-litigating the framework each session |
| Commit a known-good task checkpoint | Mixing several unfinished refactors |
| Preserve exact failure output when needed | Hiding failures to reduce token use |

**Never optimize token usage by deleting tests, skipping necessary validation or suppressing errors.** That trades small immediate savings for expensive debugging later.

## 6. Task boundaries and review cadence
- T01–T05: contract/migrations/backup/offline. Review carefully, since defects here threaten data reliability.
- T06–T09: dataset/routines/restrictions. Ensure original-source attribution and manual restrictions are correct.
- T10–T13: Gym Mode. Test on a real phone after T11; don't wait until all features are finished.
- T14–T16: habits/weight/dashboard. Check timezone/multi-entry edge cases.
- T17–T18: guidance and release. Do a real offline workout rehearsal.

Codex is not required to produce a screenshot/demo/video after every task. Request UI screenshots only for key screens or when investigating layout bugs.

## 7. Handling decisions and deviations
When the implementation hits uncertainty, use this priority order:
1. Preserve user data and the original product requirements.
2. Follow `ARCHITECTURE.md` invariants and explicitly defined non-goals.
3. Prefer built-in browser/React capabilities over extra libraries.
4. Make the smallest reversible choice and note it in `PROGRESS.md`.
5. If an irreversible architecture change is genuinely needed, ask for approval before making it.

If a task legitimately changes an interface, update **one canonical definition** in `ARCHITECTURE.md` and its tests. Don't copy conflicting schemas into README, prompts and comments.

## 8. Checkpoint and context reuse
- After an accepted task: `git status`, inspect concise diff, run required gates, commit with message `feat(TXX): <summary>` or `chore(TXX): <summary>`.
- Begin the next session from repo files and `PROGRESS.md`; do not paste prior conversations.
- Ask for a **short** summary of decisions/blockers only, then move on.
- Maintain one concise log in `PROGRESS.md`; archive nonessential discussion rather than expanding the permanent instructions.

## 9. Useful terminal checks

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit -- --run
npm run build
npm run check
npm run test:e2e        # on relevant UI/offline milestones
```

If a test requires SW activation, serve the **production build**, not just `vite dev`. Use browser-context offline testing after an initial visit and service-worker activation; test Android Chrome manually at least once. Playwright's service worker handling differs from ordinary request mocking.

## 10. Cost / reliability decision gate
Only consider a paid API or hosted database when you identify a specific user requirement that the local app fails to meet. Any proposed addition must include: feature served, monthly usage estimate, privacy impact, offline degradation, cancellation/fallback plan, and explicit user approval.
