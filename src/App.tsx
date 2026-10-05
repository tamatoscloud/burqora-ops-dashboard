import {useEffect, useMemo, useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createOpsClient, OPS_PIN} from './supabase';

type Tab = 'overview' | 'locations' | 'users' | 'attendance' | 'logs' | 'tests';

type LocationRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number | null;
  wifi_ssid: string | null;
  timezone: string | null;
};

type UserRow = {id: string; phone: string | null};
type ScheduleRow = {
  id: string;
  user_id: string;
  location_id: string;
  start_time: string;
  end_time: string;
};
type AttendanceRow = {
  id: string;
  user_id: string;
  check_in_time: string | null;
  check_out_time: string | null;
  status: string | null;
  wifi_ssid: string | null;
  latitude: number | null;
  longitude: number | null;
};

type OpsEventRow = {
  id: string;
  user_id: string | null;
  level: 'success' | 'failure' | 'error' | 'info' | string;
  category: string;
  code: string | null;
  message: string;
  source: string | null;
  details: Record<string, unknown> | null;
  device_id: string | null;
  created_at: string;
};

function plainTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function isValidHm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** Bump ops_user_sync so the app drops cache and reloads schedules/locations. */
async function bumpOpsUserRevision(
  client: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const {data: existing} = await client
    .from('ops_user_sync')
    .select('schedule_revision')
    .eq('user_id', userId)
    .maybeSingle();
  const next = Number((existing as {schedule_revision?: number} | null)?.schedule_revision || 0) + 1;
  const {error} = await client.from('ops_user_sync').upsert({
    user_id: userId,
    schedule_revision: next,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('[ops] bump revision failed', error.message);
    return null;
  }
  return next;
}

/** Hard demo reset: wipe attendance, shift sessions/audit, and live logs for one user. */
async function hardResetUserDemoData(
  client: SupabaseClient,
  userId: string,
): Promise<{error: string | null}> {
  // AC-1.1 / BUR-15: close open attendance before wiping so replace never orphans an active session.
  const nowIso = new Date().toISOString();
  const {error: closeLogsErr} = await client
    .from('attendance_logs')
    .update({
      check_out_time: nowIso,
      status: 'checked_out',
    })
    .eq('user_id', userId)
    .is('check_out_time', null);
  if (closeLogsErr) {
    return {error: `attendance_logs close: ${closeLogsErr.message}`};
  }

  const {error: closeSessionsErr} = await client
    .from('shift_sessions')
    .update({
      check_out_time: nowIso,
      state: 'COMPLETED',
      forced_closed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('user_id', userId)
    .is('check_out_time', null);
  if (closeSessionsErr) {
    // Non-fatal if enum/state differs — continue to delete wipe.
    console.warn('shift_sessions close skipped:', closeSessionsErr.message);
  }

  const tables = [
    'shift_audit_events',
    'shift_sessions',
    'attendance_logs',
    'ops_event_logs',
  ] as const;
  for (const table of tables) {
    const {error} = await client.from(table).delete().eq('user_id', userId);
    if (error) {
      return {error: `${table}: ${error.message}`};
    }
  }
  return {error: null};
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!unlocked) return;
    try {
      setClient(createOpsClient());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [unlocked]);

  useEffect(() => {
    setNotice(null);
    setError(null);
  }, [tab]);

  if (!unlocked) {
    return (
      <div className="app pin-gate card">
        <h1>BurqOra Ops</h1>
        <p className="muted">Enter the ops PIN to continue (default: burqora-ops).</p>
        <div className="grid" style={{marginTop: 16}}>
          <label>
            PIN
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && pin === OPS_PIN) setUnlocked(true);
              }}
            />
          </label>
          <button className="primary" onClick={() => setUnlocked(pin === OPS_PIN)}>
            Unlock
          </button>
          {pin && pin !== OPS_PIN ? <div className="err">Wrong PIN</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>BurqOra Ops Dashboard</h1>
        <p>Update locations, assign shifts, and review attendance in plain language.</p>
      </header>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner">{notice}</div> : null}

      <div className="tabs">
        {(
          [
            ['overview', 'Overview'],
            ['locations', 'Locations'],
            ['users', 'Users & shifts'],
            ['attendance', 'Attendance'],
            ['logs', 'Live logs'],
            ['tests', 'Test checklist'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <OverviewPanel onGo={setTab} /> : null}
      {client && tab === 'locations' ? (
        <LocationsPanel client={client} onError={setError} onNotice={setNotice} />
      ) : null}
      {client && tab === 'users' ? (
        <UsersShiftsPanel client={client} onError={setError} onNotice={setNotice} />
      ) : null}
      {client && tab === 'attendance' ? (
        <AttendancePanel client={client} onError={setError} />
      ) : null}
      {client && tab === 'logs' ? (
        <LiveLogsPanel client={client} onError={setError} />
      ) : null}
      {tab === 'tests' ? <TestsPanel /> : null}
    </div>
  );
}

function OverviewPanel({onGo}: {onGo: (tab: Tab) => void}) {
  return (
    <div className="card">
      <h2>What you can do here</h2>
      <ol className="help-list">
        <li>
          <strong>Locations</strong> — change GPS coordinates, radius, and Wi‑Fi SSID for a site
          without editing the database.
        </li>
        <li>
          <strong>Users & shifts</strong> — hard-resets that user’s demo attendance + logs, then
          assigns new shifts. Prefer <em>Marietta</em> or <em>Head Office</em> (Ohio GPS) for US
          testing — do not assign Karachi sites for Ohio devices.
        </li>
        <li>
          <strong>Attendance</strong> — see who is clocked in / out in plain English.
        </li>
        <li>
          <strong>Live logs</strong> — success / failure / error events from the app so you can
          see exactly where something broke (check-in, check-out, schedule retry, etc.).
        </li>
        <li>
          <strong>Test checklist</strong> — step-by-step scenarios for the mobile app.
        </li>
      </ol>
      <p className="muted">
        This dashboard is for the client demo (mock auth). Use the same user id in the app after OTP
        (any 6-digit code in demo builds).
      </p>
      <div className="row" style={{marginTop: 12}}>
        <button className="primary" onClick={() => onGo('locations')}>
          Edit locations
        </button>
        <button className="ghost" onClick={() => onGo('users')}>
          Assign shifts
        </button>
        <button className="ghost" onClick={() => onGo('attendance')}>
          View attendance
        </button>
        <button className="ghost" onClick={() => onGo('logs')}>
          Live logs
        </button>
      </div>
    </div>
  );
}

function LocationsPanel({
  client,
  onError,
  onNotice,
}: {
  client: SupabaseClient;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const {data, error} = await client
      .from('locations')
      .select('id,name,latitude,longitude,radius,wifi_ssid,timezone')
      .order('name');
    if (error) {
      onError(`Could not load locations: ${error.message}`);
      return;
    }
    onError(null);
    setRows((data as LocationRow[]) || []);
  }

  useEffect(() => {
    void load();
  }, [client]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    const {data, error} = await client
      .from('locations')
      .update({
        name: editing.name,
        latitude: Number(editing.latitude),
        longitude: Number(editing.longitude),
        radius: Number(editing.radius ?? 200),
        wifi_ssid: editing.wifi_ssid,
        timezone: editing.timezone || 'Asia/Karachi',
      })
      .eq('id', editing.id)
      .select('id,name')
      .maybeSingle();
    setBusy(false);
    if (error) {
      onError(`Save failed: ${error.message}`);
      return;
    }
    if (!data) {
      onError('Save failed: no row updated (check location id / permissions).');
      return;
    }
    onNotice(
      `Saved location “${editing.name}”. Sync revision bumped — open/refresh the app to load new GPS.`,
    );
    // Notify all demo users that location config changed.
    const {data: userRows} = await client.from('users').select('id');
    for (const u of userRows || []) {
      await bumpOpsUserRevision(client, String((u as {id: string}).id));
    }
    setEditing(null);
    await load();
  }

  return (
    <div className="card">
      <div className="row" style={{justifyContent: 'space-between'}}>
        <h2 style={{margin: 0}}>Locations (GPS / Wi‑Fi)</h2>
        <button className="ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p className="muted">
        Change site coordinates here instead of editing the database by hand.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Lat / Lng</th>
            <th>Radius</th>
            <th>Wi‑Fi</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>
                <strong>{row.name}</strong>
                <div className="muted">{row.id}</div>
                <div className="muted">{row.timezone || '—'}</div>
              </td>
              <td>
                {row.latitude}, {row.longitude}
              </td>
              <td>{row.radius ?? 200}m</td>
              <td>{row.wifi_ssid || '—'}</td>
              <td>
                <button className="ghost" onClick={() => setEditing({...row})}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing ? (
        <div className="card" style={{marginTop: 16}}>
          <h2>Edit {editing.id}</h2>
          <div className="grid two">
            <label>
              Name
              <input
                value={editing.name}
                onChange={e => setEditing({...editing, name: e.target.value})}
              />
            </label>
            <label>
              Timezone (IANA)
              <input
                value={editing.timezone || ''}
                onChange={e => setEditing({...editing, timezone: e.target.value})}
                placeholder="Asia/Karachi"
              />
            </label>
            <label>
              Latitude
              <input
                type="number"
                step="any"
                value={editing.latitude}
                onChange={e => setEditing({...editing, latitude: Number(e.target.value)})}
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                step="any"
                value={editing.longitude}
                onChange={e => setEditing({...editing, longitude: Number(e.target.value)})}
              />
            </label>
            <label>
              Radius (meters)
              <input
                type="number"
                value={editing.radius ?? 200}
                onChange={e => setEditing({...editing, radius: Number(e.target.value)})}
              />
            </label>
            <label>
              Wi‑Fi SSID
              <input
                value={editing.wifi_ssid || ''}
                onChange={e => setEditing({...editing, wifi_ssid: e.target.value})}
              />
            </label>
          </div>
          <div className="row" style={{marginTop: 12}}>
            <button className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save location'}
            </button>
            <button className="ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UsersShiftsPanel({
  client,
  onError,
  onNotice,
}: {
  client: SupabaseClient;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [newUserId, setNewUserId] = useState('user-2');
  const [newPhone, setNewPhone] = useState('+10000000002');
  const [assignUser, setAssignUser] = useState('user-1');
  const [assignLocation, setAssignLocation] = useState('loc-marietta-oh');
  const [startLocal, setStartLocal] = useState('10:00');
  const [endLocal, setEndLocal] = useState('19:00');
  const [days, setDays] = useState(28);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [u, l, s] = await Promise.all([
      client.from('users').select('id,phone').order('id'),
      client.from('locations').select('id,name,latitude,longitude,radius,wifi_ssid,timezone').order('name'),
      client
        .from('schedules')
        .select('id,user_id,location_id,start_time,end_time')
        .order('start_time', {ascending: false})
        .limit(40),
    ]);
    if (u.error || l.error || s.error) {
      onError(u.error?.message || l.error?.message || s.error?.message || 'Load failed');
      return;
    }
    onError(null);
    const userRows = (u.data as UserRow[]) || [];
    const locRows = (l.data as LocationRow[]) || [];
    setUsers(userRows);
    setLocations(locRows);
    setSchedules((s.data as ScheduleRow[]) || []);
    if (userRows.length && !userRows.some(x => x.id === assignUser)) {
      setAssignUser(userRows[0].id);
    }
    if (locRows.length && !locRows.some(x => x.id === assignLocation)) {
      setAssignLocation(locRows[0].id);
    }
  }

  useEffect(() => {
    void load();
  }, [client]);

  async function addUser() {
    const id = newUserId.trim();
    if (!id) return;
    setBusy(true);
    const {error} = await client.from('users').upsert({id, phone: newPhone.trim() || null});
    setBusy(false);
    if (error) {
      onError(`Could not save user: ${error.message}`);
      return;
    }
    onNotice(
      `User “${id}” ready. In the demo app, log in and use this same user mapping (Dev / user-1 style demo).`,
    );
    setAssignUser(id);
    await load();
  }

  async function assignShifts() {
    const loc = locations.find(l => l.id === assignLocation);
    const tz = loc?.timezone || 'Asia/Karachi';
    const userId = assignUser.trim();
    if (!userId || !assignLocation) {
      onError('Pick a user and location first.');
      return;
    }
    if (!isValidHm(startLocal) || !isValidHm(endLocal)) {
      onError('Start/end must be HH:MM (24h), e.g. 17:00');
      return;
    }
    if (days < 1 || days > 28) {
      onError('Days ahead must be between 1 and 28.');
      return;
    }

    setBusy(true);

    // Hard demo reset (option B): wipe attendance + shift audit/sessions + live logs,
    // then replace schedules and bump sync revision so the app clears local cache.
    const reset = await hardResetUserDemoData(client, userId);
    if (reset.error) {
      setBusy(false);
      onError(`Hard reset failed: ${reset.error}`);
      return;
    }

    const {error: delErr} = await client.from('schedules').delete().eq('user_id', userId);
    if (delErr) {
      setBusy(false);
      onError(`Could not clear old schedules: ${delErr.message}`);
      return;
    }

    const rows: Array<{user_id: string; location_id: string; start_time: string; end_time: string}> =
      [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + i));
      // Use calendar date in site TZ by formatting with Intl
      const dayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(now.getTime() + i * 24 * 60 * 60 * 1000));
      const startIso = wallToApproxIso(dayKey, startLocal.trim(), tz);
      const endIso = wallToApproxIso(dayKey, endLocal.trim(), tz);
      if (Number.isNaN(Date.parse(startIso)) || Number.isNaN(Date.parse(endIso))) {
        setBusy(false);
        onError(`Invalid time conversion for ${dayKey} (${tz}).`);
        return;
      }
      rows.push({
        user_id: userId,
        location_id: assignLocation,
        start_time: startIso,
        end_time: endIso,
      });
      void day;
    }

    const {data, error} = await client.from('schedules').insert(rows).select('id');
    if (error) {
      setBusy(false);
      onError(`Could not assign shifts: ${error.message}`);
      return;
    }

    const revision = await bumpOpsUserRevision(client, userId);
    await client.from('ops_event_logs').insert({
      user_id: userId,
      level: 'info',
      category: 'ops',
      code: 'HARD_RESET_SCHEDULES',
      message: `Hard reset + assigned ${data?.length ?? rows.length} day(s) at ${loc?.name || assignLocation} (${startLocal}–${endLocal} ${tz})`,
      source: 'ops-dashboard',
      details: {revision, location_id: assignLocation, days},
    });

    setBusy(false);
    onNotice(
      `Hard reset done for ${userId}: attendance + live logs cleared, ${data?.length ?? rows.length} new shift day(s) at ${loc?.name || assignLocation} (${startLocal}–${endLocal} ${tz}). App will auto-reload on next open/focus (revision ${revision ?? '?'}).`,
    );
    await load();
  }

  return (
    <>
      <div className="card">
        <h2>Add demo user</h2>
        <div className="grid two">
          <label>
            User id
            <input value={newUserId} onChange={e => setNewUserId(e.target.value)} />
          </label>
          <label>
            Phone
            <input value={newPhone} onChange={e => setNewPhone(e.target.value)} />
          </label>
        </div>
        <div className="row" style={{marginTop: 12}}>
          <button className="primary" disabled={busy} onClick={() => void addUser()}>
            Save user
          </button>
        </div>
        <p className="muted">Current users: {users.map(u => u.id).join(', ') || 'none'}</p>
      </div>

      <div className="card">
        <h2>Assign shifts</h2>
        <p className="muted">
          <strong>Hard demo reset:</strong> replaces all schedules for the selected user and deletes
          that user’s attendance history, shift sessions/audit, and live logs. Sync revision bumps so
          the app clears local cache on next open/focus.
        </p>
        <div className="grid two">
          <label>
            User
            <select value={assignUser} onChange={e => setAssignUser(e.target.value)}>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <select value={assignLocation} onChange={e => setAssignLocation(e.target.value)}>
              {locations.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.timezone || 'TZ?'})
                </option>
              ))}
            </select>
          </label>
          <label>
            Start (HH:MM local site)
            <input value={startLocal} onChange={e => setStartLocal(e.target.value)} />
          </label>
          <label>
            End (HH:MM local site)
            <input value={endLocal} onChange={e => setEndLocal(e.target.value)} />
          </label>
          <label>
            Days ahead
            <input
              type="number"
              min={1}
              max={28}
              value={days}
              onChange={e => setDays(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="row" style={{marginTop: 12}}>
          <button className="primary" disabled={busy} onClick={() => void assignShifts()}>
            {busy ? 'Saving…' : 'Hard reset + assign shifts'}
          </button>
          <button className="ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Recent schedules</h2>
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Location</th>
              <th>Start</th>
              <th>End</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => (
              <tr key={s.id}>
                <td>{s.user_id}</td>
                <td>{s.location_id}</td>
                <td>{plainTime(s.start_time)}</td>
                <td>{plainTime(s.end_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Wall-clock → ISO using fixed offsets for demo timezones. */
function wallToApproxIso(date: string, hm: string, tz: string): string {
  const offsets: Record<string, string> = {
    'Asia/Karachi': '+05:00',
    'America/New_York': '-04:00',
    'America/Chicago': '-05:00',
    'Europe/London': '+01:00',
    UTC: 'Z',
  };
  const off = offsets[tz] || '+05:00';
  const stamp = `${date}T${hm}:00${off === 'Z' ? 'Z' : off}`;
  return new Date(stamp).toISOString();
}

function AttendancePanel({
  client,
  onError,
}: {
  client: SupabaseClient;
  onError: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    const {data, error} = await client
      .from('attendance_logs')
      .select('id,user_id,check_in_time,check_out_time,status,wifi_ssid,latitude,longitude')
      .order('check_in_time', {ascending: false})
      .limit(30);
    setBusy(false);
    if (error) {
      onError(`Could not load attendance: ${error.message}`);
      return;
    }
    onError(null);
    setRows((data as AttendanceRow[]) || []);
  }

  useEffect(() => {
    void load();
  }, [client]);

  return (
    <div className="card">
      <div className="row" style={{justifyContent: 'space-between'}}>
        <h2 style={{margin: 0}}>Recent attendance</h2>
        <button className="ghost" disabled={busy} onClick={() => void load()}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>User</th>
            <th>What happened</th>
            <th>Clock in</th>
            <th>Clock out</th>
            <th>Wi‑Fi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const open = !r.check_out_time;
            const summary = open
              ? 'Currently clocked in'
              : 'Shift finished (clocked out)';
            return (
              <tr key={r.id}>
                <td>{r.user_id}</td>
                <td className={open ? 'ok' : 'muted'}>{summary}</td>
                <td>{plainTime(r.check_in_time)}</td>
                <td>{plainTime(r.check_out_time)}</td>
                <td>{r.wifi_ssid || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LiveLogsPanel({
  client,
  onError,
}: {
  client: SupabaseClient;
  onError: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<OpsEventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [levelFilter, setLevelFilter] = useState<'all' | 'success' | 'failure' | 'error' | 'info'>(
    'all',
  );
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function load() {
    setBusy(true);
    let q = client
      .from('ops_event_logs')
      .select('id,user_id,level,category,code,message,source,details,device_id,created_at')
      .order('created_at', {ascending: false})
      .limit(80);
    if (levelFilter !== 'all') {
      q = q.eq('level', levelFilter);
    }
    const {data, error} = await q;
    setBusy(false);
    if (error) {
      onError(`Could not load live logs: ${error.message}`);
      return;
    }
    onError(null);
    setRows((data as OpsEventRow[]) || []);
  }

  useEffect(() => {
    void load();
  }, [client, levelFilter]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => void load(), 8_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, client, levelFilter]);

  return (
    <div className="card">
      <div className="row" style={{justifyContent: 'space-between', marginBottom: 8}}>
        <div>
          <h2 style={{margin: 0}}>Live app logs</h2>
          <p className="muted" style={{margin: '6px 0 0'}}>
            Success, failure, and error events from the phone app (check-in, check-out, schedule
            retries). Use this to jump straight to the failing step.
          </p>
        </div>
        <div className="row">
          <label style={{margin: 0}}>
            Level
            <select
              value={levelFilter}
              onChange={e => setLevelFilter(e.target.value as typeof levelFilter)}
              style={{minWidth: 120}}>
              <option value="all">All</option>
              <option value="error">Errors</option>
              <option value="failure">Failures</option>
              <option value="success">Success</option>
              <option value="info">Info</option>
            </select>
          </label>
          <label className="row" style={{gap: 6, margin: 0, color: 'var(--ink)'}}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              style={{width: 'auto'}}
            />
            Auto-refresh
          </label>
          <button className="ghost" disabled={busy} onClick={() => void load()}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Level</th>
            <th>Category</th>
            <th>Code</th>
            <th>What happened</th>
            <th>User</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                No events yet. After the client installs the new APK and clocks in/out (or hits an
                error), rows appear here within a few seconds.
              </td>
            </tr>
          ) : (
            rows.map(r => (
              <tr key={r.id}>
                <td>{plainTime(r.created_at)}</td>
                <td>
                  <span className={`log-pill log-${r.level}`}>{r.level}</span>
                </td>
                <td>{r.category}</td>
                <td>
                  <code>{r.code || '—'}</code>
                </td>
                <td>
                  <div>{r.message}</div>
                  {r.details && Object.keys(r.details).length > 0 ? (
                    <pre className="log-details">{JSON.stringify(r.details, null, 0)}</pre>
                  ) : null}
                </td>
                <td>{r.user_id || '—'}</td>
                <td>{r.source || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TestsPanel() {
  const checks = useMemo(
    () => [
      {
        name: 'Auto clock-in',
        how: 'Be at the scheduled site during the shift window with the app closed or backgrounded. Confirm attendance appears without opening the app (or shortly after).',
      },
      {
        name: 'Manual clock-in fallback',
        how: 'If auto misses, open Home → Check In Manually (Face ID). Works on site even after scheduled shift end.',
      },
      {
        name: 'Auto clock-out when leaving',
        how: 'Stay clocked in, leave the site (~200–300m+). Expect auto clock-out about 30 seconds after confirmed exit.',
      },
      {
        name: 'Dashboard location edit',
        how: 'Change a site GPS on Locations, save, refresh the app schedule, then retest clock-in at the new point.',
      },
      {
        name: 'Dashboard shift assign',
        how: 'Assign user-1 a short shift for today, refresh the app, confirm the new hours show on Home.',
      },
    ],
    [],
  );

  return (
    <div className="card">
      <h2>Client test checklist</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Test</th>
            <th>How to run</th>
          </tr>
        </thead>
        <tbody>
          {checks.map(c => (
            <tr key={c.name}>
              <td>
                <strong>{c.name}</strong>
              </td>
              <td>{c.how}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
