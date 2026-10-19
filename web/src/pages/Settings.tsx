import { useEffect, useState } from 'react'
import { api, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import type { APIToken, Settings as SettingsT, User } from '../lib/types'
import { Card, Confirm, Field, Loading, Modal, PageHeader, Segmented, Tabs, useAsync, useToast } from '../components/ui'
import { Avatar } from '../components/people'
import { Select } from '../components/Select'
import { DATE_FORMATS, TIME_FORMATS, fmtDateTime, fmtYMD, fmtTime } from '../lib/format'

type Tab = 'general' | 'users' | 'profile' | 'api' | 'about'

export default function Settings() {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') as Tab) || 'general')
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={[{ id: 'general', label: 'General' }, { id: 'users', label: 'Users' }, { id: 'profile', label: 'Profile' }, { id: 'api', label: 'API tokens' }, { id: 'about', label: 'About' }]} value={tab} onChange={setTab} />
      <div className="mt">
        {tab === 'general' && <General />}
        {tab === 'users' && <Users />}
        {tab === 'profile' && <Profile />}
        {tab === 'api' && <Tokens />}
        {tab === 'about' && <About />}
      </div>
    </>
  )
}

function General() {
  const { settings, setSettings, user } = useApp()
  const { toast } = useToast()
  const [f, setF] = useState<SettingsT | null>(settings)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!f && settings) setF(settings) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <Loading />
  const isAdmin = user?.role === 'admin'
  const save = async () => {
    setBusy(true)
    try { const s = await api.put<SettingsT>(`${V1}/settings`, f); setSettings(s); setF(s); toast('Saved') } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <div className="two-col">
      <Card title="Preferences">
        <div className="grid" style={{ gap: 14 }}>
          <Field label="App title" help={isAdmin ? 'Shown in the sidebar and browser tab, for everyone.' : 'Set by an admin for the whole box.'}><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={40} disabled={!isAdmin} /></Field>
          <div className="two-col tight">
            <Field group label="Date format" help={`Today: ${fmtYMD(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate(), true, f.date_format)}`}>
              <Select value={f.date_format || 'auto'} onChange={v => setF({ ...f, date_format: v as SettingsT['date_format'] })} options={DATE_FORMATS.map(d => ({ value: d.id, label: d.label }))} ariaLabel="Date format" />
            </Field>
            <Field group label="Time format" help={`Now: ${fmtTime(new Date(), f.time_format)}`}>
              <Select value={f.time_format || 'auto'} onChange={v => setF({ ...f, time_format: v as SettingsT['time_format'] })} options={TIME_FORMATS.map(t => ({ value: t.id, label: t.label }))} ariaLabel="Time format" />
            </Field>
          </div>
          <div><button className="btn primary" onClick={save} disabled={busy}>Save</button></div>
          <p className="muted small">Date and time format are your own; {isAdmin ? 'the title applies to everyone.' : 'the title is set by an admin.'}</p>
        </div>
      </Card>
      <Card title="How review time is measured">
        <p className="muted">The server keeps the clock, not the browser. Time counts while a document is open in a visible tab and you did something with it (scrolled, moved the mouse, typed, zoomed) in the last {Math.round((f.idle_after_seconds || 120) / 60)} minute(s). Several tabs count once. The time goes to the page in view, which is how the report knows which pages each person actually read.</p>
        <p className="muted small">Uploads up to {f.max_upload_mb} MB. Set by whoever runs the box (<code>IDLE_AFTER</code>, <code>MAX_UPLOAD_MB</code>).</p>
      </Card>
    </div>
  )
}

function Users() {
  const { user, users, reloadUsers, status } = useApp()
  const { toast } = useToast()
  const [edit, setEdit] = useState<Partial<User> | null>(null)
  const [del, setDel] = useState<User | null>(null)
  const isAdmin = user?.role === 'admin'
  const run = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); await reloadUsers(); toast(msg) } catch (e) { toast((e as Error).message, 'err') } }
  return (
    <Card title="Users" actions={isAdmin && <button className="btn primary sm" onClick={() => setEdit({ role: 'member' })}>+ Add user</button>}>
      <p className="muted">Everyone signs in with their own account and sees only the reviews they are on. Review owners can also invite people by email right from a review; those accounts have no password until an admin sets one (or they use single sign-on). Admins manage users and the title; they do not see other people's reviews.</p>
      <table className="table compact">
        <thead><tr><th /><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td style={{ width: 32 }}><Avatar id={u.id} name={u.name || u.email} /></td>
              <td>{u.name || <span className="muted">—</span>}{u.id === user?.id && <span className="badge" style={{ marginLeft: 6 }}>you</span>}</td>
              <td className="muted">{u.email}</td>
              <td><span className={`badge ${u.role === 'admin' ? 'cat' : ''}`}>{u.role}</span></td>
              <td className="right">{isAdmin && <span className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost sm" onClick={() => setEdit(u)}>Edit</button>{u.id !== user?.id && <button className="btn ghost sm danger-text" onClick={() => setDel(u)}>Remove</button>}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status?.auth_mode !== 'local' && <p className="muted small mt">Auth mode is <code>{status?.auth_mode}</code>: users are created automatically on first visit; passwords are not used here.</p>}
      {edit && <UserModal user={edit} local={status?.auth_mode === 'local'} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reloadUsers() }} />}
      {del && <Confirm title={`Remove ${del.name || del.email}?`} message="Their account and their places on reviews are removed. Their comments and log entries stay, so the record of each review is kept. Reviews they own must be handed over first." onCancel={() => setDel(null)} onConfirm={() => { const d = del; setDel(null); run(() => api.del(`${V1}/users/${d.id}`), 'User removed') }} />}
    </Card>
  )
}

function UserModal({ user, local, onClose, onSaved }: { user: Partial<User>; local: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [f, setF] = useState({ name: user.name || '', email: user.email || '', password: '', role: user.role || 'member' })
  const [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      if (user.id) await api.put(`${V1}/users/${user.id}`, f); else await api.post(`${V1}/users`, f)
      toast(user.id ? 'User saved' : 'User added'); onSaved()
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal title={user.id ? 'Edit user' : 'Add user'} onClose={onClose}>
      <form onSubmit={save} className="grid" style={{ gap: 14 }}>
        <Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus required maxLength={60} /></Field>
        <Field label="Email" help="Used to sign in."><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required /></Field>
        {local && <Field label={user.id ? 'New password (leave empty to keep)' : 'Password'} help="At least 8 characters. Tell them to change it under Settings → Profile."><input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} minLength={user.id ? 0 : 8} required={!user.id} autoComplete="new-password" /></Field>}
        <Field group label="Role"><Segmented value={f.role} onChange={v => setF({ ...f, role: v })} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} /></Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{user.id ? 'Save' : 'Add user'}</button></div>
      </form>
    </Modal>
  )
}

function Profile() {
  const { user, setUser, status } = useApp()
  const { toast } = useToast()
  const [f, setF] = useState({ name: user?.name || '', email: user?.email || '', current_password: '', new_password: '' })
  const [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { setUser(await api.put(`${V1}/auth/me`, f)); setF(x => ({ ...x, current_password: '', new_password: '' })); toast('Profile saved') } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Card title="Profile">
      <form onSubmit={save} className="grid" style={{ gap: 14, maxWidth: 480 }}>
        <Field label="Name" help="Shown to everyone on your reviews."><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        {status?.auth_mode === 'local' && <>
          <hr />
          <Field label="Current password"><input type="password" value={f.current_password} onChange={e => setF({ ...f, current_password: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="New password" help="At least 8 characters. Leave empty to keep the current one."><input type="password" value={f.new_password} onChange={e => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" /></Field>
        </>}
        <div><button className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </Card>
  )
}

function Tokens() {
  const { toast } = useToast()
  const { data, reload } = useAsync(() => api.get<APIToken[]>(`${V1}/tokens`), [])
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState('')
  const [del, setDel] = useState<APIToken | null>(null)
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    try { const r = await api.post<{ token: string }>(`${V1}/tokens`, { name: name || 'token' }); setFresh(r.token); setName(''); reload() } catch (e) { toast((e as Error).message, 'err') }
  }
  return (
    <Card title="API tokens">
      <p className="muted">Use as <code>Authorization: Bearer &lt;token&gt;</code>. A token acts as you and sees your reviews. Good for a Homepage widget (<code>GET /api/v1/dashboard</code>) or for uploading from a script. See <code>docs/api.md</code>.</p>
      <form onSubmit={create} className="row mb"><input value={name} onChange={e => setName(e.target.value)} placeholder="Token name (e.g. Homepage)" /><button className="btn primary">Create</button></form>
      {fresh && <div className="callout success mb"><b>Copy it now — it is shown once.</b><pre className="mono" style={{ margin: '8px 0 0' }}>{fresh}</pre></div>}
      {data && data.length > 0 ? (
        <table className="table compact">
          <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Created</th><th /></tr></thead>
          <tbody>{data.map(t => <tr key={t.id}><td>{t.name}</td><td className="mono">{t.prefix}…</td><td className="muted">{t.last_used_at ? fmtDateTime(t.last_used_at) : 'never'}</td><td className="muted">{fmtDateTime(t.created_at)}</td><td className="right"><button className="btn ghost sm danger-text" onClick={() => setDel(t)}>Revoke</button></td></tr>)}</tbody>
        </table>
      ) : <p className="muted">No tokens yet.</p>}
      {del && <Confirm title={`Revoke “${del.name}”?`} message="Anything using this token stops working immediately." onCancel={() => setDel(null)} onConfirm={async () => { await api.del(`${V1}/tokens/${del.id}`); setDel(null); reload() }} />}
    </Card>
  )
}

function About() {
  const { data } = useAsync(() => api.get<Record<string, unknown>>(`${V1}/settings/system`), [])
  const counts = (data?.counts || {}) as Record<string, number>
  const core = (data?.core || {}) as { configured?: boolean; registered?: boolean; url?: string; error?: string }
  return (
    <Card title="About">
      <p><b>Pocket Collaborator</b> is document review for small teams: comments pinned to the page, issues that get resolved or rejected, tasks, sign-off, live presence, and a report of who spent how long on what. One binary, one SQLite file plus the documents, one volume.</p>
      <p className="muted small">Open source (MIT) — <a href="https://github.com/abjelosevic88/pocket-homelab-collaborator" target="_blank" rel="noreferrer">github.com/abjelosevic88/pocket-homelab-collaborator</a>. PDF rendering by Mozilla pdf.js.</p>
      {data && (
        <table className="table compact mt">
          <tbody>
            <tr><th>Version</th><td className="mono">{String(data.version)}</td></tr>
            <tr><th>Runtime</th><td className="mono">{String(data.go)} · {String(data.os)}/{String(data.arch)}</td></tr>
            <tr><th>Auth mode</th><td className="mono">{String(data.auth_mode)}</td></tr>
            <tr><th>Pocket Core</th><td className="mono">{core.configured ? `${core.url} · ${core.registered ? 'registered' : core.error || 'not registered yet'}` : 'not configured'}</td></tr>
            <tr><th>Database</th><td className="mono">{String(data.db_path)} · {(Number(data.db_bytes) / 1024).toFixed(0)} KB</td></tr>
            <tr><th>Documents</th><td className="mono">{String(data.files_dir)} · up to {String(data.max_upload_mb)} MB each</td></tr>
            <tr><th>Review clock</th><td className="mono">tick {String(data.tick)} · idle after {String(data.idle_after)} · new session after {String(data.session_gap)}</td></tr>
            <tr><th>Live now</th><td className="mono">{String(data.live_connections)} open connection(s)</td></tr>
            <tr><th>Timezone</th><td className="mono">{String(data.timezone)}</td></tr>
            <tr><th>Uptime</th><td className="mono">{String(data.uptime)}</td></tr>
            <tr><th>Yours</th><td className="mono">{counts.reviews} reviews · {counts.comments} comments · {counts.tasks} tasks · {counts.users} users on the box</td></tr>
          </tbody>
        </table>
      )}
    </Card>
  )
}
