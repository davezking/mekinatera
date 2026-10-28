// All timestamps are integer Unix ms UTC (`*_at` columns).
export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function nowMs(): number {
  return Date.now();
}
