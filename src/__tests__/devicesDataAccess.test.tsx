/**
 * BUR-17: admins lock app data to activated phones from the Devices tab.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {DevicesPanel} from '../App';
import {createFakeSupabase, type FakeSupabase} from '../test/fakeSupabase';

let sb: FakeSupabase;
const onError = vi.fn();
const onNotice = vi.fn();
const base = {
  enforce_attendance: false,
  auto_activate_first_device: true,
  self_activation_enabled: true,
  self_activation_code: '000000',
  updated_at: null,
  updated_by: null,
};

beforeEach(() => {
  sb = createFakeSupabase();
  sb.setRpc('ops_list_device_registrations', {data: [], error: null});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

const setCalls = () => sb.rpc.mock.calls.filter(c => c[0] === 'ops_set_device_binding_settings');

describe('Devices tab — data access lock', () => {
  it('admin locks data access after confirming; sends only the new switch', async () => {
    sb.setRpc('ops_get_device_binding_settings', {data: {...base, enforce_data_access: false}, error: null});
    sb.setRpc('ops_set_device_binding_settings', {data: {...base, enforce_data_access: true}, error: null});
    render(<DevicesPanel client={sb.client} identity={{email: 'a@x', role: 'admin'}} onError={onError} onNotice={onNotice} />);

    await userEvent.click(await screen.findByRole('button', {name: 'Lock data to activated phones'}));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/older app build/));
    expect(setCalls()).toHaveLength(1);
    expect(setCalls()[0][1]).toMatchObject({p_enforce_data_access: true, p_enforce_attendance: null});
    expect(await screen.findByText(/LOCKED — each phone sees only its own/)).toBeInTheDocument();
  });

  it('does nothing if the admin cancels', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    sb.setRpc('ops_get_device_binding_settings', {data: {...base, enforce_data_access: false}, error: null});
    render(<DevicesPanel client={sb.client} identity={{email: 'a@x', role: 'admin'}} onError={onError} onNotice={onNotice} />);
    await userEvent.click(await screen.findByRole('button', {name: 'Lock data to activated phones'}));
    expect(setCalls()).toHaveLength(0);
  });

  it('other settings do not send the new parameter (works before migration 023)', async () => {
    sb.setRpc('ops_get_device_binding_settings', {data: {...base}, error: null});
    sb.setRpc('ops_set_device_binding_settings', {data: {...base, enforce_attendance: true}, error: null});
    render(<DevicesPanel client={sb.client} identity={{email: 'a@x', role: 'admin'}} onError={onError} onNotice={onNotice} />);
    await userEvent.click(await screen.findByRole('button', {name: 'Turn on enforcement'}));
    await waitFor(() => expect(setCalls()).toHaveLength(1));
    expect(setCalls()[0][1]).not.toHaveProperty('p_enforce_data_access');
  });

  it('hidden while the database is still on 022, and for non-admin ops', async () => {
    sb.setRpc('ops_get_device_binding_settings', {data: {...base}, error: null});
    const {unmount} = render(
      <DevicesPanel client={sb.client} identity={{email: 'a@x', role: 'admin'}} onError={onError} onNotice={onNotice} />,
    );
    await screen.findByText(/New phone activation by code/);
    expect(screen.queryByText(/Data access:/)).not.toBeInTheDocument();
    unmount();

    sb.setRpc('ops_get_device_binding_settings', {data: {...base, enforce_data_access: false}, error: null});
    render(<DevicesPanel client={sb.client} identity={{email: 'o@x', role: 'ops'}} onError={onError} onNotice={onNotice} />);
    await screen.findByText(/Data access:/);
    expect(screen.queryByRole('button', {name: /Lock data/})).not.toBeInTheDocument();
  });
});
