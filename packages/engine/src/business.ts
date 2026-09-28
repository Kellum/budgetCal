/**
 * Business days and weekend/holiday adjustment. See docs/PLAN.md §4.4.
 *
 * Holidays are computed from rules supplied as data (config/holidays/*.json), so no list of
 * dates ever needs updating. The observance policy is data too: the Federal Reserve observes
 * a Sunday holiday on Monday but does not close on the Friday before a Saturday holiday.
 */

import {
  type CivilDate,
  type NthWeekday,
  type Weekday,
  MAX_YEAR,
  MIN_YEAR,
  addDays,
  civil,
  nthWeekdayOfMonth,
  toYearMonthDay,
  weekday,
} from './date.ts';

export type HolidayRule =
  | {
      readonly name: string;
      readonly type: 'fixed';
      readonly month: number;
      readonly day: number;
      readonly fromYear?: number;
      readonly toYear?: number;
    }
  | {
      readonly name: string;
      readonly type: 'nth-weekday';
      readonly month: number;
      readonly weekday: Weekday;
      readonly nth: NthWeekday;
      readonly fromYear?: number;
      readonly toYear?: number;
    };

export interface HolidayCalendarConfig {
  readonly name: string;
  /** What happens to a fixed-date holiday that falls on a weekend. */
  readonly observance: {
    readonly saturday: 'previous-friday' | 'none';
    readonly sunday: 'next-monday' | 'none';
  };
  readonly rules: readonly HolidayRule[];
}

export interface BusinessCalendar {
  isHoliday(date: CivilDate): boolean;
  isBusinessDay(date: CivilDate): boolean;
  /** Observed holiday closures in a year, ascending. */
  holidaysIn(year: number): readonly CivilDate[];
}

export type Adjustment = 'before' | 'after' | 'none';

/** Longest run of non-business days tolerated before the calendar is declared broken. */
export const MAX_ADJUSTMENT_DAYS = 7;

export function createBusinessCalendar(config: HolidayCalendarConfig): BusinessCalendar {
  const byYear = new Map<number, ReadonlySet<CivilDate>>();

  const observedIn = (year: number): ReadonlySet<CivilDate> => {
    const cached = byYear.get(year);
    if (cached) return cached;
    const dates = new Set<CivilDate>();
    // A holiday in an adjacent year can be observed in this one (Sat Jan 1 → Fri Dec 31).
    for (const y of [year - 1, year, year + 1]) {
      if (y < MIN_YEAR || y > MAX_YEAR) continue;
      for (const rule of config.rules) {
        if ((rule.fromYear !== undefined && y < rule.fromYear) || (rule.toYear !== undefined && y > rule.toYear)) continue;
        let date: CivilDate;
        if (rule.type === 'nth-weekday') {
          date = nthWeekdayOfMonth(y, rule.month, rule.weekday, rule.nth);
        } else {
          date = civil(y, rule.month, rule.day);
          const day = weekday(date);
          if (day === 6) {
            if (config.observance.saturday === 'none') continue;
            date = addDays(date, -1);
          } else if (day === 0) {
            if (config.observance.sunday === 'none') continue;
            date = addDays(date, 1);
          }
        }
        if (toYearMonthDay(date).year === year) dates.add(date);
      }
    }
    byYear.set(year, dates);
    return dates;
  };

  const isHoliday = (date: CivilDate): boolean => observedIn(toYearMonthDay(date).year).has(date);

  return {
    isHoliday,
    isBusinessDay: (date) => {
      const day = weekday(date);
      return day !== 0 && day !== 6 && !isHoliday(date);
    },
    holidaysIn: (year) => [...observedIn(year)].sort((a, b) => a - b),
  };
}

/** A calendar where every weekday is a business day. Useful for tests and non-US use. */
export const WEEKENDS_ONLY: BusinessCalendar = createBusinessCalendar({
  name: 'Weekends only',
  observance: { saturday: 'none', sunday: 'none' },
  rules: [],
});

/** Move a date off weekends and holidays. `none` leaves it where it is. */
export function adjustToBusinessDay(date: CivilDate, mode: Adjustment, calendar: BusinessCalendar): CivilDate {
  if (mode === 'none') return date;
  const step = mode === 'before' ? -1 : 1;
  let adjusted = date;
  for (let moved = 0; !calendar.isBusinessDay(adjusted); moved++) {
    if (moved >= MAX_ADJUSTMENT_DAYS) {
      throw new RangeError(`No business day within ${MAX_ADJUSTMENT_DAYS} days; check the holiday calendar`);
    }
    adjusted = addDays(adjusted, step);
  }
  return adjusted;
}
