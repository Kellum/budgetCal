# Build Plan

**Status:** Agreed, stage 1 in progress
**Last updated:** September 28, 2026
**Companion to:** `docs/FOUNDATION.md` (the decision record). Where this plan departs from it, the
departure is listed in §12 with the reason.

---

## 1. Product in one paragraph

A cashflow calendar for everyday people who live close to paycheck-to-paycheck and are deliberately
starting to build savings. They enter their balance, their pay schedule and their bills; the app draws
the balance forward day by day and answers "will I be short before the next paycheck?". It shows people
their own numbers. It does not advise.

### Hard constraints (from FOUNDATION, restated so they are checkable)

1. No bank linking, no user accounts, no analytics. Financial data never leaves the device
   unencrypted. With sync off (the default) nothing leaves the device at all.
2. Payroll deductions (401k, 403b, HSA, FSA, insurance) are never calendar events. Self-initiated
   transfers (IRA, brokerage, savings) always are.
3. IRS limits, the Social Security wage base and bank holidays live in config files, never in logic.
4. Projections are visibly distinct from confirmed numbers. No copy claims certainty about a future
   balance.
5. Retirement features are visibility only. Nothing suggests changing contributions.
6. No dark patterns: shortfall warnings are never paywalled, no manufactured urgency, cancelling is as
   easy as signing up, a lapsed user can always view and export their data.

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 6.0 (strict) | Types are the cheapest test we have. 6.0 because `typescript-eslint` does not yet support 7.x. |
| Repo | pnpm workspaces monorepo | Engine, data model, sync and web app are separate packages with enforced boundaries. |
| UI | React + Vite | Largest ecosystem for accessible drag-and-drop (dnd-kit) and primitives (Radix). The hard logic lives in the engine, so the framework is a secondary choice. |
| Styling | Tailwind, driven by design tokens from stage D4 | Tokens first; Tailwind is the delivery mechanism, not the design. |
| Charts | Custom SVG with `d3-scale` / `d3-shape` | Threshold bands, projected-vs-confirmed styling and drag interaction fight chart libraries. |
| Delivery | Installable PWA (vite-plugin-pwa / Workbox) | Offline, installable on phone and desktop. On iOS, home-screen install exempts storage from Safari's 7-day eviction. |
| Local storage | IndexedDB via `idb`, one record per entity | Transactional, persistable (`navigator.storage.persist()`), and the shape sync needs. |
| Validation | Zod, in `model` only | Imported files and synced records are untrusted input. |
| Sync server | Cloudflare Worker + one Durable Object per sync group | Strict per-group ordering, WebSocket hibernation, free tier covers personal use. |
| Hosting | Cloudflare Pages (static) | Free, custom security headers, preview deploys. |
| Tests | Vitest, fast-check, Stryker (mutation), Playwright (Chromium + WebKit) | See §8. |
| CI | GitHub Actions | Lint, typecheck, test, mutation score gate. |

**Cost to run:** about $0/month plus a domain (~$12/yr). Sync on Cloudflare's free tier covers personal
use and early users; the paid Workers plan starts around $5/month (verify before launch). Sync has a
real, small per-user cost, so under FOUNDATION §9 it is never grandfathered.

### What this forecloses

- **No App Store presence** (PWA). Discovery through the stores is gone until a Capacitor wrapper is
  built, which the same codebase allows. Avoids Apple's 15–30% on subscriptions.
- **No home-screen widgets or background refresh** on iOS. Notifications only for installed PWAs, and
  we are not building notifications in v1 anyway (§6 #20).
- **Sync needs a server**, so "nothing leaves your device" is true only with sync off. With sync on it
  becomes "your numbers never leave your devices unencrypted, and we can't read them".

---

## 3. Repository layout

```
config/
  limits/2026.json          IRS + SSA limits by year (source URLs and verification flag per value)
  holidays/us-federal-reserve.json   holiday rules, not dates
packages/
  engine/                   pure projection maths. Zero runtime dependencies. No Date, Intl, Math.random.
  model/                    stored data format, Zod schemas, migrations, export envelope, HLC clock
  sync/                     (stage 7) change log, merge, encryption, transport
apps/
  web/                      (stage 2+) the PWA
  relay/                    (stage 7) the Cloudflare Worker
docs/
  FOUNDATION.md  PLAN.md  prototype.html  design/
```

Dependency direction is one-way: `web → sync → model → engine`. Engine imports nothing, not even the
config files: config is passed in as data, so the engine can run anywhere (a CLI, a worker, a test).

---

## 4. Engine semantics

This section is normative. When code and this section disagree, one of them is a bug.

### 4.1 Dates

- A date is a **civil date** — a day on a calendar with no time and no timezone — represented as an
  integer count of days since 1970-01-01 (`CivilDate`). Conversions use Howard Hinnant's
  `days_from_civil` / `civil_from_days` algorithms.
- Storage and exports use `YYYY-MM-DD` strings.
- "Today" is supplied by the caller. The web app reads the device's local calendar date once and
  re-reads it on midnight, focus and visibility changes. The engine never reads a clock.
- Consequence: DST cannot affect anything, and travelling across timezones does not move bills.

### 4.2 Money

- All amounts are integer **cents**. Every arithmetic result is checked to be a safe integer.
- Percentages are integer **basis points** (1 bp = 0.01%). `percentOf(cents, bp)` rounds half away from
  zero to the cent. That is the only rounding rule in the engine.
- Rule amounts are positive. The rule's kind decides the sign.

### 4.3 Schedules

Every schedule has a `start` date and an optional `end` date and/or `count`. `start` is inclusive and
also sets the phase (which week, month or year the interval counts from). `end` and `count` bound the
**scheduled** date, before any weekend adjustment.

| Kind | Fields | Scheduled dates |
|---|---|---|
| `once` | `start` | exactly `start` |
| `weekly` | `start`, `interval` (weeks) | `start + 7·interval·k`, computed directly, never by stepping |
| `monthly` | `start`, `days` (1–31 or `last`, one or more), `interval` (months) | in each month `m` with `(m − month(start)) mod interval = 0`: each day in `days`, clamped to the month's length |
| `monthly-weekday` | `start`, `nth` (1–4 or `last`), `weekday`, `interval` | the nth (or last) given weekday of each qualifying month |
| `yearly` | `start`, `month`, `day` (1–31 or `last`), `interval` (years) | clamped to the month's length (Feb 29 → Feb 28 in common years) |

- Occurrences are always computed from the rule's phase, never from the previous occurrence. A rule for
  the 31st yields Jan 31, Feb 28, Mar 31.
- "Twice a month" is `monthly` with two days, e.g. `[15, 'last']`. "Last business day of the month" is
  `monthly` with `['last']` and weekend adjustment `before`.
- Occurrences earlier than `start` are never produced, even within a qualifying month.
- If two day specs in one rule land on the same date (e.g. `[30, 'last']` in February), both
  occurrences are kept; each has a distinct identity (§4.5).
- There is no "5th weekday" option: months without one would silently skip, which surprises people.

### 4.4 Weekends and bank holidays

- Each rule has `adjust`: `before` (previous business day), `after` (next business day) or `none`.
  Defaults: income → `before`; bills and transfers → `after`.
- Business days exclude Saturdays, Sundays and Federal Reserve holidays. Holidays are computed from
  rules in `config/holidays/us-federal-reserve.json` (fixed dates, nth weekdays, last weekday), with the
  Federal Reserve observance rule: a holiday on Sunday is observed Monday; a holiday on Saturday is
  **not** observed on Friday.
- Adjustment is applied after scheduling, so it never shifts the phase. An adjusted date may land in a
  different month (a Saturday Nov 1 payday with `before` lands Friday Oct 31).
- `end`/`count` apply to the scheduled date; the window filter applies to the adjusted date.

### 4.5 Occurrence identity and changes to single occurrences

- An occurrence's key is `ruleId@YYYY-MM-DD` of its **scheduled** date, with `#2`, `#3`… appended only
  when one rule schedules more than one occurrence on the same date.
- An override is keyed by occurrence key and can: skip it, move it to another date, and/or change its
  amount.
- A moved occurrence appears on its new date regardless of where its scheduled date is relative to the
  projection window. (The prototype dropped moves whose original date was before the balance date.)
- An override whose key no longer matches any occurrence of its rule is **orphaned**. The engine reports
  orphans and does not apply them; the UI asks the user to keep each as a one-off or drop it (decision F).

### 4.6 What-if layer

- A scenario is a second set of overrides applied on top of the plan's own. Every event it touches is
  flagged `whatIf`.
- Scenario edits are stored, survive reload and sync, and are only merged into the plan when the user
  chooses Keep. Discard deletes them (decision D).

### 4.7 Accounts, balances, transfers

- A rule belongs to one account. Kinds: `income` (+), `expense` (−), `transfer` (− from its account, + to
  `toAccount` if that account is tracked; untracked destinations such as an IRA are outflows labelled as
  transfers, never as spending).
- A **balance entry** (anchor) is `{account, date, amount, clearedKeys}`. Each account projects from its
  latest entry (latest date; among equal dates, latest entered).
- Events dated before the anchor date are already reflected and are ignored. Events on the anchor date
  are applied unless their key is in `clearedKeys` (decision B: the app asks per item).
- Days between the anchor date and today are `assumed` (events presumed to have happened). Days from
  today on are `projected`. The anchor amount itself is the only `confirmed` number.
- Each day reports opening, closing, and `low` — the balance if that day's outflows post before its
  inflows. Closing is what's displayed; `low` feeds the factual note in decision C.
- Threshold (the "cushion") is per account. A day is flagged when closing < threshold; separately when
  closing < 0.

### 4.8 Paycheck waterfall

An income rule may carry a paycheck: `gross` plus ordered lines.

| Line stage | Amount basis | Examples |
|---|---|---|
| `pretax` | fixed cents or % of gross; each line declares which wages it reduces (`income`, `fica`) | Traditional 401(k)/403(b) reduce income wages only. HSA, FSA and §125 insurance reduce both. |
| `tax` | fixed cents, or % of income wages / FICA wages / gross | federal, state, local, Social Security, Medicare |
| `posttax` | fixed cents or % of gross | Roth 401(k), ESPP, union dues, garnishments |

- Net = gross − all lines. The engine never computes tax tables; users copy their lines from a pay stub.
  Taxes entered as a percentage of wages recompute automatically when a pre-tax deduction stops, which
  is what makes the cliff estimate honest. Every figure derived this way is marked as an estimate.
- **Contribution limits** (`401k-elective`, `hsa`, …) are per person, shared across all lines and rules
  with the same key. Traditional and Roth 401(k) share one limit.
- **Wage caps** (`ss-wage-base`) are per paycheck rule (per employer), and cap the wages a tax line
  applies to.
- Limits are tracked per calendar year of the pay date. Year-to-date comes from the user ("contributed
  so far this year, as of <pay date>") or, if absent, is estimated as the same deduction on every
  paycheck of that rule since Jan 1 (flagged `ytdEstimated`).
- Catch-up eligibility is by age attained by Dec 31 of the year (50+, 60–63 for 401k; 55+ for HSA),
  from an optional birth year.
- A year missing from `config/limits/` uses the latest known year and is flagged `limitsEstimated`.
- The engine emits **paycheck change notices** when net pay changes because a limit or cap was reached,
  and when it resets on Jan 1. Wording is factual: "Take-home projected to rise ≈$340 from Oct 24
  because your 401(k) deduction reaches the 2026 limit." Never "you could…".

### 4.9 Horizon and reliability

- The engine projects any window it is asked for. The app offers 30 days / 90 days / 6 months / 1 year
  and fades the line beyond 90 days (decision G).
- Every day carries its distance from today so the UI can grade reliability without recomputing.

---

## 5. Storage, versions, export

- IndexedDB holds one record per entity (account, rule, balance entry, override, scenario override,
  settings), a pending-changes log (for sync), and snapshots (last N, before every import, before every
  migration).
- Every entity carries `id` (UUID), `hlc` (hybrid logical clock timestamp), `device` and `deleted`
  (tombstone). This ships in stage 1 so sync never needs a migration.
- The document has a `schemaVersion`. Migrations are pure functions `vN → vN+1` in `model`. Loading
  from IndexedDB, importing a file and receiving a synced record all run the same chain.
- Export envelope: `{format: "budgetcal", schemaVersion, exportedAt, appVersion, data}`.
  - Old files always import. Migrations only go forward.
  - A file from a newer schema is refused with a clear message, never half-imported.
  - A fixture for every schema version is committed forever and CI proves each migrates and round-trips.
- Import replaces the current data, with a snapshot taken first (undoable).

---

## 6. v1 scope

Stages: **1** engine · **D** design · **2** calendar and balance line · **3** projection UX ·
**4** waterfall and cliff UI · **5** spreadsheet import · **6** export/import and onboarding · **7** sync.

| # | Item | In/Out | Stage | Notes |
|---|---|---|---|---|
| 1 | Schedules: once, every N weeks, monthly on day(s) incl. last, monthly nth weekday, yearly, every N months | IN | 1 | §4.3 |
| 2 | Start, end, count; pause a rule | IN | 1 / 2 | |
| 3 | Weekend + Federal Reserve holiday adjustment per rule | IN | 1 | §4.4, decision J |
| 4 | Single-occurrence skip / move / amount change; orphan detection | IN | 1 | §4.5 |
| 5 | Multiple accounts, transfers, untracked destinations | IN | 1 | §4.7 |
| 6 | Balance entry history, backdating, per-item "already cleared" | IN | 1 / 2 | decisions A, B, I |
| 7 | What-if layer (Keep / Discard) | IN | 1 / 3 | decision D |
| 8 | Paycheck waterfall, contribution limits, wage caps, change notices | IN | 1 / 4 | §4.8 |
| 9 | Sync-ready data format, migrations, export envelope | IN | 1 | §5 |
| 10 | Month calendar (desktop: chips + drag; phone: dots + tap sheet) | IN | 2 | |
| 11 | Balance line: confirmed points, projected line, fade past 90 days | IN | 2 | |
| 12 | Rule create/edit/delete, keyboard-first; "change from <date>" split | IN | 2 | decision E |
| 13 | Balance entry prompt on open, staleness indicator | IN | 2 | |
| 14 | Dark mode, `Intl` formatting | IN | 2 | |
| 15 | Per-account cushion, below-cushion zones, factual verdict copy | IN | 3 | never paywalled |
| 16 | Drag-to-move with keyboard / "Move to…" alternative | IN | 3 | |
| 17 | Filters: account, kind, amount ≥ $X | IN | 3 | |
| 18 | Saved views | DEFERRED | — | cheap, but wait for evidence people want them |
| 19 | Waterfall view, limit progress, cliff notices | IN | 4 | visibility only |
| 20 | Notifications | OUT | — | needs push infrastructure; FOUNDATION §11 warns against stress-driven notifications |
| 21 | Excel + CSV template, import with review, row-level issues | IN | 5 | SheetJS vendored, same-origin, lazy-loaded |
| 22 | JSON export/import with snapshot; quiet backup reminder | IN | 6 | |
| 23 | Onboarding built around entering 40 rules fast (bulk grid, duplicate, defaults) | IN | 6 | |
| 24 | Install prompt, persistent-storage request | IN | 6 | |
| 25 | Encrypted sync: pairing, live updates, merge, status labels | IN | 7 | §7 |
| 26 | Payment, trial, licensing | OUT of this build | launch | §11 |
| 27 | Bank linking, household sharing, AI | OUT | — | FOUNDATION §12 step 7 |
| 28 | Transaction logging / reconciliation | OUT | — | the anchor model makes it unnecessary |
| 29 | Categories and budgets | OUT | — | wrong positioning |
| 30 | Multi-currency, i18n | OUT | — | USD and English only |

---

## 7. Encrypted sync (stage 7)

### Goals
1. The server can never read user data.
2. The server is never the only copy: every device holds everything.
3. Offline edits merge on reconnect.
4. No edit is silently lost.
5. No accounts, emails or passwords.

### Keys and pairing
- Turning sync on creates a random 256-bit **sync key** and a random **group ID**. HKDF derives an
  **encryption key** and a separate **auth secret**; the server stores only a hash of the auth secret.
- **Pairing, Signal-style:** the existing device shows a QR code containing a short-lived pairing secret
  and an ephemeral public key. The new device scans it, both run ECDH through the relay authenticated by
  the pairing secret, and the sync key travels encrypted over that channel. The QR is worthless after
  pairing or 5 minutes. A typed code covers devices without cameras.
- **Recovery code** (the sync key itself) is shown once, with an optional non-blocking "I've saved it"
  confirmation. Losing every device and the code means the server copy is unrecoverable; the app says
  so plainly.
- Removing a device rotates the key: re-encrypt, re-pair remaining devices, delete the old group.
- Deliberately no per-message ratchet: every device holds plaintext anyway, and we sync state, not a
  message history.

### Data and merge
- One record per entity with HLC timestamp and tombstone (§5).
- Per-entity last-writer-wins by HLC. Losing versions are kept for 30 days in "changed on another
  device", restorable in one tap.
- Balance entries are append-only and cannot conflict.
- A record from a newer schema stops merging on that device and asks to update the app. Never downgrades.

### Protocol and timing
- Local save is instant. Push is debounced ~2s, and flushed immediately on `visibilitychange → hidden`
  with a keepalive request.
- Each push is one AES-256-GCM blob (random 96-bit nonce, AAD = group ID + schema version). The Durable
  Object assigns a sequence number and pokes connected devices over a hibernating WebSocket with
  content-free "seq N".
- Devices pull on open, focus, visibility, reconnect, on poke, and every 30s while visible as a safety net.
- Compaction: a device uploads an encrypted snapshot about every 200 changes; the server drops older
  entries.
- Expected latency phone → open laptop: about 2 seconds.

### Status and expectation indicators
- Sync label: *Synced just now* · *Syncing…* · *1 change not synced yet* · *Offline*.
- Editing a record that changes on another device: inline "Updated on your other device 5s ago —
  reload / keep mine". The form is never yanked away.

### Server retention (plain wording, exact dates)
- On enabling sync (acknowledged once): "If none of your devices connects for 12 months, we delete the
  encrypted copy on our server. Your data stays on your devices. Opening the app on any synced device
  resets the 12 months."
- Sync settings, always visible: "Server copy kept until at least <date>. Opening the app on any synced
  device moves this date forward." plus **Delete server copy now**.
- On a device not synced for 10+ months: a quiet line on the sync screen, not a pop-up.
- A device returning after deletion loses nothing and can start a new group from its data.
- The server sees: that a group exists, change counts, sizes, timing, connecting IPs. Request logging
  off. Stated in the privacy policy.

### Tests
Merge convergence and idempotence (fast-check); a 3-device simulation with random offline edits, clock
skew and out-of-order delivery; tamper / wrong-key rejection; two-browser Playwright pairing against a
local `wrangler dev` relay.

---

## 8. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Engine, example-based | Vitest | tables of edge cases: window boundaries, leap days, year crossings, 26 vs 27 biweekly paydays, day 29–31 in short months, weekend moves across month ends, holidays, count/end on an occurrence |
| Engine, properties | fast-check | **oracle equivalence** against a deliberately naive day-by-day implementation using `Date.UTC`; window-split invariance; phase-shift invariance; constant spacing and weekday; one occurrence per qualifying month; balance = anchor + Σ events; rule order irrelevant; conservation across transfers |
| Engine, mutation | Stryker (command runner) | ~1,500 deliberate bugs, nightly in CI, fails below 80%: the answer to "would the suite catch a silent off-by-one?" |
| Model | Vitest | schema fixtures per version migrate and round-trip; malformed input rejected |
| Web | Playwright on Chromium + WebKit | persistence across reload, drag-to-move, template import, export → wipe → import, offline, and **zero requests to any non-self origin** |
| Visual | Playwright screenshots | once a screen is approved in design review |

---

## 9. Design process

The user collaborates by reacting and editing, not by producing Figma files. Claude proposes;
the user redirects.

| Stage | Output | Runs |
|---|---|---|
| D1 Brief | `docs/design/BRIEF.md`: principles, references, indicator inventory, voice | with stage 1 |
| D2 Structure | wireframed flows, phone and desktop: daily check-in, first setup, "can I move this?", paycheck, pairing | after D1 review |
| D3 Direction | 2–3 distinct visual directions on the same real screen with real numbers | after D2 |
| D4 System | tokens, component workshop with every state, clickable key screens | after D3 pick |

Each UI stage (2–7) opens with a design pass for its screens and closes with review in the running app.

---

## 10. Decisions

| | Decision |
|---|---|
| A | Old balance entry: project from it; days since are *assumed*; stale indicator; history kept. |
| B | Items on the balance date: ask per item "already in this balance?". Unanswered = not cleared. |
| C | Same-day ordering: closing balance everywhere; a factual note when an outflows-first ordering would dip below $0 that day. |
| D | What-if is a separate layer with Keep / Discard; move/skip from day detail edits the real plan. |
| E | Schedule edits apply to all future occurrences by default; "change from <date>" splits the rule. |
| F | Orphaned overrides are listed once: keep as one-off or drop. Never deleted silently. |
| G | Horizon selector 30d / 90d / 6mo / 1yr; fade beyond 90 days; no certainty language. |
| H | Before the latest balance entry: confirmed points only, no running balance. |
| I | Balance entries can be backdated; default today. |
| J | Every rule picks a frequency and a weekend/holiday rule (before / after / none); income defaults before, bills after. Federal Reserve holidays included. |
| K | Negative amounts in an imported sheet are flagged in review, not silently flipped. |
| L | Engine uses cents; overviews show whole dollars; detail and forms show cents. |
| S1 | Recovery code shown once, optional confirmation. |
| S2 | Server copy deleted after 12 months of no device connecting, stated plainly with exact dates. |

---

## 11. Before launch (not in this build)

- Licensing: a Cloudflare Worker receives the payment provider's webhook and issues a signed license
  with an expiry, verified offline. It stores email and subscription status only.
- Lapsed subscription: app becomes read-only; export always works.
- Privacy policy and terms (not financial advice) in plain language.
- Re-verify `config/limits/` values each year.

---

## 12. Departures from FOUNDATION

| FOUNDATION | This plan | Reason |
|---|---|---|
| §7 target: contractors, freelancers | everyday paycheck-to-paycheck savers | owner's call; single expected amount per rule, no ranges |
| §12 step 7: sync later | encrypted sync is stage 7 of v1 | owner uses phone + laptop daily |
| §5 "nothing leaves the device" | true with sync off; with sync on, only ciphertext | consequence of the above |
| — | bank holidays in v1 | computable from rules, no yearly data needed |

---

## 13. Assumptions

1. One person per install; no profiles.
2. USD, US banking calendar, English.
3. Supported: current Chrome, Safari, Firefox, Edge; iOS 16.4+; Android.
4. WCAG 2.2 AA; every drag has a keyboard alternative.
5. No telemetry or crash reporting; an optional local "copy diagnostic info".
6. Import replaces, it does not merge.
7. Twelve-month maximum horizon; balance history kept indefinitely.
