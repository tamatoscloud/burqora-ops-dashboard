/**
 * BUR-25: shift-building maths for "Hard reset + assign shifts", kept pure so it is unit-tested.
 *
 * Fixes a DST bug: the old code used fixed offsets (New York −04:00, London +01:00), which are
 * only right in summer, so winter shifts at those sites landed an hour off. The real offset of
 * the site's time zone is now looked up for each day.
 */

export type ShiftTimes = {start_time: string; end_time: string};

export function isValidHm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** Offset of `timeZone` from UTC at instant `utcMs`, in minutes (Karachi → +300, NY winter → −300). */
export function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Site wall-clock time (YYYY-MM-DD + HH:MM in `timeZone`) → UTC ISO string. */
export function zonedWallTimeToIso(date: string, hm: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hm.trim().split(':').map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset around DST changes.
  let utc = wallAsUtc - zoneOffsetMinutes(timeZone, wallAsUtc) * 60000;
  utc = wallAsUtc - zoneOffsetMinutes(timeZone, utc) * 60000;
  return new Date(utc).toISOString();
}

/** Calendar date (YYYY-MM-DD) in `timeZone` at instant `now`, plus `addDays` calendar days. */
export function siteDateKey(now: Date, timeZone: string, addDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + addDays)).toISOString().slice(0, 10);
}

export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone}).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * One shift per day for `days` days starting today (site calendar), start/end as site wall time.
 * Returns an error message instead of shifts when the input is unusable.
 */
export function buildShiftDays(input: {
  now: Date;
  days: number;
  timeZone: string;
  startHm: string;
  endHm: string;
}): {shifts: ShiftTimes[]} | {error: string} {
  const {now, days, timeZone, startHm, endHm} = input;
  if (!isValidHm(startHm) || !isValidHm(endHm)) {
    return {error: 'Start/end must be HH:MM (24h), e.g. 17:00'};
  }
  if (!Number.isInteger(days) || days < 1 || days > 28) {
    return {error: 'Days ahead must be between 1 and 28.'};
  }
  if (!isKnownTimeZone(timeZone)) {
    return {error: `This location has an unknown time zone (“${timeZone}”). Fix it on the Locations tab.`};
  }
  if (endHm.trim() <= startHm.trim()) {
    return {error: 'End time must be after start time (overnight shifts are not supported yet).'};
  }
  const shifts: ShiftTimes[] = [];
  for (let i = 0; i < days; i++) {
    const day = siteDateKey(now, timeZone, i);
    shifts.push({
      start_time: zonedWallTimeToIso(day, startHm, timeZone),
      end_time: zonedWallTimeToIso(day, endHm, timeZone),
    });
  }
  return {shifts};
}
