# budgetCal

A cashflow calendar: enter your balance, your pay schedule and your bills, and see your balance
day by day into the future. Local-first, no bank linking. Not a budget app — a "will I be short
before the 15th?" app.

- `docs/FOUNDATION.md` — why, for whom, and what we won't do
- `docs/PLAN.md` — the build plan and the engine's exact rules
- `docs/design/BRIEF.md` — design principles and the expectation-setting indicators
- `docs/prototype.html` — the original single-file prototype (reference only)

## Layout

| Path | What |
|---|---|
| `packages/engine` | Projection engine. Pure TypeScript, zero runtime dependencies, no clock, no `Date`. |
| `packages/model` | Stored data format: records, validation, migrations, export files, sync clock. |
| `config/` | IRS/SSA limits by year and bank-holiday rules. Data, never logic. |

## Commands

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm check      # lint + typecheck + tests
pnpm test       # tests only (~10s; includes property-based tests)
pnpm mutate     # mutation testing of the engine (~1 hour; runs nightly in CI)
```
