import {useEffect, useMemo, useState} from 'react';
import type {Session, SupabaseClient} from '@supabase/supabase-js';
import {createOpsClient, opsErrorMessage, type OpsIdentity} from './supabase';
import {buildShiftDays} from './shifts';

type Tab = 'overview' | 'locations' | 'users' | 'devices' | 'attendance' | 'logs' | 'tests';

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

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [identity, setIdentity] = useState<OpsIdentity | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      const c = createOpsClient();
      setClient(c);
      void c.auth.getSession().then(({data}) => setSession(data.session));
      const {data: sub} = c.auth.onAuthStateChange((_event, s) => setSession(s));
      return () => sub.subscription.unsubscribe();
    } catch (e) {
      setError((e as Error).message);
      setChecking(false);
    }
  }, []);

  // BUR-18: signed in is not enough — the account must be an active ops user.
  useEffect(() => {
    if (!client) return;
    if (!session) {
      setIdentity(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    void client.rpc('ops_whoami').then(({data, error: err}) => {
      setIdentity(err ? null : ((data as OpsIdentity | null) ?? null));
      setChecking(false);
    });
  }, [client, session]);

  useEffect(() => {
    setNotice(null);
    setError(null);
  }, [tab]);

  if (!client || checking) {
    return <div className="app pin-gate card">{error ? <div className="err">{error}</div> : 'Loading…'}</div>;
  }

  if (!session) {
    return <LoginPanel client={client} />;
  }

  if (!identity) {
    return (
      <div className="app pin-gate card">
        <h1>BurqOra Ops</h1>
        <p className="err">
          {session.user.email} is signed in but does not have ops access. Ask an admin to grant it.
        </p>
        <button className="ghost" onClick={() => void client.auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>BurqOra Ops Dashboard</h1>
        <p>Update locations, assign shifts, and review attendance in plain language.</p>
        <div className="row">
          <span className="muted">
            Signed in as {identity.email} ({identity.role})
          </span>
          <button className="ghost" onClick={() => void client.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner">{notice}</div> : null}

      <div className="tabs">
        {(
          [
            ['overview', 'Overview'],
            ['locations', 'Locations'],
            ['users', 'Users & shifts'],
            ['devices', 'Devices'],
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
      {client && tab === 'devices' ? (
        <DevicesPanel client={client} identity={identity} onError={setError} onNotice={setNotice} />
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
          <strong>Devices</strong> — approve an employee's new phone, reset lost phones, and (admins)
          control device enforcement and the activation code.
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
        Every change is made by a server function that checks your ops login and records who did it
        in Live logs.
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
    const {data, error} = await client.rpc('ops_update_location', {
      p_id: editing.id,
      p_name: editing.name,
      p_latitude: Number(editing.latitude),
      p_longitude: Number(editing.longitude),
      p_radius: Number(editing.radius ?? 200),
      p_wifi_ssid: editing.wifi_ssid,
      p_timezone: editing.timezone || 'Asia/Karachi',
    });
    setBusy(false);
    if (error) {
      onError(`Save failed: ${opsErrorMessage(error.message)}`);
      return;
    }
    const notified = (data as {users_notified?: number} | null)?.users_notified ?? 0;
    onNotice(
      `Saved location “${editing.name}”. ${notified} user(s) will reload the new GPS on next app open.`,
    );
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

export function UsersShiftsPanel({
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
    const {error} = await client.rpc('ops_upsert_user', {p_user_id: id, p_phone: newPhone.trim() || null});
    setBusy(false);
    if (error) {
      onError(`Could not save user: ${opsErrorMessage(error.message)}`);
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
    const built = buildShiftDays({now: new Date(), days, timeZone: tz, startHm: startLocal, endHm: endLocal});
    if ('error' in built) {
      onError(built.error);
      return;
    }
    const rows = built.shifts;

    setBusy(true);

    // BUR-18: one server call — wipe the user's attendance + logs and replace schedules
    // atomically, as the signed-in ops account (audited).
    const {data, error} = await client.rpc('ops_hard_reset_and_assign', {
      p_user_id: userId,
      p_location_id: assignLocation,
      p_shifts: rows,
      p_reason: `${loc?.name || assignLocation} ${startLocal}–${endLocal} ${tz}`,
    });
    if (error) {
      setBusy(false);
      onError(`Hard reset failed: ${opsErrorMessage(error.message)}`);
      return;
    }
    const result = (data as {shifts?: number; revision?: number} | null) ?? {};
    const revision = result.revision;
    setBusy(false);
    onNotice(
      `Hard reset done for ${userId}: attendance + live logs cleared, ${result.shifts ?? rows.length} new shift day(s) at ${loc?.name || assignLocation} (${startLocal}–${endLocal} ${tz}). App will auto-reload on next open/focus (revision ${revision ?? '?'}).`,
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
          <strong>Hard demo reset:</strong> deletes that user’s attendance / shift / audit / live logs,
          including any open session (so same-day reschedule does not leave stale clock-in blockers),
          replaces all schedules, and bumps sync revision so the app clears local cache on next open/focus.
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

export function AttendancePanel({
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

/** BUR-18: Supabase Auth sign-in for ops staff (replaces the browser-side PIN). */
function LoginPanel({client}: {client: SupabaseClient}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setErr(null);
    const {error} = await client.auth.signInWithPassword({email: email.trim(), password});
    setBusy(false);
    if (error) {
      setErr(/invalid/i.test(error.message) ? 'Wrong email or password.' : error.message);
    }
  }

  return (
    <div className="app pin-gate card">
      <h1>BurqOra Ops</h1>
      <p className="muted">Sign in with your ops account.</p>
      <div className="grid" style={{marginTop: 16}}>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void signIn();
            }}
          />
        </label>
        <button className="primary" disabled={busy || !email || !password} onClick={() => void signIn()}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {err ? <div className="err">{err}</div> : null}
      </div>
    </div>
  );
}

type DeviceRow = {
  id: string;
  user_id: string;
  install_id_prefix: string;
  status: 'active' | 'pending' | 'revoked';
  platform: string | null;
  model: string | null;
  app_version: string | null;
  created_at: string;
  activated_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_seen_at: string | null;
};

type DeviceSettings = {
  enforce_attendance: boolean;
  /** BUR-17 (migration 023). Undefined while the database is still on 022. */
  enforce_data_access?: boolean;
  auto_activate_first_device: boolean;
  self_activation_enabled: boolean;
  self_activation_code: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

/** BUR-38 + BUR-18: approve / reset employee phones; admins control enforcement and the code. */
export function DevicesPanel({
  client,
  identity,
  onError,
  onNotice,
}: {
  client: SupabaseClient;
  identity: OpsIdentity;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'revoked'>('all');
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = identity.role === 'admin';

  async function load() {
    setBusy(true);
    const [list, conf] = await Promise.all([
      client.rpc('ops_list_device_registrations', {p_status: filter === 'all' ? null : filter}),
      client.rpc('ops_get_device_binding_settings'),
    ]);
    setBusy(false);
    if (list.error || conf.error) {
      onError(`Could not load devices: ${opsErrorMessage((list.error || conf.error)!.message)}`);
      return;
    }
    onError(null);
    setRows((list.data as DeviceRow[]) || []);
    setSettings(conf.data as DeviceSettings);
  }

  useEffect(() => {
    void load();
  }, [client, filter]);

  async function approve(row: DeviceRow) {
    if (!window.confirm(`Approve this phone for ${row.user_id}? Their current phone will stop working for attendance.`)) {
      return;
    }
    const {error} = await client.rpc('ops_activate_device', {p_registration_id: row.id, p_reason: 'ops_approval'});
    if (error) {
      onError(`Approve failed: ${opsErrorMessage(error.message)}`);
      return;
    }
    onNotice(`Phone approved for ${row.user_id}.`);
    await load();
  }

  async function resetUser(userId: string) {
    const reason = window.prompt(`Reset all phones for ${userId}? Enter a reason (e.g. lost phone):`);
    if (!reason || !reason.trim()) return;
    const {data, error} = await client.rpc('ops_reset_user_devices', {p_user_id: userId, p_reason: reason.trim()});
    if (error) {
      onError(`Reset failed: ${opsErrorMessage(error.message)}`);
      return;
    }
    onNotice(`Reset ${data ?? 0} phone(s) for ${userId}. Their next login registers a new phone.`);
    await load();
  }

  async function saveSettings(patch: {
    enforce?: boolean;
    selfActivation?: boolean;
    code?: string;
    dataAccess?: boolean;
  }) {
    if (patch.enforce === true && !window.confirm('Turn on enforcement? Attendance from unapproved phones will be rejected.')) {
      return;
    }
    if (
      patch.dataAccess === true &&
      !window.confirm(
        'Lock data to activated phones? Phones on an older app build, or not yet activated, will stop seeing their shifts and attendance.',
      )
    ) {
      return;
    }
    const args: Record<string, unknown> = {
      p_enforce_attendance: patch.enforce ?? null,
      p_self_activation_enabled: patch.selfActivation ?? null,
      p_self_activation_code: patch.code ?? null,
    };
    // Only sent when used, so this dashboard still works against a database without migration 023.
    if (patch.dataAccess !== undefined) {
      args.p_enforce_data_access = patch.dataAccess;
    }
    const {data, error} = await client.rpc('ops_set_device_binding_settings', args);
    if (error) {
      onError(`Settings not saved: ${opsErrorMessage(error.message)}`);
      return;
    }
    setSettings(data as DeviceSettings);
    setNewCode('');
    onNotice('Device settings saved.');
  }

  const pendingCount = rows.filter(r => r.status === 'pending').length;

  return (
    <>
      <div className="card">
        <h2>Device rules</h2>
        {settings ? (
          <div className="grid two">
            <div>
              <strong>Enforcement:</strong>{' '}
              {settings.enforce_attendance ? (
                <span className="err">ON — unapproved phones are rejected</span>
              ) : (
                <span className="muted">Monitor only — violations are logged, not blocked</span>
              )}
              {isAdmin ? (
                <div className="row" style={{marginTop: 8}}>
                  <button className="ghost" onClick={() => void saveSettings({enforce: !settings.enforce_attendance})}>
                    {settings.enforce_attendance ? 'Switch to monitor only' : 'Turn on enforcement'}
                  </button>
                </div>
              ) : null}
            </div>
            {settings.enforce_data_access !== undefined ? (
              <div>
                <strong>Data access:</strong>{' '}
                {settings.enforce_data_access ? (
                  <span className="err">LOCKED — each phone sees only its own employee’s data</span>
                ) : (
                  <span className="muted">Open — turn on once every phone runs the new app build</span>
                )}
                {isAdmin ? (
                  <div className="row" style={{marginTop: 8}}>
                    <button
                      className="ghost"
                      onClick={() => void saveSettings({dataAccess: !settings.enforce_data_access})}>
                      {settings.enforce_data_access ? 'Unlock data access' : 'Lock data to activated phones'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div>
              <strong>New phone activation by code:</strong>{' '}
              {settings.self_activation_enabled ? 'allowed' : 'off — ops approval only'}
              {isAdmin ? (
                <>
                  <div className="muted">Current code: {settings.self_activation_code}</div>
                  <div className="row" style={{marginTop: 8}}>
                    <input
                      placeholder="New 6-digit code"
                      value={newCode}
                      maxLength={8}
                      onChange={e => setNewCode(e.target.value.replace(/[^0-9]/g, ''))}
                    />
                    <button className="ghost" disabled={newCode.length < 4} onClick={() => void saveSettings({code: newCode})}>
                      Change code
                    </button>
                    <button
                      className="ghost"
                      onClick={() => void saveSettings({selfActivation: !settings.self_activation_enabled})}>
                      {settings.self_activation_enabled ? 'Require ops approval' : 'Allow code activation'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="muted">Only admins can change these rules.</div>
              )}
            </div>
          </div>
        ) : null}
        {settings?.updated_by ? (
          <p className="muted">
            Last changed by {settings.updated_by} at {plainTime(settings.updated_at)}
          </p>
        ) : null}
      </div>

      <div className="card">
        <div className="row">
          <h2>Phones{pendingCount ? ` — ${pendingCount} waiting for approval` : ''}</h2>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
            <option value="all">All</option>
            <option value="pending">Waiting for approval</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
          </select>
          <button className="ghost" disabled={busy} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Status</th>
              <th>Phone</th>
              <th>Registered</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.user_id}</td>
                <td>
                  {r.status === 'pending' ? <strong>Waiting</strong> : r.status === 'active' ? <span className="ok">Active</span> : 'Revoked'}
                  {r.revoked_reason ? <div className="muted">{r.revoked_reason}</div> : null}
                </td>
                <td>
                  {[r.platform, r.model].filter(Boolean).join(' · ') || '—'}
                  <div className="muted">id {r.install_id_prefix}… {r.app_version ? `· v${r.app_version}` : ''}</div>
                </td>
                <td>{plainTime(r.created_at)}</td>
                <td>{plainTime(r.last_seen_at)}</td>
                <td>
                  <div className="row">
                    {r.status === 'pending' ? (
                      <button className="primary" onClick={() => void approve(r)}>
                        Approve
                      </button>
                    ) : null}
                    {r.status !== 'revoked' ? (
                      <button className="ghost" onClick={() => void resetUser(r.user_id)}>
                        Reset phones
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="muted">
                  No phones registered yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
