/**
 * BUR-25: critical ops paths with a mocked Supabase.
 * AC-01 assign → one ops_hard_reset_and_assign call with the right shifts; revision bump surfaced.
 * AC-02 hard reset → open attendance is closed SERVER-side (the dashboard never writes tables
 *        directly; the server function deletes open sessions — see supabase/tests/opsAuth.test.mjs).
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {AttendancePanel, UsersShiftsPanel} from '../App';
import {createFakeSupabase, type FakeSupabase} from '../test/fakeSupabase';

let sb: FakeSupabase;
const onError = vi.fn();
const onNotice = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
  onError.mockReset();
  onNotice.mockReset();
  sb = createFakeSupabase();
  sb.setTable('users', [{id: 'emp-1', phone: null}]);
  sb.setTable('locations', [
    {id: 'loc-ny', name: 'NY Store', latitude: 40.7, longitude: -74, radius: 200, wifi_ssid: null, timezone: 'America/New_York'},
  ]);
  sb.setTable('schedules', []);
});

afterEach(() => vi.useRealTimers());

async function renderAssign() {
  const user = userEvent.setup();
  render(<UsersShiftsPanel client={sb.client} onError={onError} onNotice={onNotice} />);
  // load() picks the first real user/location
  await waitFor(() => expect(screen.getByRole('option', {name: /NY Store/})).toBeInTheDocument());
  const days = screen.getByLabelText(/Days ahead/);
  await user.clear(days);
  await user.type(days, '2');
  return user;
}

const submit = () => screen.getByRole('button', {name: /Hard reset \+ assign shifts/});

describe('Assign shifts (hard reset)', () => {
  it('AC-01: sends one server call with the site-time shifts, and reports the new revision', async () => {
    sb.setRpc('ops_hard_reset_and_assign', {data: {shifts: 2, revision: 7}, error: null});
    const user = await renderAssign();

    await user.click(submit());

    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    const calls = sb.rpc.mock.calls.filter(c => c[0] === 'ops_hard_reset_and_assign');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      p_user_id: 'emp-1',
      p_location_id: 'loc-ny',
      // 10:00–19:00 New York in November is EST (−05:00)
      p_shifts: [
        {start_time: '2026-11-23T15:00:00.000Z', end_time: '2026-11-24T00:00:00.000Z'},
        {start_time: '2026-11-24T15:00:00.000Z', end_time: '2026-11-25T00:00:00.000Z'},
      ],
    });
    expect(onNotice.mock.calls[0][0]).toMatch(/revision 7/);
    expect(onNotice.mock.calls[0][0]).toMatch(/2 new shift day/);
  });

  it('AC-02: never writes attendance/schedule tables directly — the server function does it', async () => {
    sb.setRpc('ops_hard_reset_and_assign', {data: {shifts: 2, revision: 8}, error: null});
    const user = await renderAssign();
    await user.click(submit());
    await waitFor(() => expect(onNotice).toHaveBeenCalled());

    expect(sb.tableCalls.filter(c => c.op !== 'select')).toEqual([]);
    // and the schedule list is reloaded afterwards
    expect(sb.tableCalls.filter(c => c.table === 'schedules').length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['ERR_OPS_SHIFT_END_BEFORE_START', 'Hard reset failed: Each shift must end after it starts.'],
    ['ERR_OPS_FORBIDDEN', 'Hard reset failed: Your account does not have ops access.'],
    ['JWT expired', 'Hard reset failed: Your session expired. Sign in again.'],
  ])('shows a plain message when the server says %s', async (raw, shown) => {
    sb.setRpc('ops_hard_reset_and_assign', {data: null, error: {message: raw}});
    const user = await renderAssign();
    await user.click(submit());
    await waitFor(() => expect(onError).toHaveBeenCalledWith(shown));
    expect(onNotice).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled(); // can try again
  });

  it('rejects bad input before calling the server', async () => {
    const user = await renderAssign();
    const end = screen.getByLabelText(/End \(HH:MM/);
    await user.clear(end);
    await user.type(end, '09:00'); // before the 10:00 start
    await user.click(submit());
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/after start/));
    expect(sb.rpc.mock.calls.some(c => c[0] === 'ops_hard_reset_and_assign')).toBe(false);
  });

  it('cannot be double-submitted while saving', async () => {
    let release!: () => void;
    sb.setRpc(
      'ops_hard_reset_and_assign',
      () => new Promise(r => (release = () => r({data: {shifts: 2, revision: 9}, error: null}))),
    );
    const user = await renderAssign();
    await user.click(submit());
    const saving = screen.getByRole('button', {name: /Saving/});
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(sb.rpc.mock.calls.filter(c => c[0] === 'ops_hard_reset_and_assign')).toHaveLength(1);
    release();
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
  });
});

describe('Attendance view', () => {
  it('lists open and finished shifts in plain words', async () => {
    sb.setTable('attendance_logs', [
      {id: 'a1', user_id: 'emp-1', check_in_time: '2026-11-23T05:00:00Z', check_out_time: null, status: 'checked_in', wifi_ssid: 'Store-WiFi', latitude: 1, longitude: 1},
      {id: 'a2', user_id: 'emp-2', check_in_time: '2026-11-22T05:00:00Z', check_out_time: '2026-11-22T14:00:00Z', status: 'checked_out', wifi_ssid: null, latitude: 1, longitude: 1},
    ]);
    render(<AttendancePanel client={sb.client} onError={onError} />);

    const open = await screen.findByText('Currently clocked in');
    expect(within(open.closest('tr')!).getByText('emp-1')).toBeInTheDocument();
    expect(within(open.closest('tr')!).getByText('Store-WiFi')).toBeInTheDocument();
    const done = screen.getByText('Shift finished (clocked out)');
    expect(within(done.closest('tr')!).getByText('emp-2')).toBeInTheDocument();
    expect(within(done.closest('tr')!).getByText('—')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(null);
  });

  it('reports a load failure', async () => {
    sb.setTable('attendance_logs', {error: 'permission denied for table attendance_logs'});
    render(<AttendancePanel client={sb.client} onError={onError} />);
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Could not load attendance/)),
    );
    expect(screen.queryByText('Currently clocked in')).not.toBeInTheDocument();
  });
});
