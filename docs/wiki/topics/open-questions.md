# Open questions

1. **"Short" colour** for the combined direction (Dusk light + Ledger dark). Must be one colour in both
   themes. Recommended: violet (calmest, furthest from orange). Alternative: red, which needs Ledger's
   amber-leaning orange in dark.
2. **Confirm tax/stub proposals** in `tax-and-paystub.md`, then add them to PLAN.md scope.
3. Before launch (not now): lapsed-subscription behaviour (proposed: read-only, export always works).
4. **Income types dropdown.** Owner wants thorough coverage without the app feeling big. Candidate
   types: job (full-time / part-time), side work / gig, student aid (disbursements, often per term),
   alimony, child support, benefits (SSA, unemployment, disability), tips, other. Design principle to
   resolve: the type should change only *helpful defaults and wording* (e.g. student aid → "once per
   term", gig → "amount varies", child support → no paycheck breakdown), never add required fields.
   Pay details (waterfall) only for jobs. Open: which types in v1, whether "varies" amounts need a
   range, and whether support/alimony need any special handling (e.g. taxable vs not is advice-adjacent:
   likely just a label).
5. **Plaid, balance only (later paid tier, FOUNDATION §6/§12 step 7).** Pull only the account balance
   (Plaid Balance product), never transactions, to fill the "balance right now" anchor automatically.
   Privacy tension to resolve: Plaid access tokens cannot live in the browser, so this needs our server
   to hold tokens and call Plaid — the first time *financial data* passes through us. Options to weigh:
   (a) server fetches balance and forwards it without storing it (still sees it in transit);
   (b) server encrypts the balance to the user's device key before forwarding (server sees it briefly in
   memory, stores nothing); (c) keep manual entry as the default and make linking opt-in per account,
   clearly labelled "your bank balance passes through our server". Also: Plaid itself sees the bank
   login (their privacy terms apply), per-Item monthly cost means never grandfathered (§9), token
   rotation, incident plan, Plaid production review. Open: is balance-only worth breaking "nothing
   leaves your device" for opted-in users, and which option (a/b/c).
