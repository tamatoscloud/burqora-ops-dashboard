import {describe, expect, it} from 'vitest';
import {buildShiftDays, siteDateKey, zonedWallTimeToIso} from '../shifts';

describe('zonedWallTimeToIso — real offsets, DST aware', () => {
  it.each([
    // Karachi: no DST, always +05:00
    ['2026-11-23', '10:00', 'Asia/Karachi', '2026-11-23T05:00:00.000Z'],
    ['2026-06-23', '10:00', 'Asia/Karachi', '2026-06-23T05:00:00.000Z'],
    // New York: EST (−05:00) in winter — the old fixed −04:00 put this an hour early
    ['2026-11-23', '10:00', 'America/New_York', '2026-11-23T15:00:00.000Z'],
    ['2026-06-23', '10:00', 'America/New_York', '2026-06-23T14:00:00.000Z'],
    // London: GMT in winter, BST in summer
    ['2026-11-23', '09:00', 'Europe/London', '2026-11-23T09:00:00.000Z'],
    ['2026-06-23', '09:00', 'Europe/London', '2026-06-23T08:00:00.000Z'],
    ['2026-11-23', '09:00', 'UTC', '2026-11-23T09:00:00.000Z'],
  ])('%s %s %s → %s', (date, hm, tz, iso) => {
    expect(zonedWallTimeToIso(date, hm, tz)).toBe(iso);
  });

  it('handles the US DST switch day (2026-11-01, clocks back at 02:00)', () => {
    expect(zonedWallTimeToIso('2026-11-01', '00:30', 'America/New_York')).toBe('2026-11-01T04:30:00.000Z');
    expect(zonedWallTimeToIso('2026-11-01', '10:00', 'America/New_York')).toBe('2026-11-01T15:00:00.000Z');
  });
});

describe('siteDateKey', () => {
  it('uses the site calendar date, not the browser or UTC date', () => {
    // 2026-11-23 21:00 UTC is already 24 Nov in Karachi (02:00), still 23 Nov in New York.
    const now = new Date('2026-11-23T21:00:00Z');
    expect(siteDateKey(now, 'Asia/Karachi')).toBe('2026-11-24');
    expect(siteDateKey(now, 'America/New_York')).toBe('2026-11-23');
  });
  it('adds calendar days across a month end', () => {
    expect(siteDateKey(new Date('2026-11-30T06:00:00Z'), 'Asia/Karachi', 2)).toBe('2026-12-02');
  });
});

describe('buildShiftDays', () => {
  const now = new Date('2026-11-23T06:00:00Z');

  it('builds one shift per day starting today in the site zone', () => {
    const r = buildShiftDays({now, days: 3, timeZone: 'Asia/Karachi', startHm: '10:00', endHm: '19:00'});
    expect(r).toEqual({
      shifts: [
        {start_time: '2026-11-23T05:00:00.000Z', end_time: '2026-11-23T14:00:00.000Z'},
        {start_time: '2026-11-24T05:00:00.000Z', end_time: '2026-11-24T14:00:00.000Z'},
        {start_time: '2026-11-25T05:00:00.000Z', end_time: '2026-11-25T14:00:00.000Z'},
      ],
    });
  });

  it.each([
    [{startHm: '9:00'}, /HH:MM/],
    [{startHm: '25:00'}, /HH:MM/],
    [{days: 0}, /between 1 and 28/],
    [{days: 29}, /between 1 and 28/],
    [{days: 2.5}, /between 1 and 28/],
    [{timeZone: 'Mars/Olympus'}, /unknown time zone/],
    [{startHm: '19:00', endHm: '10:00'}, /after start/],
    [{startHm: '10:00', endHm: '10:00'}, /after start/],
  ])('rejects %o', (over, msg) => {
    const r = buildShiftDays({now, days: 3, timeZone: 'Asia/Karachi', startHm: '10:00', endHm: '19:00', ...over});
    expect('error' in r && r.error).toMatch(msg);
  });

  it('allows the full 28-day range', () => {
    const r = buildShiftDays({now, days: 28, timeZone: 'Asia/Karachi', startHm: '10:00', endHm: '19:00'});
    expect('shifts' in r && r.shifts).toHaveLength(28);
  });
});
