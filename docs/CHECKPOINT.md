# Checkpoint

Rolling session log. Newest session first. Update at the end of every session (say "checkpoint").
Read this, `docs/PLAN.md` and `docs/design/BRIEF.md` before doing anything.

---

## Session 1 — Sep 27–29, 2026

### Where things stand
- **Stage 1 (engine + data format) is DONE** and reviewed by the owner. 185 tests, mutation score 89.3%.
  Code: `packages/engine`, `packages/model`. Config: `config/limits/2026.json`, `config/holidays/`.
- **Design:** D1 brief done (`docs/design/BRIEF.md`). D2 wireframes done and approved:
  https://claude.ai/artifact/UEtVb1RTHpk41CWCZSZE8r . D3 directions published:
  https://claude.ai/artifact/TooF42PrUzzyNpTKw4bM3J
- **Working name: Citrus.** Orange = identity, never "warning". Light + dark ship together.

### Decisions made this session (all also in PLAN.md / BRIEF.md unless noted)
- Stack: TypeScript 6.0, pnpm monorepo, React + Vite PWA, IndexedDB, Cloudflare Pages; engine has zero
  deps and no `Date`. Encrypted sync is stage 7 (Signal-style QR pairing, live updates, status labels,
  12-month server retention stated with exact dates).
- Target user: everyday paycheck-to-paycheck people starting to save (not freelancers).
- Waterfall + contribution cliff in v1. Weekend/holiday rule per rule (before/after/none), Fed holidays.
- Phone tabs: Today, Calendar, Plan, More. Pay details under More › Personal › Pay details.
- Collapsible: chart and desktop Plan panel only, collapse to a live one-line summary; verdict and
  balance freshness never collapse. Desktop focus mode on F. Per-device, not synced.
- **D3 feedback (Sep 29):** owner likes **Dusk light** and **Ledger dark**. Open: one "short" colour must
  work in both themes (Dusk uses violet, Ledger uses red). Resolve before D4.

### Proposed, awaiting owner confirmation (NOT yet in PLAN.md)
- **Auto-updated rules data:** app downloads a signed, static rules file (federal limits, SS wage base,
  holidays) from our own site. Carries nothing about the user. CSP allows only our origin.
- **State of residence dropdown:** yes, but used for guidance only (no-income-tax states, states that
  tax 401(k) contributions such as PA/NJ, "check with your state" note). **No automatic state
  withholding calculation** — see risks below.
- **Pay stub import:** on-device only. PDF text extraction (pdf.js) or on-device OCR (lazy-loaded), then
  a line-by-line confirm screen. Image never stored or uploaded. AI parsing stays a later, opt-in,
  paid feature (FOUNDATION §10).

### Why not auto-apply state withholding (the risk)
Withholding depends on each person's state W-4 equivalent, filing status, allowances, local taxes
(NYC, Ohio/PA cities), reciprocity between states, multi-state work, supplemental rates, and states
treating pre-tax deductions differently. Getting any of that wrong produces confident wrong numbers in
an app whose promise is honesty, makes us a payroll-tax engine to maintain for 50 states forever, and
edges toward advice/liability. Copying real numbers from the stub is more accurate and cheaper.

### Next steps
1. Owner picks the "short" colour for the Dusk-light + Ledger-dark combination.
2. Owner confirms the three proposals above → add to PLAN.md (scope table, config section).
3. D4: design system (tokens light/dark, type, spacing, components) from the chosen direction.
4. Stage 2: calendar + balance line UI (apps/web).

### Session notes
- Stryker's vitest plugin silently failed to activate mutants in some modules; use the command runner
  (already configured). Full run ~55 min; run it in a separate clone, never in the working tree.
- The canvases are the source of truth for design boards; they are not committed to the repo.
