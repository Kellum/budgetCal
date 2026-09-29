# Citrus (working name) — cashflow calendar

Start every session by reading **only** `docs/wiki/INDEX.md`. Open a topic page or a section of
PLAN.md / BRIEF.md only when the task needs it. Never read `docs/wiki/sessions/` unless asked.

## Working agreement
- The owner reviews at every stage boundary. Stop there; don't run ahead.
- Recommend, don't list menus. Ask only questions that change the architecture.
- When the owner says "checkpoint" (or at session end): write `docs/wiki/sessions/<date>.md`, update the
  affected topic pages and `open-questions.md`, rewrite the "Now" section of `INDEX.md` (keep it short),
  and commit.

## Hard rules (from FOUNDATION)
- No bank linking, accounts, analytics. Numbers never leave the device unencrypted.
- Payroll deductions are never calendar events; self-initiated transfers always are.
- IRS/SSA limits and holidays live in `config/`, never in code.
- Projections are visibly projections. No advice, no "you should". Retirement: visibility only.
- No dark patterns; shortfall warnings never paywalled.

## Code
- `packages/engine`: zero runtime deps. No `Date`, `Intl`, `Math.random` (lint enforces). Dates are
  integer civil days, money is integer cents.
- `packages/model`: stored records (id, HLC timestamp, tombstone), Zod schema, migrations, export.
- `pnpm check` = lint + typecheck + tests. `pnpm mutate` ≈ 55 min; run it in a separate clone.
