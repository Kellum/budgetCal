/**
 * Money is integer cents. Percentages are integer basis points (1 bp = 0.01%).
 * The only rounding in the engine is percentOf: half away from zero, to the cent.
 * See docs/PLAN.md §4.2.
 */

export type Cents = number;
export type BasisPoints = number;

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a whole number of cents, got ${value}`);
  return value;
}

/** Sum that refuses to lose precision. */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw new RangeError('Sum exceeds the safe integer range');
  }
  return total;
}

/** `bp` basis points of `cents`, rounded half away from zero to the cent. */
export function percentOf(cents: Cents, bp: BasisPoints): Cents {
  assertCents(cents);
  if (!Number.isSafeInteger(bp)) throw new RangeError(`Basis points must be an integer, got ${bp}`);
  const product = cents * bp;
  if (!Number.isSafeInteger(product)) throw new RangeError('Percentage calculation exceeds the safe integer range');
  const magnitude = Math.floor((Math.abs(product) + 5000) / 10000);
  return product < 0 ? 0 - magnitude : magnitude; // 0 - 0 is +0, unlike -0
}
