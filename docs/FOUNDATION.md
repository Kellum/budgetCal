# Budget Calendar App — Project Foundation

**Status:** Pre-build planning
**Last updated:** September 16, 2026
**Purpose:** Carry-forward context document. Everything decided, rejected, and still open.

---

## 1. What This Is

A cashflow calendar. The user enters their income schedule and their recurring bills, and the app draws a running balance forward in time — day by day — so they can see when money comes out, when it comes in, and what their account will look like on any given future date.

The originating need is personal: existing tools in this space either look dated, are hard to use, or model the wrong thing. This is being built first as something the author actually wants to use, and second as a possible product.

**One-line positioning:** Not a budget app. A "will I be short before the 15th?" app.

---

## 2. The Core Insight

### Projection needs zero bank data

The entire engine is: a starting balance, plus a set of recurring rules, projected forward.

```
balance(day N) = starting_balance
               + sum(income events between today and N)
               - sum(expense events between today and N)
```

That's it. Recurring rules ("paid biweekly on Fridays," "rent on the 1st," "car payment on the 12th") plus one number. No bank connection is required for the product's central value to work. This is a weekend of core logic, not a moonshot.

**Consequence:** bank integration is a convenience layer, not a dependency. Build the engine first.

### Anchor and re-project

When the app opens, it takes today's *actual* balance as the anchor and redraws the forward line from there.

This elegantly solves unplanned spending. The user does not need to log the $60 they spent at a restaurant, categorize it, or reconcile anything. The next time they open the app, the anchor is simply $60 lower and the whole projection self-corrects. Drift never accumulates.

**The manual version of this is a single input box:** "What's your balance right now?" Three seconds of typing produces the identical result to a bank sync. That is the strongest argument for treating bank linking as optional polish — if the integration breaks, gets too expensive, or a user refuses it, the app degrades gracefully instead of dying.

---

## 3. The Category Differentiator

Nearly every personal finance app is **envelope-based**: categories, monthly targets, did-you-overspend-on-dining.

This product answers a different question — **cashflow timing**. Not "am I spending too much on groceries," but "does my balance go negative on the 12th before my paycheck lands on the 15th."

The market split is well documented: hands-on envelope methods (YNAB, Goodbudget) produce better budget adherence through enforcement, while automation-first apps (Monarch, Copilot) achieve roughly double the retention among busy users. The philosophical divide is whether financial health comes from discipline or visibility.

**This product sits firmly on the visibility side, but on a timing axis nobody occupies well.**

Features that follow naturally from that positioning:
- Running balance line as the primary visual, not a category pie chart
- Red zones where projected balance drops below a user-set threshold
- Drag-and-drop a bill to a different date and watch the line redraw ("what if I move this to the 20th")
- Filtered views (this account only, bills only, above $X only)

---

## 4. Data Model Foundations

### Two mechanisms, never conflate them

This is where competing apps get muddy, and getting it right is a quiet differentiator.

| Type | Mechanism | Where it belongs |
|---|---|---|
| 401(k), 403(b), HSA, FSA, employer insurance | Payroll deduction — automatic, employer-side, proportional to each paycheck, **never touches the bank account** | Paycheck model |
| Traditional IRA, Roth IRA, brokerage transfers | Self-initiated transfer from checking | Calendar event — functionally identical to a bill |

A 401(k) contribution must **not** appear as a calendar withdrawal. It already happened upstream of the money arriving. An IRA transfer must.

### The paycheck waterfall

The feature hiding inside "withdrawal from income visibility":

```
GROSS PAY
  − pre-tax deductions   (401k traditional, HSA, FSA, insurance premiums)
  = taxable wages
  − taxes                (federal, FICA, state, local)
  − post-tax deductions  (Roth 401k, ESPP, garnishments, union dues)
  = NET PAY  →  the number that actually lands in the bank
```

Most budget apps start at net pay and silently ignore the 25–35% that vanished before it hit the account. Showing a user where their gross actually went is genuinely uncommon in this category.

### The contribution-limit cliff

Falls out of the waterfall almost for free, and is possibly the single most novel feature discussed.

If someone is on pace to max their 401(k) in October, their remaining paychecks that year get *bigger* — the deduction stops. The app can surface this months ahead:

> "Your take-home rises $340 starting Oct 24."

No known competitor shows this. It is pure cashflow timing, exactly this product's lane, and it requires only the annual contribution limits as configurable values updated each year.

**Implementation note:** keep IRS limits in a config file, not hardcoded. They change annually.

---

## 5. Architecture & Privacy

### Local-first as the default posture

- Store everything in the browser (IndexedDB)
- No accounts, no server, no signup required for the core product
- Export/import as a JSON file for backup and device transfer

**Why this is the right call, on three separate grounds:**

1. **Compliance** — if you never hold user data, your regulatory surface is close to zero. No breach exposure, no data subject requests, no storage policy.
2. **Marketing** — "your numbers never leave your device" is a claim funded competitors structurally cannot make. There's a documented audience uneasy that the major apps require connecting bank accounts through an aggregator just to function.
3. **Economics** — a local-only tier costs nothing per user, forever. It scales infinitely at zero marginal cost, which unlocks pricing models described in §8.

### What changes if bank linking is added

Access tokens cannot live in a browser. Adding Plaid means:
- A backend server
- Encryption at rest
- Token rotation and secure key management
- An actual security posture and incident plan
- Plaid's production access review

This is a real architectural fork. Treat it as a separate product surface, not a feature toggle.

---

## 6. Bank Integration (Plaid)

### Use Balance, not Transactions

Since the only goal is a live balance number for the anchor:

- **Balance** — one number per account. Cheap, simple, no categorization engine, no transaction sync, no dedupe logic, no merchant-name cleanup.
- **Transactions** — what everyone else uses, and a large amount of work this product does not need.

Choosing Balance alone cuts both cost and build complexity substantially.

### Current access situation (verify before building)

Plaid offers a free Trial plan for new US/Canada teams created on or after April 15, 2026. It permits real production data at no cost, capped at 10 Production Items, and includes Balance among its bundled products. It reaches most OAuth institutions — including Bank of America, Chase, and Wells Fargo — before full Production approval.

Beyond 10 Items, a paid plan is required. Plaid does not publish a price list; Pay-as-you-go and Growth rates are shown during the Production access application. Custom/Scale plans require annual commitment and a higher minimum spend. Products like Transactions and Liabilities commonly use monthly subscription pricing per active Item.

**Practical read:** personal-scale use is now genuinely free. A product with paying users is not — and the cost is *recurring per connected account*, which drives the grandfathering rules in §9.

**Verify directly at plaid.com before committing.** This changed in April 2026 and may change again.

---

## 7. Competitive Landscape

Pricing verified September 2026 — re-check before using in any public material.

| Product | Price | Notes |
|---|---|---|
| Monarch Money Core | $99.99/yr ($14.99/mo) | Founded by ex-Mint staff. 7-day trial. No free tier. |
| Monarch Plus | $199/yr | Added 2026, aimed at users modeling their full financial future |
| YNAB | $109/yr ($14.99/mo) | 34-day trial, no card. Zero-based budgeting. Free year for verified students. |
| Copilot Money | $95/yr ($13/mo) | Apple + web. One-month trial. Strongest categorization AI. |
| Quicken Simplifi | ~$71.88/yr | Lowest of the majors |
| Empower | Free | Dashboard only |
| CalendarBudget | ~$5–10/mo | Closest direct competitor. Dated UI, weak UX. |

### Key readings

**The market clears around $95–110/year.** CalendarBudget is priced at the discount rack, not the ceiling. This is not a cheap category.

**Mint shut down in 2024**, scattering a large user base and creating the opening Monarch and Copilot grew into. The category has proven, repeatedly, that people will pay real money.

**Better UX is a weak moat.** Design is the most copyable thing you can build, and a funded incumbent can hire a designer. Prettier gets you the trial, not the renewal. What actually retains: accumulated setup cost (40 recurring rules entered — nobody does that twice) and habit.

### The central market tension

The people who most need "will I overdraft on the 12th" are often the people least able to pay $100/year for it.

CalendarBudget's actual paying base is probably not broke people. It's **contractors, variable-income earners, freelancers, and small business owners** — people with real money but lumpy, irregular cashflow. That is who to price and design for.

---

## 8. Pricing Strategy

### Decisions made

**No free tier.** Free users in personal finance generate real support load and rarely convert. A paid floor also creates commitment — people who paid anything at all actually set the product up, and setup is what retains them.

**Rejected: a $2/month ($24/year) low tier.** Reasoning:

- *Payment friction is binary, not proportional.* The expensive step is getting someone to pull out a card and trust a small app with their financial life. That step costs the same at $24 as at $60. Going $0 → $24 may lose ~90% of signups; $24 → $60 loses maybe another 20%. You'd pay nearly the full cost of having a paywall while capturing a fraction of the benefit.
- *Price is a trust proxy here.* In a market anchored at $95–110, being 4x cheaper doesn't read as "great value." It reads as "hobby project, probably gone in two years, do I want my bank data in it?"

**The real answer to churn fear is trial length, not a cheap tier.**

### Trial: 60 days, no card up front

This product has a specific, honest argument for an unusually long trial that no competitor can easily match:

> A cashflow projection cannot prove itself in a week. You need to live through at least two paydays and a full bill cycle before the calendar tells you anything you didn't already know.

Monarch's 7 days is structurally too short for this kind of product. Copilot gives a month, YNAB 34 days. Sixty days is defensible, differentiating, and — critically — by day 60 the user has entered all their recurring rules. That sunk cost is what drives renewal.

### Target numbers

- **Core:** $50–60/year
- **Second tier (later):** $100–120/year — this is where bank linking lives, justified by real per-Item recurring cost

### Launch with ONE price

Do not ship two tiers on day one. You don't yet know which features people will pay extra for, and a two-column pricing page creates decision paralysis with no data behind it. Launch one price, watch what people ask for, then split.

### Billing cadence

Push annual. Monthly billing churns hard in personal finance — the January signup / March cancellation pattern is well established. Annual also matches the actual usage rhythm, since financial planning is seasonal.

---

## 9. Grandfathering & Founding Members

### The governing rule

**Gate and grandfather by one question: does this feature cost money every month a user has it?**

**✅ Ship it and grandfather it — pure computation, zero ongoing cost**
- Paycheck waterfall
- Retirement and payroll deduction modeling
- Contribution-limit cliff alerts
- Scenario planning / what-if
- 12-month projection horizon
- Custom saved views and filters
- Local storage and export

Serving these to a grandfathered user in 2029 costs nothing. Generosity here has no price. Give them away.

**❌ Never grandfather — recurring per-user cost**
- Bank linking (Plaid bills per connected Item per month, forever)
- Cloud sync and hosted storage
- Any future AI features (see §10)

If bank linking is folded into a locked-in $50/year rate and a user links four accounts, you can end up **net negative on that user for as long as they stay.** That's not a pricing mistake you can undo. Either keep bank linking out of launch entirely, or make it a paid add-on from day one with its own line item.

### Founding member mechanics

Grandfathering is a genuinely useful launch mechanic. "Founding member, rate locked" drives early signups, and early signups are the scarce thing.

Two pieces of precision, because casual promises here become real liabilities:

1. **Lock the price, not the feature set forever.** Wording: *"Your rate won't increase while your subscription remains active."* Not *"you get everything we ever build."*
2. **Make the rate forfeit on cancellation.** Otherwise people churn out and back in to farm the founding price.

Keep the door open for genuinely new tiers later. If something with real cost behind it gets built — advisor sharing, AI features, household accounts — that's a new product line founding members can opt into, not a betrayal of the lock.

### Terminology note

Alpha comes *before* beta, not after. The sequence is alpha (internal/rough) → beta (external testers) → general availability. Worth getting right in any public-facing copy.

---

## 10. AI Features (Future)

Flagged as a planned direction. Not yet designed. Key foundations to carry forward:

### Economics

AI inference is **per-use variable cost** — it lands squarely in the "never grandfather" bucket alongside Plaid. Whatever gets built, it needs either its own tier, a usage allowance, or an add-on price. Do not fold token-billed features into a locked founding rate.

Budget for the cost being unpredictable. A single user who leans hard on a chat feature can cost many multiples of an average user.

### Good candidate uses

These are where AI genuinely helps without stepping into advice:
- Parsing a pasted pay stub into a structured paycheck waterfall (tedious manual entry, high value, bounded task)
- Natural language rule entry — "I get paid every other Friday starting the 3rd" → structured recurring rule
- Plain-English explanation of *why* the projection dips on a given date
- Reading a bill or statement screenshot to extract amount and due date

### Uses to avoid

- Anything resembling investment advice or recommendations
- Predicting spending the user hasn't told you about
- Auto-adjusting contributions or recommending people change retirement elections

---

## 11. Ethics & Principles

This product touches financially stressed people and retirement money. Both raise the stakes above a normal SaaS app.

### The retirement hazard

Making 401(k) deductions visible is valuable. It also carries a real risk: showing someone "$480/month is leaving your gross before you see it" can read as an invitation to reduce contributions and free up cash today.

**Frame every retirement feature as visibility, never optimization.** No "you could have $X more per paycheck" framing. No suggestions to lower contributions. Show the money, explain where it went, stop there.

### Do not monetize fear

The core value prop is adjacent to anxiety — overdrafts, shortfalls, running out. That creates temptation toward dark patterns. Explicit no-list:

- No paywalling the shortfall warning ("upgrade to see if you'll overdraft")
- No manufactured urgency or alarm styling beyond what's factually warranted
- No engagement-maximizing notifications built on financial stress
- Cancellation must be as easy as signup — the category is notorious for the opposite

### Projections are arithmetic, not prophecy

The forward line is math on user-supplied assumptions. It will be wrong whenever reality differs from the rules entered.

- Present it as a projection, visibly distinct from confirmed data
- Never claim certainty about a future balance
- Make it obvious how far out the data is reliable

### Not financial advice

The product shows a user their own numbers back to them. It does not recommend, advise, or plan. Keeping that line clean is both an ethical stance and a liability boundary. Terms of service should state it plainly.

### Data handling

Local-first is being chosen partly for compliance convenience, but it should be held as a genuine commitment. If a server ever enters the picture:
- Collect the minimum necessary, never sell or share
- Encrypt at rest and in transit
- Publish a plain-language privacy policy, not a wall of boilerplate
- Make full export and full deletion easy and obvious

---

## 12. Build Order

1. **Rules engine + calendar view** — recurring income and bills, running balance line. Manual balance entry. Local storage only.
2. **Projection UX** — red zones, threshold alerts, drag-to-move-a-bill, filtered views.
3. **Paycheck waterfall** — gross → net modeling, payroll deductions, IRA transfers as calendar events.
4. **Contribution-limit cliff** — the novel feature. Cheap once the waterfall exists.
5. **Export/import, polish, onboarding.** Onboarding matters disproportionately here because setup cost *is* the moat — make entering 40 rules as painless as possible.
6. **Launch at one price, 60-day trial, founding rate lock.**
7. *Then, based on what users actually ask for:* bank linking, cloud sync, household sharing, AI features — as a separate paid tier with its own economics.

---

## 13. Open Questions & Risks

**Unresolved:**
- Web-only, or PWA/mobile? Local-first constrains this — IndexedDB is per-device, so multi-device needs sync, which needs a server.
- What exactly does the second tier contain at launch-plus-one-year?
- Household/partner access — does it require a server, or can it work via shared export files?
- Pricing for the bank-linking tier depends on actual Plaid rates, which aren't visible until the Production application.

**Biggest risk: distribution, not build.**
"I built a nicer one" does not get you users. The engineering here is tractable; being found is not. Worth thinking about early — where do variable-income earners and contractors actually congregate, and what would make one of them tell another?

**Second risk: the personal-use trap.**
Building for yourself is the best possible starting point and a known failure mode. The features you want may not be the features a market wants. The 60-day trial is partly a mechanism for finding that out cheaply.

---

## Appendix: Facts To Re-Verify Before Use

- Plaid Trial plan terms and the 10-Item cap (changed April 15, 2026)
- All competitor pricing (verified September 2026)
- IRS contribution limits for 401(k), 403(b), IRA, HSA — these change annually
- Whether Plaid's Balance product is included in whatever plan tier applies at build time
