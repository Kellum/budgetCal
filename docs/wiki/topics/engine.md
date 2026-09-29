# Engine and model — summary

- `packages/engine`: civil dates as integer days, cents, schedules, weekend/Fed-holiday adjustment,
  overrides + what-if, per-account projection, paycheck waterfall. Rules: `../../PLAN.md` §4.
- `packages/model`: records with id/HLC/tombstone, Zod schema v1, migrations, export, merge.
- `pnpm check` (lint, typecheck, 185 tests). Mutation 89.3%: `pnpm mutate` (~55 min), run in a
  separate clone; the Stryker vitest plugin is broken, command runner is configured.
