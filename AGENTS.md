# SmartFin Project Rules

SmartFin is a React Native and TypeScript mobile app for personal finance. The product must stay local-first, offline-first, and privacy-first unless the user explicitly asks for backend or cloud work.

## Architecture

- Keep source code under `src/`.
- Use feature modules under `src/modules/<feature>/`.
- Supported modules are `dashboard`, `transactions`, `accounts`, `categories`, `budgets`, `creditCards`, `loans`, `goals`, `subscriptions`, `reports`, `security`, and `settings`.
- Each module may contain `ui`, `hooks`, `useCases`, `repositories`, `services`, `database`, and `types`.
- Screens and React components must not contain financial business rules.
- Screens and React components must not query the database directly.
- Put financial logic in module `useCases`.
- Put persistence access behind module `repositories` or shared `database` adapters.
- Put platform or external integrations behind `services` or `native`.
- Put repeated UI in `src/shared/components`.
- Put repeated hooks in `src/shared/hooks`.
- Put repeated pure helpers in `src/shared/utils`.

## TypeScript

- Keep TypeScript strict.
- Prefer explicit domain types for money, accounts, transactions, budgets, loans, and reports.
- Avoid `any`. If a boundary is unknown, model it with `unknown` and validate before use.
- Keep imports local and simple. Do not add path aliases unless Metro/Babel runtime resolution is configured at the same time.

## Money, Dates And Persistence

- Financial civil dates are `YYYY-MM-DD` in `America/Bogota` (CI runs with `TZ=America/Bogota`). Do not derive civil dates from UTC timestamps.
- The main ledger (accounts, movements, credit cards, subscriptions) stores COP amounts as `number` / SQLite `REAL`; there is no global migration to minor units.
- Newer domains use integer cents: the installment engine and installment history (`*_cents INTEGER` columns) and shared expenses. Never mix the two representations without an explicit, validated conversion (`Number.isSafeInteger`, explicit rounding).
- A financial action that must commit together runs inside a single transaction owner (`runSharedSQLiteTransaction` / `runSQLiteTransaction` in `src/database/atomicSQLite.ts`). A sequence of `await` calls is not a transaction. Do not pass `async` callbacks to a driver transaction and do not add nested `BEGIN`/`COMMIT`.
- Platform side effects (reminders, notifications, backup publication, UI refresh) happen only after COMMIT. An `unknown` commit result keeps its quarantine; never retry the financial body.
- Do not use `INSERT OR REPLACE` on parent tables (accounts, movements, cards): it deletes and re-inserts the parent and can affect children. Keep UPDATE + conditional INSERT.
- Schema changes go through numbered, transactional migrations and must work on Android API 24 (`minSdkVersion = 24`, SQLite 3.9.2).
- Details: `.claude/skills/smartfin-financial-domain/SKILL.md` and `.claude/skills/smartfin-sqlite-architecture/SKILL.md`.

## Documentation And Agent Configuration

- Start from `docs/INDICE.md`; phase documents (`docs/*-fase*`) are historical evidence, and code and tests win when they disagree.
- Agent skills live in two identical copies: `.claude/skills/` (Claude Code, source of truth) and `.agents/skills/` (Codex). Edit `.claude/skills/` and run `npm run skills:sync`; `npm run skills:check` compares them, and CI fails if they differ. When a third-party skill listed in `skills-lock.json` is updated, make sure the update lands in `.claude/skills/` before syncing, or the sync will revert it.

## Privacy And Offline Rules

- Do not add network calls, telemetry, analytics, remote sync, or third-party finance services without explicit user approval.
- Treat financial data as sensitive by default.
- Prefer local persistence and deterministic calculations.
- Keep future sync behind repository/service interfaces so the UI does not change when sync is added.

## Change Discipline

- Keep changes small and safe.
- Do not delete existing logic without explaining why.
- Work with existing user changes in the repository; do not revert unrelated edits.
- Run type checks or tests after structural changes when possible.

## Performance Volumes

- 100,000 movements represent about 50 years of real use (~2,000 per year, ~170 per month, ~5–6 per day), not a single load.
- Default representative fixtures (`__tests__/helpers/representativeHistory.ts`, fixed seed, civil dates, several accounts, categories and movement types, ending on the reference day): 100,000 movements over exactly 50 calendar years, 10,000 over 5 calendar years and 1,000 over 6 months. 50 calendar years produce 50 annual CSV files, not 51.
- Acceptance targets for history, dashboard, backups and other volume-dependent work must be measured on histories spread over that span.
- Do not run 100,000-movement tests concentrated in one day, one month or one import (for example 100,000 movements with the same date): they are not a SmartFin scenario. Volume tests at 100,000 must spread the movements over decades (40+ years). Ties at small sizes (for example 1,000 or 10,000 rows on the same day) remain valid correctness tests.
