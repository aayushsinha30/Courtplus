import type { ISODate } from '@courtplus/contracts';

// UTC is used only to encode civil dates as integer days. No local time or clock is read.
const DAY = 86_400_000;

export function day(value: string | undefined): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return undefined;
  return time / DAY;
}

export function iso(value: number): ISODate {
  return new Date(value * DAY).toISOString().split('T')[0];
}

export function addMonths(start: number, months: number): number {
  const date = new Date(start * DAY);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months + 1, 0);
  date.setUTCDate(Math.min(originalDay, date.getUTCDate()));
  return date.getTime() / DAY;
}

export interface Interval { start: number; end: number }

export function union(intervals: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const interval of intervals.slice().sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else if (interval.start < interval.end) {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function subtract(intervals: Interval[], exclusions: Interval[]): Interval[] {
  const result: Interval[] = [];
  const cuts = union(exclusions);
  for (const interval of intervals) {
    let start = interval.start;
    for (const cut of cuts) {
      if (cut.end <= start) continue;
      if (cut.start >= interval.end) break;
      if (cut.start > start) result.push({ start, end: cut.start });
      start = Math.min(interval.end, cut.end);
    }
    if (start < interval.end) result.push({ start, end: interval.end });
  }
  return result;
}

export function length(intervals: Interval[]): number {
  return intervals.reduce((total, interval) => total + interval.end - interval.start, 0);
}

export function nthDay(intervals: Interval[], n: number): number | undefined {
  for (const interval of intervals) {
    const days = interval.end - interval.start;
    if (n <= days) return interval.start + n - 1;
    n -= days;
  }
  return undefined;
}

export function visibleDate(date: string | undefined, asOf: number): number | undefined {
  const value = day(date);
  return value !== undefined && value <= asOf ? value : undefined;
}

export const BNSS_START = day('2024-07-01')!;

export const DAY_CONVENTION =
  'Asia/Kolkata civil dates. The arrest or first custody day counts. Spells are half-open [start, end), and asOf is included. ' +
  'Add the maximum years or months to the first custody day, clamping month-end, and take the day difference. ' +
  'For fraction 1/k, the threshold is met when k × counted custody days ≥ maximum term days.';
