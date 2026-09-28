/**
 * Civil dates: days on a calendar, with no time of day and no timezone.
 *
 * A CivilDate is the integer number of days since 1970-01-01. Rent is due on "the 1st",
 * not at an instant, so representing dates as instants (JS Date) only invites DST and
 * timezone bugs. Conversions use Howard Hinnant's days_from_civil / civil_from_days.
 * See docs/PLAN.md §4.1.
 */

export type CivilDate = number & { readonly __civilDate: unique symbol };

/** 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface YearMonthDay {
  readonly year: number;
  readonly month: number; // 1–12
  readonly day: number; // 1–31
}

/** Supported years. Wide enough for any real plan, narrow enough to keep arithmetic exact. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2400;

const floorDiv = (a: number, b: number): number => Math.floor(a / b);

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  const length = MONTH_LENGTHS[month - 1];
  if (length === undefined) throw new RangeError(`Invalid month ${month}`);
  return length;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`Year ${year} is outside ${MIN_YEAR}–${MAX_YEAR}`);
  }
}

/** Build a CivilDate from a calendar date. Throws on dates that do not exist (Feb 30). */
export function civil(year: number, month: number, day: number): CivilDate {
  assertYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`Invalid month ${month}`);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid day ${year}-${month}-${day}`);
  }
  const y = month <= 2 ? year - 1 : year;
  const era = floorDiv(y, 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = floorDiv(153 * mp + 2, 5) + day - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return (era * 146097 + doe - 719468) as CivilDate;
}

export function toYearMonthDay(date: CivilDate): YearMonthDay {
  const z = date + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const day = doy - floorDiv(153 * mp + 2, 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

export function yearOf(date: CivilDate): number {
  return toYearMonthDay(date).year;
}

export function isCivilDate(value: unknown): value is CivilDate {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= civil(MIN_YEAR, 1, 1) &&
    value <= civil(MAX_YEAR, 12, 31)
  );
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict YYYY-MM-DD. Returns undefined for anything else, including impossible dates. */
export function tryParseISODate(text: string): CivilDate | undefined {
  const match = ISO_DATE.exec(text);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  return civil(year, month, day);
}

export function parseISODate(text: string): CivilDate {
  const date = tryParseISODate(text);
  if (date === undefined) throw new RangeError(`Not a YYYY-MM-DD date: "${text}"`);
  return date;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export function formatISODate(date: CivilDate): string {
  const { year, month, day } = toYearMonthDay(date);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return (date + days) as CivilDate;
}

/** Signed number of days from `from` to `to`. */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return to - from;
}

export function weekday(date: CivilDate): Weekday {
  // 1970-01-01 was a Thursday (4).
  return (((date + 4) % 7) + 7) % 7 as Weekday;
}

export function minDate(a: CivilDate, b: CivilDate): CivilDate {
  return a < b ? a : b;
}

export function maxDate(a: CivilDate, b: CivilDate): CivilDate {
  return a > b ? a : b;
}

/** Months counted from year 0, so consecutive months differ by 1 across year boundaries. */
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function monthIndexOf(date: CivilDate): number {
  const { year, month } = toYearMonthDay(date);
  return monthIndex(year, month);
}

export function fromMonthIndex(index: number): { year: number; month: number } {
  return { year: floorDiv(index, 12), month: (index % 12) + 1 };
}

/** A day of the month, or the month's last day. */
export type DayOfMonth = number | 'last';

/** The given day in the given month, clamped to the month's length (the 31st in February is the 28th or 29th). */
export function clampedDay(year: number, month: number, day: DayOfMonth): CivilDate {
  const length = daysInMonth(year, month);
  return civil(year, month, day === 'last' ? length : Math.min(day, length));
}

export type NthWeekday = 1 | 2 | 3 | 4 | 'last';

/** The nth (or last) occurrence of a weekday in a month. Always exists for nth ≤ 4. */
export function nthWeekdayOfMonth(year: number, month: number, day: Weekday, nth: NthWeekday): CivilDate {
  if (nth === 'last') {
    const last = civil(year, month, daysInMonth(year, month));
    return addDays(last, -((weekday(last) - day + 7) % 7));
  }
  const first = civil(year, month, 1);
  return addDays(first, ((day - weekday(first) + 7) % 7) + (nth - 1) * 7);
}
