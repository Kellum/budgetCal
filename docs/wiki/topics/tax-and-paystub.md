# Tax, limits, pay stubs — summary

Built: engine computes net pay from stub lines (no tax tables), shared 401(k) limit, SS wage cap per
employer, catch-ups by age, change notices. Limits in `config/limits/2026.json` (SS wage base unverified).

Proposed, awaiting owner confirmation:
- **Auto-updated rules file** (federal limits, SS wage base, holidays) downloaded from our own site,
  signed, carries nothing about the user.
- **State dropdown for guidance only** (no-income-tax states; PA/NJ tax 401(k) contributions;
  "check with your state"). **No automatic state withholding**: depends on state W-4s, filing status,
  local taxes, reciprocity, multi-state work, differing pre-tax treatment; wrong numbers would break the
  honesty promise, create a 50-state maintenance burden and edge toward advice.
- **Pay stub import on-device only**: PDF text or on-device OCR, line-by-line confirm, image never
  stored or uploaded. AI parsing later, opt-in, paid.
