import fc from 'fast-check';
import { expect, test } from 'vitest';
import { assertCents, percentOf, sumCents } from '../src/money.ts';

test('percentOf: examples, including exact halves', () => {
  expect(percentOf(400_000, 600)).toBe(24_000); // 6% of $4,000
  expect(percentOf(1, 5000)).toBe(1); // 0.5¢ rounds away from zero
  expect(percentOf(-1, 5000)).toBe(-1);
  expect(percentOf(3, 5000)).toBe(2); // 1.5¢
  expect(percentOf(1, 4999)).toBe(0);
  expect(percentOf(333_333, 765)).toBe(25_500); // 7.65% of $3,333.33 = $2,549.9997
  expect(percentOf(0, 10000)).toBe(0);
  expect(Object.is(percentOf(-1, 1), 0)).toBe(true); // never -0
});

test('percentOf rounds half away from zero, to the nearest cent', () => {
  fc.assert(
    fc.property(fc.integer({ min: -1e10, max: 1e10 }), fc.integer({ min: 0, max: 10000 }), (cents, bp) => {
      const result = percentOf(cents, bp);
      const exact = cents * bp; // in 1/10000 cents
      const error = Math.abs(result * 10000 - exact);
      expect(error).toBeLessThanOrEqual(5000);
      if (error === 5000) expect(Math.abs(result * 10000)).toBeGreaterThan(Math.abs(exact));
      expect(Object.is(result, -0)).toBe(false);
    }),
    { numRuns: 2000 },
  );
});

test('refuses to lose precision', () => {
  expect(() => percentOf(1.5, 100)).toThrow(RangeError);
  expect(() => percentOf(100, 1.5)).toThrow(RangeError);
  expect(() => percentOf(Number.MAX_SAFE_INTEGER, 10000)).toThrow(RangeError);
  expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  expect(() => assertCents(0.1 + 0.2)).toThrow(RangeError);
  expect(sumCents([1, 2, 3])).toBe(6);
  expect(sumCents([])).toBe(0);
  expect(assertCents(5)).toBe(5);
});
