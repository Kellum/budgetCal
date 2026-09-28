# Design Brief (D1)

**Status:** Draft for review
**Last updated:** September 28, 2026
**Feeds:** D2 structure and flows → D3 visual directions → D4 design system (see `docs/PLAN.md` §9)

This brief is the yardstick every later screen is judged against. It says who the app is for, what it
must feel like, and the rules that keep it honest. It deliberately says nothing about colours or fonts;
that is D3's job, and D3 will show two or three real options.

---

## 1. Who it's for

Everyday people who live close to paycheck-to-paycheck and have decided to get deliberate about it:
starting a savings habit, tired of being surprised by a bill landing before payday. They are
**intentional**: they will read a label if it tells them something true, and they'll lose trust fast
if the app ever overstates what it knows.

They check on their **phone**, often in a spare minute ("am I OK until Friday?"). They sit down at a
**laptop** occasionally to set things up, move things around and look further ahead.

The builder is also the first user, with a full-time job and a newborn. Minutes are scarce. That's a
feature of the brief, not a footnote: every interaction must respect a tired person with one free hand.

---

## 2. The one question

> **"Am I going to be OK until my next paycheck — and if not, when and by how much?"**

Everything on the first screen serves that question. Anything that doesn't is one level deeper.

---

## 3. What the references teach

| Reference | What we take | What we leave |
|---|---|---|
| **iOS Calendar** | A calendar people already know how to read. Month grid with quiet dots on phone; tap a day and its items appear beneath. Restraint: the calendar is the content, chrome disappears. | The empty, time-of-day grid; money has no time of day here. |
| **Morgen** | Calendar and list side by side on desktop, drag between them, keyboard-first. Density without clutter on a big screen. | Productivity-tool coldness. |
| **Todoist** | Speed of entry. Quick add that understands "rent 1850 on the 1st". Keyboard shortcuts for everything. A small, satisfying confirmation when something is done. "Today / Upcoming" as the default mental model. | Gamification (karma, streaks). Money isn't a game and streaks prey on stress. |
| **Airbnb** | Warmth and trust. Generous spacing, soft geometry, friendly but exact copy. Bottom sheets on phone that expand progressively. Honest totals ("total before taxes") — the numbers are never a surprise. | Photography-led layouts; we have no pictures, only numbers. |
| **Home Depot** | Utility first. Wayfinding that never leaves you lost. One bold brand colour reserved for action. Big, unmissable touch targets. Tone of a helpful person in an apron: plain words, gets the job done. | Retail density and promotional noise. |

**Synthesis:** a calm, familiar calendar (iOS Calendar, Morgen) that is fast to fill in (Todoist),
warm and exact in how it speaks about money (Airbnb), and never makes you hunt (Home Depot).

---

## 4. Principles

Ordered. When two conflict, the higher one wins.

1. **Every number can say how it knows.** Tap any figure and it explains itself: entered by you,
   calculated from your rules, estimated from your pay stub, assumed since your last balance. Nothing
   is shown with more confidence than it has. (§6 lists the indicators.)
2. **Answer the question in one glance.** Open the app → see whether you're OK until payday. No
   dashboard to decode, no tiles to scan.
3. **Calm, not alarming.** Colour carries meaning, never mood. A shortfall is stated plainly with a
   date and an amount, not dramatised. The design never manufactures urgency.
4. **Familiar before clever.** Use patterns people already know (month grid, agenda list, bottom
   sheet, drag). Novelty only where the job is new: the balance line and what-if.
5. **Fast to enter, forgiving to fix.** Setup cost is the product's moat and its biggest risk. A
   recurring bill should take about five seconds. Every change can be undone.
6. **Phone to check, desktop to arrange.** The same app, two postures. The phone is optimised for a
   ten-second check-in; the desktop for setup, dragging and looking a year ahead.
7. **Precise type for precise numbers.** Digits line up (tabular figures), minus signs are real minus
   signs, cents appear where they matter and nowhere else.

---

## 5. Anti-goals: what "a five-minute ChatGPT prompt" looks like, so we avoid it

- A grid of dashboard cards, each with a sparkline and a percentage change.
- Gradients, glassmorphism and glow used as decoration.
- Emoji as icons; a generic icon for every label.
- Green up-arrows and red down-arrows on everything.
- Headlines like "Your financial journey 🚀" or "You're crushing it!"
- Everything the same size and weight, so nothing is important.
- Empty states that just say "No data".
- Charts from a library's default theme.
- Modal dialogs for every edit.

---

## 6. Indicator inventory: setting expectations

Each indicator is quiet by default and speaks up only when it changes what you should believe.

| Indicator | When it appears | What it says | Tap for |
|---|---|---|---|
| **Balance freshness** | Always, next to the starting balance | "Entered today, 8:14 AM" · "4 days ago" | Balance history; "update balance" |
| **Assumed items** | Items between your last balance and today | Marked as assumed to have happened | Why: "You haven't updated your balance since Tuesday, so we assume these went through." |
| **Confirmed vs projected** | Everywhere a balance appears | Confirmed = your entries (solid). Projected = calculated (distinct treatment, same everywhere) | What a projection is, in one sentence |
| **Reliability fade** | Beyond ~90 days | The line and figures soften | "Further out means more assumptions." |
| **Estimate marker** | Paycheck-derived figures, cliff notices, next year's limits | "≈" plus a label | Which inputs made it an estimate |
| **Weekend/holiday move** | An item moved off a weekend or bank holiday | A small marker on the item | "Scheduled Sun Nov 1, moved to Mon Nov 2 (your rule: next business day)." |
| **What-if mode** | Any unapplied what-if change exists | A persistent, calm banner with Keep / Discard | The list of what-if changes |
| **Sync status** | Sync on | Synced just now · Syncing… · 1 change not synced yet · Offline | Last sync time and device; server copy retention date |
| **Edited elsewhere** | A record you're editing changes on another device | Inline: "Updated on your iPhone 5s ago — reload / keep mine" | The other version |
| **Orphaned changes** | A schedule edit leaves single-occurrence changes behind | One-time list | Keep as one-off / drop |
| **Same-day dip** | A day's outflows could post before its inflows and dip below $0 | A factual note in the day detail, never a warning colour | The posting-order explanation |

---

## 7. Voice

Plain, exact, warm. A helpful person who is good with numbers and never makes you feel bad.

| Do | Don't |
|---|---|
| "Projected to be $412 short on Oct 1. Your paycheck lands Oct 2." | "⚠️ Warning! You're going to overdraft!" |
| "You're projected to stay above your $300 cushion through Nov 15." | "You're all good! 🎉" |
| "Take-home projected to rise ≈$340 from Jun 18: your 401(k) reaches the 2026 limit." | "Get an extra $340 per paycheck!" |
| "Based on your balance from 4 days ago." | "Data may be inaccurate." |
| "Rent moved to Mon Nov 2 (Nov 1 is a Sunday)." | "Date adjusted." |
| "Nothing leaves this device." | "Bank-grade security." |

Rules:
- **Projected / estimated / assumed** are precise words; use them exactly as defined in §6.
- **Dates before adjectives.** "Short on Oct 1" beats "short soon".
- **No advice.** Never "you should", "consider", "try reducing". State the numbers; stop.
- **Retirement is visibility only.** Show where money went; never frame a contribution as something
  to change.
- **Sentence case** everywhere. No exclamation marks in anything about money.

---

## 8. States every screen must design for

First run (nothing entered) · a balance but no rules · rules but no balance · stale balance (1 day,
7 days, 30+ days) · everything fine · dips below cushion · goes below $0 · several accounts · one
account · a month with 14 items on the 1st · a very long bill name · a very large or negative number ·
what-if active · offline · syncing · sync error · edited on another device · reduced motion · large
text (Dynamic Type) · dark mode · the smallest supported phone (iPhone SE width, 375 pt).

---

## 9. The two postures

**Phone (check):**
1. Balance entry is one tap away from open, and the verdict is visible above the fold.
2. Next: the balance line for the chosen horizon, then "next 14 days" as a list grouped by day.
3. Month view is secondary: dots, tap a day to open a sheet with its items, move and skip.
4. Adding a bill: one field that understands "phone 85 on the 18th", with the form as a fallback.

**Desktop (arrange):**
1. Balance line across the top; month grid with named items you can drag; rules list alongside.
2. A table for entering or editing many rules quickly (keyboard, paste from a spreadsheet).
3. Paycheck waterfall and limit progress in a side panel, not a separate page.
4. Keyboard shortcuts for every frequent action, discoverable with `?`.

---

## 10. What D2 and D3 will produce

- **D2 (structure):** wireframes for phone and desktop covering the daily check-in, first setup, "can I
  move this?", reading a paycheck, and pairing a device. Grey boxes and real words. The point is flow
  and hierarchy, not style.
- **D3 (direction):** two or three distinct visual directions applied to the same real screen (the
  phone check-in with realistic numbers, including a dip below the cushion). Each will state its
  typeface, colour logic, density and how the balance line is drawn, with reasons. You pick one or
  combine them.

### Decided for D3 (September 28, 2026)

- **Working name: Citrus.**
- **Orange is identity, not function.** It carries the brand (mark, app icon, splash, marketing) and
  appears in the product only where it earns a job. It is never a status colour.
- **Orange never means "warning".** Orange reads as caution almost everywhere, so if it also marked
  "below your cushion", the brand would feel like a permanent alarm. Status colours are chosen
  separately in D3 and must be clearly distinct from the brand orange in both hue and lightness. They
  are never the only signal: patterns, labels and position carry the meaning too.
- **The supporting palette derives from the orange.** Neutrals are warmed slightly toward it, and any
  secondary accent is chosen to sit beside it, not compete with it.
- **Light and dark ship together** and are tested throughout, from D4's first component onward. Every
  token has both values; neither theme is an afterthought.

## 11. D2 wireframes

Published as a design canvas (private until shared from its Share menu):
https://claude.ai/artifact/UEtVb1RTHpk41CWCZSZE8r

Fifteen screens in five rows: the daily check-in (including a stale balance and updating a balance on a
payday), calendar and "can I move this?", four-step setup, desktop arrange and rules table, and
paycheck and sync. All numbers come from the engine running a sample plan, so the wireframes and the
maths agree.

### D2 decisions (September 28, 2026)

- **The home screen leads correctly:** verdict sentence, then balance line, then the next 14 days.
- **Phone tabs: Today, Calendar, Plan, More.** Pay details live under More › Personal › Pay details, not
  a tab: people set them up once and rarely return. Desktop keeps them under Settings, out of the
  sidebar. Revisit if testing shows people hunting for them.
- **Paycheck changes still come to you.** When a limit changes take-home, the notice appears on Today and
  in the calendar on that day. Only the detail lives in the menu.
