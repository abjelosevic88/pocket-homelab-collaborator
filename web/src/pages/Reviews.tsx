import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, upload, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import type { Review, Revision } from '../lib/types'
import { ago, fmtBytes, fmtDate, personName, plural } from '../lib/format'
import { Empty, Field, Loading, Modal, PageHeader, Segmented, useAsync, useDebounce, useToast } from '../components/ui'
import { Avatar } from '../components/people'
import { countPages, isPdf, PdfDrop, PersonInvite, PersonPicker, RoleBadge, RoleSelect, StatusBadge } from '../components/review-bits'

type Filter = 'open' | 'closed' | ''

export default function Reviews() {
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<Filter>((params.get('status') as Filter) ?? 'open')
  const [role, setRole] = useState(params.get('role') || '')
  const [q, setQ] = useState('')
  const dq = useDebounce(q, 250)
  const [creating, setCreating] = useState(params.get('new') === '1')
  const { data, loading, reload } = useAsync(() => api.get<Review[]>(`${V1}/reviews?status=${filter}&role=${role}&q=${encodeURIComponent(dq)}`), [filter, role, dq])
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t) }, [reload])

  return (
    <>
      <PageHeader title="Reviews" sub="Every document you are on, as owner, approver, reviewer or observer."
        actions={<button className="btn primary" onClick={() => setCreating(true)}>+ New review</button>} />
      <div className="toolbar">
        <Segmented value={filter} onChange={v => { setFilter(v); setParams(p => { p.set('status', v); return p }) }} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Finished' }, { value: '', label: 'All' }]} />
        <Segmented size="sm" value={role} onChange={setRole} options={[{ value: '', label: 'Any role' }, { value: 'owner', label: 'Mine' }, { value: 'approver', label: 'To approve' }, { value: 'reviewer', label: 'To review' }, { value: 'observer', label: 'Watching' }]} />
        <div className="search"><span className="ico">⌕</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search titles…" /></div>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? (
        <div className="card"><Empty title={filter === 'open' ? 'Nothing under review' : 'No reviews here'}>Upload a PDF, add an approver and reviewers, and start the review.</Empty>
          <div className="row" style={{ justifyContent: 'center', paddingBottom: 24 }}><button className="btn primary" onClick={() => setCreating(true)}>+ New review</button></div></div>
      ) : (
        <div className="review-list">{data.map(r => <ReviewRow key={r.id} r={r} />)}</div>
      )}
      {creating && <NewReview onClose={() => { setCreating(false); setParams(p => { p.delete('new'); return p }) }} />}
    </>
  )
}

export function ReviewRow({ r, why }: { r: Review; why?: string }) {
  const { user } = useApp()
  const owner = r.participants.find(p => p.role === 'owner')
  const others = r.participants.filter(p => p.user_id !== user?.id)
  const live = new Map((r.live_now || []).map(p => [p.user_id, p]))
  const rev = r.revisions.find(v => v.id === r.current_revision_id)
  const overdue = r.due_date && r.due_date < new Date().toISOString().slice(0, 10) && !['approved', 'rejected', 'cancelled'].includes(r.status)
  return (
    <Link to={`/reviews/${r.id}`} className="review-row card">
      <div className="doc-ico">PDF{rev && <small>v{rev.number}</small>}</div>
      <div className="info">
        <div className="row wrap" style={{ gap: 6 }}>
          <b className="nm">{r.title}</b>
          <StatusBadge status={r.status} />
          <RoleBadge role={r.my_role} />
          {why && <span className="badge warn">{why}</span>}
        </div>
        <div className="meta">
          {owner && owner.user_id !== user?.id && <>by {personName(owner)} · </>}
          {rev ? <>{plural(r.page_count || rev.page_count, 'page')} · {fmtBytes(rev.size)}</> : 'no document yet'}
          {r.due_date && <> · <span className={overdue ? 'bad' : ''}>due {fmtDate(r.due_date)}</span></>}
          {r.last_activity && <> · {ago(r.last_activity)}</>}
        </div>
      </div>
      <div className="side">
        <span className="avatar-stack">{others.slice(0, 6).map(p => {
          const l = live.get(p.user_id)
          return (
            <span key={p.user_id} className={`pa ${l ? 'is-live' : ''}`} title={`${personName(p)} — ${p.role}${p.verdict ? `, ${p.verdict}` : ''}${l ? ` · here now, page ${l.page}` : ''}`}>
              <Avatar id={p.user_id} name={personName(p)} title="" />{l && <span className="pg">{l.page}</span>}
            </span>
          )
        })}</span>
        <span className="counts">
          {r.open_issues > 0 && <span className="badge sev-major" title="Open issues">! {r.open_issues}</span>}
          <span className="badge" title="Open threads / all threads">💬 {r.open_threads}/{r.threads}</span>
          {r.open_tasks > 0 && <span className="badge" title="Open tasks">☐ {r.open_tasks}</span>}
        </span>
      </div>
    </Link>
  )
}

function NewReview({ onClose }: { onClose: () => void }) {
  const { users, user } = useApp()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [f, setF] = useState({ title: '', description: '', due_date: '', require_resolved: true })
  const [file, setFile] = useState<File | null>(null)
  const [pages, setPages] = useState(0)
  const [people, setPeople] = useState<PersonInvite[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const pick = async (fl: File | undefined) => {
    if (!fl) return
    if (!isPdf(fl)) { toast('Only PDF documents for now', 'err'); return }
    setFile(fl)
    if (!f.title) setF(x => ({ ...x, title: fl.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ') }))
    try { setPages(await countPages(fl)) } catch { setPages(0); toast('That PDF could not be read — is it damaged or password-protected?', 'err') }
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { toast('Pick the PDF to review', 'err'); return }
    setBusy(true)
    try {
      const rv = await api.post<Review>(`${V1}/reviews`, { ...f, people })
      await upload<Revision>(`${V1}/reviews/${rv.id}/revisions`, { file, page_count: String(pages) }, setProgress)
      toast('Review created')
      navigate(`/reviews/${rv.id}`)
    } catch (e) { toast((e as Error).message, 'err'); setBusy(false) }
  }
  const label = (p: PersonInvite) => p.email || personName(users.find(u => u.id === p.user_id))
  return (
    <Modal title="New review" onClose={onClose} size="lg">
      <form onSubmit={save} className="grid" style={{ gap: 14 }}>
        <PdfDrop file={file} pages={pages} onPick={pick} disabled={busy} />
        <Field label="Title"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required maxLength={200} /></Field>
        <Field label="What should reviewers look at?" help="Optional. Shown at the top of the review."><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        <div className="two-col tight">
          <Field label="Due date" help="Optional"><input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field group label="Approval rule"><label className="row small"><input type="checkbox" checked={f.require_resolved} onChange={e => setF({ ...f, require_resolved: e.target.checked })} style={{ width: 'auto' }} /> Approve only when every issue is resolved or rejected</label></Field>
        </div>
        <Field group label="People" help="An approver signs off; reviewers read and comment; observers read along. You are the owner. You can change all this later.">
          {people.length > 0 && <ul className="mini-list">{people.map((p, i) => (
            <li key={i}><Avatar id={p.user_id || i + 100} name={label(p)} /><span className="grow">{label(p)}</span>
              <RoleSelect value={p.role} onChange={role => setPeople(ps => ps.map((x, j) => j === i ? { ...x, role } : x))} />
              <button type="button" className="btn ghost sm" onClick={() => setPeople(ps => ps.filter((_, j) => j !== i))}>✕</button></li>
          ))}</ul>}
          <PersonPicker users={users} exclude={[user!.id, ...people.map(p => p.user_id || 0)]} onAdd={p => setPeople(ps => [...ps, p])} />
        </Field>
        {busy && <div className="bar lg"><span className="fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !file}>{busy ? `Uploading… ${Math.round(progress * 100)}%` : 'Create review'}</button></div>
        <p className="muted small">The review starts as a draft: look it over, then press <b>Start review</b> to open it to everyone.</p>
      </form>
    </Modal>
  )
}
