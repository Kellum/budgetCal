/**
 * Hybrid logical clock (Kulkarni et al.). Every stored record carries the timestamp of its
 * last edit, so two devices can always agree which edit came later — even when one device's
 * clock is wrong — without a server deciding. See docs/PLAN.md §5 and §7.
 *
 * Timestamps are strings that sort correctly as plain strings:
 *   <milliseconds, 15 digits>:<counter, 6 base-36 digits>:<device id>
 *
 * The wall clock is injected. The model never reads the time itself.
 */

export type Hlc = string & { readonly __hlc: unique symbol };

export interface HlcParts {
  readonly millis: number;
  readonly counter: number;
  readonly device: string;
}

const MILLIS_WIDTH = 15;
const COUNTER_WIDTH = 6;
const MAX_COUNTER = 36 ** COUNTER_WIDTH - 1;
const DEVICE = /^[A-Za-z0-9_-]{1,64}$/;

export function formatHlc({ millis, counter, device }: HlcParts): Hlc {
  if (!Number.isSafeInteger(millis) || millis < 0 || String(millis).length > MILLIS_WIDTH) {
    throw new RangeError(`Invalid clock time ${millis}`);
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) throw new RangeError(`Invalid clock counter ${counter}`);
  if (!DEVICE.test(device)) throw new RangeError(`Invalid device id "${device}"`);
  return `${String(millis).padStart(MILLIS_WIDTH, '0')}:${counter.toString(36).padStart(COUNTER_WIDTH, '0')}:${device}` as Hlc;
}

const PATTERN = /^(\d{15}):([0-9a-z]{6}):([A-Za-z0-9_-]{1,64})$/;

export function parseHlc(text: string): HlcParts | undefined {
  const match = PATTERN.exec(text);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return { millis: Number(match[1]), counter: parseInt(match[2], 36), device: match[3] };
}

export function isHlc(text: unknown): text is Hlc {
  return typeof text === 'string' && parseHlc(text) !== undefined;
}

/** Negative if a happened before b. Plain string order, by construction. */
export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface Clock {
  /** Timestamp for a local edit. Strictly greater than every timestamp this clock has seen. */
  tick(): Hlc;
  /** Account for a timestamp received from another device. */
  receive(remote: Hlc): void;
  /** The latest timestamp seen or issued. */
  readonly last: Hlc;
}

export function createClock(device: string, now: () => number, last?: Hlc): Clock {
  let state: HlcParts = last ? (parseHlc(last) ?? { millis: 0, counter: 0, device }) : { millis: 0, counter: 0, device };
  state = { ...state, device };

  const advance = (millis: number, counter: number): void => {
    if (counter > MAX_COUNTER) {
      // More than two billion edits in one millisecond: borrow the next millisecond.
      state = { millis: millis + 1, counter: 0, device };
    } else {
      state = { millis, counter, device };
    }
  };

  return {
    tick() {
      const wall = Math.floor(now());
      if (wall > state.millis) advance(wall, 0);
      else advance(state.millis, state.counter + 1);
      return formatHlc(state);
    },
    receive(remote) {
      const parts = parseHlc(remote);
      if (!parts) throw new RangeError(`Invalid timestamp "${remote}"`);
      const wall = Math.floor(now());
      const millis = Math.max(state.millis, parts.millis, wall);
      if (millis === state.millis && millis === parts.millis) advance(millis, Math.max(state.counter, parts.counter) + 1);
      else if (millis === state.millis) advance(millis, state.counter + 1);
      else if (millis === parts.millis) advance(millis, parts.counter + 1);
      else advance(millis, 0);
    },
    get last() {
      return formatHlc(state);
    },
  };
}
