# Citrus (working name) — cashflow calendar

Start every session by reading `docs/CHECKPOINT.md` (latest state and next steps), then `docs/PLAN.md`
(agreed plan, engine rules) and `docs/design/BRIEF.md` (design rules). `docs/FOUNDATION.md` is the
original decision record.

## Working agreement
- The owner reviews at every stage boundary. Stop there; don't run ahead.
- Recommend, don't list menus. Ask only questions that change the architecture.
- At the end of a session, or when the owner says "checkpoint", update `docs/CHECKPOINT.md`
  (newest session first) and commit it.

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
