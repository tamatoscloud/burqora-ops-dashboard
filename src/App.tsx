import {useEffect, useMemo, useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createOpsClient, OPS_PIN} from './supabase';

type Tab = 'locations' | 'users' | 'attendance' | 'failures' | 'tests';

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

function plainTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [tab, setTab] = useState<Tab>('locations');
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
            ['locations', 'Locations'],
            ['users', 'Users & shifts'],
            ['attendance', 'Attendance'],
            ['failures', 'Failure log'],
            ['tests', 'Tests'],
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

      {client && tab === 'locations' ? (
        <LocationsPanel client={client} onError={setError} onNotice={setNotice} />
      ) : null}
      {client && tab === 'users' ? (
        <UsersShiftsPanel client={client} onError={setError} onNotice={setNotice} />
      ) : null}
      {client && tab === 'attendance' ? (
        <AttendancePanel client={client} onError={setError} />
      ) : null}
      {tab === 'failures' ? <FailuresPanel /> : null}
      {tab === 'tests' ? <TestsPanel /> : null}
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

  async function load() {
    const {data, error} = await client
      .from('locations')
      .select('id,name,latitude,longitude,radius,wifi_ssid,timezone')
      .order('name');
    if (error) {
      onError(error.message);
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
    const {error} = await client.from('locations').upsert({
      id: editing.id,
      name: editing.name,
      latitude: Number(editing.latitude),
      longitude: Number(editing.longitude),
      radius: Number(editing.radius ?? 200),
      wifi_ssid: editing.wifi_ssid,
      timezone: editing.timezone || 'Asia/Karachi',
    });
    if (error) {
      onError(error.message);
      return;
    }
    onNotice(`Saved location “${editing.name}”.`);
    setEditing(null);
    await load();
  }

  return (
    <div className="card">
      <h2>Locations (GPS / Wi‑Fi)</h2>
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
              Timezone
              <input
                value={editing.timezone || ''}
                onChange={e => setEditing({...editing, timezone: e.target.value})}
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
            <button className="primary" onClick={() => void save()}>
              Save location
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
  const [assignLocation, setAssignLocation] = useState('loc-tamatos-gulberg');
  const [startLocal, setStartLocal] = useState('17:00');
  const [endLocal, setEndLocal] = useState('21:00');
  const [days, setDays] = useState(7);

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
    setUsers((u.data as UserRow[]) || []);
    setLocations((l.data as LocationRow[]) || []);
    setSchedules((s.data as ScheduleRow[]) || []);
    if (!assignLocation && l.data?.[0]) setAssignLocation((l.data[0] as LocationRow).id);
  }

  useEffect(() => {
    void load();
  }, [client]);

  async function addUser() {
    const id = newUserId.trim();
    if (!id) return;
    const {error} = await client.from('users').upsert({id, phone: newPhone.trim() || null});
    if (error) {
      onError(error.message);
      return;
    }
    onNotice(`User “${id}” ready. Use this same id when logging into the app (mock auth demo).`);
    await load();
  }

  async function assignShifts() {
    const loc = locations.find(l => l.id === assignLocation);
    const tz = loc?.timezone || 'Asia/Karachi';
    const userId = assignUser.trim();
    if (!userId || !assignLocation) return;

    // Replace upcoming window for this user so demo stays clean.
    const {error: delErr} = await client.from('schedules').delete().eq('user_id', userId);
    if (delErr) {
      onError(delErr.message);
      return;
    }

    const rows: Array<{user_id: string; location_id: string; start_time: string; end_time: string}> =
      [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const day = new Date(now);
      day.setDate(now.getDate() + i);
      const y = day.getFullYear();
      const m = String(day.getMonth() + 1).padStart(2, '0');
      const d = String(day.getDate()).padStart(2, '0');
      // Interpret wall times in the site timezone via Postgres timestamptz cast pattern:
      // store as ISO by constructing Date in local browser — for ops demos we send UTC ISO
      // built from "local wall clock assumed as site TZ offset" is fragile.
      // Prefer SQL via RPC later; for v1 use ISO with explicit Z and document TZ separately.
      const startIso = wallToApproxIso(`${y}-${m}-${d}`, startLocal, tz);
      const endIso = wallToApproxIso(`${y}-${m}-${d}`, endLocal, tz);
      rows.push({
        user_id: userId,
        location_id: assignLocation,
        start_time: startIso,
        end_time: endIso,
      });
    }

    const {error} = await client.from('schedules').insert(rows);
    if (error) {
      onError(
        `${error.message}. If inserts are blocked by RLS, apply an ops write policy or use the SQL seed scripts.`,
      );
      return;
    }
    onNotice(
      `Assigned ${days} day(s) for ${userId} at ${assignLocation} (${startLocal}–${endLocal} ${tz}).`,
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
          <button className="primary" onClick={() => void addUser()}>
            Save user
          </button>
        </div>
        <p className="muted">Current users: {users.map(u => u.id).join(', ') || 'none'}</p>
      </div>

      <div className="card">
        <h2>Assign shifts</h2>
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
                  {l.name} ({l.id})
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
          <button className="primary" onClick={() => void assignShifts()}>
            Replace schedules for user
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

/** Rough wall-clock → ISO for common demo timezones. Prefer SQL seeds for production accuracy. */
function wallToApproxIso(date: string, hm: string, tz: string): string {
  const offsets: Record<string, string> = {
    'Asia/Karachi': '+05:00',
    'America/New_York': '-04:00',
    'America/Chicago': '-05:00',
    'Europe/London': '+01:00',
    UTC: 'Z',
  };
  const off = offsets[tz] || '+05:00';
  const stamp = `${date}T${hm.length === 5 ? hm : hm}:00${off === 'Z' ? 'Z' : off}`;
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

  useEffect(() => {
    void (async () => {
      const {data, error} = await client
        .from('attendance_logs')
        .select('id,user_id,check_in_time,check_out_time,status,wifi_ssid,latitude,longitude')
        .order('check_in_time', {ascending: false})
        .limit(30);
      if (error) {
        onError(error.message);
        return;
      }
      onError(null);
      setRows((data as AttendanceRow[]) || []);
    })();
  }, [client]);

  return (
    <div className="card">
      <h2>Recent attendance (plain English)</h2>
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

function FailuresPanel() {
  return (
    <div className="card">
      <h2>Failure log</h2>
      <p>
        Next step: store auto/manual denial reasons (too early, outside GPS, biometric cancel, etc.)
        into a Supabase table from the app, then show them here in plain English.
      </p>
      <p className="muted">
        Until that table exists, use device logs tagged <code>BURQORA_BG_AUTO_CLOCKIN_SKIPPED</code>{' '}
        and <code>ATT_CHECKIN_DENIED</code>.
      </p>
    </div>
  );
}

function TestsPanel() {
  const checks = useMemo(
    () => [
      {
        name: 'Manual check-in after shift end',
        how: 'At the site after scheduled end → Check In Manually should succeed; timer starts from now.',
      },
      {
        name: 'Manual after auto miss',
        how: 'Stay on site without opening app until after shift start, then open and use Check In Manually.',
      },
      {
        name: 'Too early still blocked',
        how: 'More than 8 minutes before shift → manual should still say too early.',
      },
      {
        name: 'Multi-user isolation',
        how: 'Assign user-1 and user-2 different sites/shifts; each device should only see its own schedule.',
      },
    ],
    [],
  );

  return (
    <div className="card">
      <h2>Manual test checklist</h2>
      <p className="muted">
        Automated device runners come next. For now, run these scenarios and compare with Attendance.
      </p>
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
