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
