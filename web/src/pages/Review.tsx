import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, upload, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import { useLive } from '../lib/live'
import type { Anchor, Comment, CommentKind, Event, Participant, Review, Revision, Role, Severity, Task, ThreadStatus, Verdict } from '../lib/types'
import { ago, fmtBytes, fmtDate, fmtDateTime, fmtDuration, personName, plural, REVIEWER_VERDICT_LABEL, ROLE_HELP, ROLE_LABEL, VERDICT_LABEL } from '../lib/format'
import { Confirm, Field, Loading, Modal, Segmented, useToast } from '../components/ui'
import { Avatar, LiveStack } from '../components/people'
import PdfViewer, { KIND_ICON, Tool } from '../components/PdfViewer'
import { countPages, PersonPicker, RoleBadge, SeverityBadge, StatusBadge } from '../components/review-bits'

type Tab = 'threads' | 'tasks' | 'people' | 'log'

export default function ReviewPage() {
  const { id } = useParams()
  const rid = Number(id)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useApp()
  const { toast } = useToast()
  const [review, setReview] = useState<Review | null>(null)
  const [threads, setThreads] = useState<Comment[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [logTick, setLogTick] = useState(0)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('threads')
  const [selected, setSelected] = useState<number | null>(null)
  const [jump, setJump] = useState<{ page: number; y: number; nonce: number } | null>(null)
  const [pending, setPending] = useState<{ page: number; anchor: Anchor } | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [page, setPage] = useState(1)
  const [showCursors, setShowCursors] = useState(() => localStorage.getItem('pcl-cursors') !== '0')
  const [modal, setModal] = useState<'' | 'verdict' | 'upload' | 'edit' | 'cancel' | 'delete'>('')
  const [taskFrom, setTaskFrom] = useState<Comment | null | undefined>(undefined)

  const loadReview = useCallback(() => api.get<Review>(`${V1}/reviews/${rid}`).then(setReview).catch(e => setErr((e as Error).message)), [rid])
  const loadThreads = useCallback(() => api.get<Comment[]>(`${V1}/reviews/${rid}/comments`).then(setThreads).catch(() => {}), [rid])
  const loadTasks = useCallback(() => api.get<Task[]>(`${V1}/reviews/${rid}/tasks`).then(setTasks).catch(() => {}), [rid])
  useEffect(() => { loadReview(); loadThreads(); loadTasks() }, [loadReview, loadThreads, loadTasks])

  const revId = Number(params.get('v')) || review?.current_revision_id || 0
  const rev = review?.revisions.find(v => v.id === revId)
  const isCurrent = revId === review?.current_revision_id

  const live = useLive(rid, revId, {
    onChanged: what => {
      if (what.includes('deleted')) { toast('This review was deleted', 'err'); navigate('/reviews'); return }
      if (what.includes('comments')) loadThreads()
      if (what.includes('tasks')) loadTasks()
      if (what.some(w => w === 'review' || w === 'people')) loadReview()
      if (what.includes('events')) setLogTick(t => t + 1)
    },
    onBye: () => { toast('You were taken off this review', 'err'); navigate('/reviews') },
  })
  const onPage = useCallback((p: number) => { setPage(p); live.setPage(p) }, [live.setPage]) // eslint-disable-line react-hooks/exhaustive-deps
  const onPageCount = useCallback((n: number) => {
    if (rev && rev.page_count === 0) api.put(`${V1}/reviews/${rid}/revisions/${rev.id}/pages`, { page_count: n }).catch(() => {})
  }, [rev, rid])

  // threads drawn on this revision: its own, plus open ones carried over from earlier revisions
  const { shown, carried } = useMemo(() => {
    const carried = new Set<number>()
    const shown = threads.filter(t => {
      if (t.revision_id === revId) return true
      const tRev = review?.revisions.find(v => v.id === t.revision_id)
      if (isCurrent && t.status === 'open' && tRev && rev && tRev.number < rev.number) { carried.add(t.id); return true }
      return false
    })
    return { shown, carried }
  }, [threads, revId, isCurrent, review, rev])

  if (err) return <div className="callout danger">{err === 'not found' ? 'This review does not exist, or you are not on it.' : err} <Link to="/reviews">Back to reviews</Link></div>
  if (!review) return <Loading />

  const me = review.participants.find(p => p.user_id === user?.id)
  const role = review.my_role
  const locked = ['approved', 'rejected', 'cancelled'].includes(review.status)
  const canComment = role !== 'observer' && !locked
  const approvers = review.participants.filter(p => p.role === 'approver')
  const decider = role === 'approver' || (role === 'owner' && approvers.length === 0)

  const select = (t: Comment) => {
    setSelected(t.id); setTab('threads')
    const y = t.anchor?.rects?.[0]?.y ?? 0
    setJump({ page: t.page || 1, y, nonce: Date.now() })
  }
  const runStatus = async (action: string, note = '') => {
    try { setReview(await api.post<Review>(`${V1}/reviews/${rid}/status`, { action, note })); toast('Done') } catch (e) { toast((e as Error).message, 'err') }
  }
  const setRevision = (v: number) => setParams(p => { if (v === review.current_revision_id) p.delete('v'); else p.set('v', String(v)); return p })

  return (
    <div className="review-page">
      <header className="review-head">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Link to="/reviews" className="btn ghost sm" title="All reviews">←</Link>
            <h1 className="review-title" title={review.title}>{review.title}</h1>
            <StatusBadge status={review.status} />
            <RoleBadge role={role} />
          </div>
          <div className="meta row wrap">
            {review.revisions.length > 0 && (
              <select className="rev-select" value={revId} onChange={e => setRevision(Number(e.target.value))} aria-label="Revision">
                {[...review.revisions].reverse().map(v => <option key={v.id} value={v.id}>v{v.number}{v.id === review.current_revision_id ? ' (current)' : ''} · {fmtDate(v.created_at.slice(0, 10))}</option>)}
              </select>
            )}
            {rev && <span>{rev.filename} · {fmtBytes(rev.size)}</span>}
            {review.due_date && <span>· due {fmtDate(review.due_date)}</span>}
            {review.open_issues > 0 && <span className="badge sev-major">{plural(review.open_issues, 'open issue')}</span>}
            {!isCurrent && <span className="badge warn">Viewing an older revision</span>}
          </div>
        </div>
        <div className="head-live">
          <LiveStack people={live.people} meConn={live.me?.conn} onPick={p => { if (p.conn !== live.me?.conn) setJump({ page: p.page, y: 0, nonce: Date.now() }) }} />
          <span className={`conn ${live.connected ? 'on' : ''}`} title={live.connected ? 'Live' : 'Reconnecting…'} />
        </div>
        <div className="actions row wrap">
          <Actions review={review} me={me} decider={decider} onStatus={runStatus} openModal={setModal} />
          <Link className="btn" to={`/reviews/${rid}/report`}>Report</Link>
        </div>
      </header>
      {review.description && <p className="review-desc">{review.description}</p>}

      <div className="review-body">
        <div className="review-viewer">
          {rev ? (
            <PdfViewer url={`${V1}/reviews/${rid}/revisions/${rev.id}/file`} threads={shown} carried={carried} selectedId={selected}
              onSelect={tid => { const t = threads.find(x => x.id === tid); if (t) { setSelected(tid); setTab('threads') } }}
              tool={tool} setTool={setTool} canComment={canComment} pending={pending}
              onAnchor={(pg, a) => { setPending({ page: pg, anchor: a }); setTab('threads'); setSelected(null); setTool('select') }}
              onPage={onPage} onPageCount={onPageCount}
              cursors={Object.values(live.cursors).filter(c => c.conn !== live.me?.conn)} showCursors={showCursors}
              onCursor={live.sendCursor} jump={jump} />
          ) : (
            <div className="card pad"><b>No document yet.</b> {role === 'owner' ? <button className="btn primary sm" onClick={() => setModal('upload')}>Upload the PDF</button> : 'The owner has not uploaded it yet.'}</div>
          )}
        </div>
        <aside className="review-side">
          <div className="tabs side-tabs">
            {([['threads', `Threads ${review.open_threads ? `(${review.open_threads})` : ''}`], ['tasks', `Tasks ${review.open_tasks ? `(${review.open_tasks})` : ''}`], ['people', 'People'], ['log', 'Log']] as [Tab, string][]).map(([t, l]) => (
              <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{l}</button>
            ))}
          </div>
          <div className="side-body">
            {tab === 'threads' && <>
              {pending && <Composer rid={rid} revisionId={revId} pending={pending} onCancel={() => setPending(null)}
                onSaved={c => { setPending(null); loadThreads(); loadReview(); setSelected(c.id) }} />}
              {!pending && canComment && <p className="muted small hint">Select text in the document and press <b>Comment</b>, or switch to <b>▭ Comment area</b> and drag a box. {!isCurrent && 'You are on an older revision; new comments go on it.'}</p>}
              <Threads review={review} threads={shown} carried={carried} page={page} selected={selected} onSelect={select}
                reload={() => { loadThreads(); loadReview() }} onTask={c => setTaskFrom(c)} locked={locked} />
            </>}
            {tab === 'tasks' && <Tasks review={review} tasks={tasks} threads={threads} locked={locked} onNew={() => setTaskFrom(null)} reload={() => { loadTasks(); loadReview() }} onOpenThread={t => select(t)} />}
            {tab === 'people' && <People review={review} live={live.people} reload={loadReview} />}
            {tab === 'log' && <Log rid={rid} tick={logTick} review={review} onOpenThread={cid => { const t = threads.find(x => x.id === cid || x.replies?.some(r => r.id === cid)); if (t) select(t) }} />}
          </div>
          <div className="side-foot row">
            <label className="row small muted"><input type="checkbox" checked={showCursors} onChange={e => { setShowCursors(e.target.checked); localStorage.setItem('pcl-cursors', e.target.checked ? '1' : '0') }} style={{ width: 'auto' }} /> Show others' cursors</label>
            <span className="spacer" />
            {me && <span className="muted small" title="Measured while this document is open, visible and in use">Your time: {fmtDuration(me.active_seconds)}</span>}
          </div>
        </aside>
      </div>

      {modal === 'verdict' && <VerdictModal review={review} me={me!} decider={decider} onClose={() => setModal('')} onDone={r => { setReview(r); setModal('') }} />}
      {modal === 'upload' && <UploadModal review={review} onClose={() => setModal('')} onDone={() => { setModal(''); setParams(p => { p.delete('v'); return p }); loadReview() }} />}
      {modal === 'edit' && <EditModal review={review} onClose={() => setModal('')} onDone={() => { setModal(''); loadReview() }} onDelete={() => setModal('delete')} />}
      {modal === 'cancel' && <Confirm title="Cancel this review?" message="Nobody can comment any more. You can reopen it later; everything stays in the log." onCancel={() => setModal('')} onConfirm={() => { setModal(''); runStatus('cancel') }} />}
      {modal === 'delete' && <Confirm title="Delete this review for everyone?" message="The document, every revision, all comments, tasks, the log and the time records are deleted. This cannot be undone — cancel the review instead if you want to keep the record." onCancel={() => setModal('')}
        onConfirm={async () => { try { await api.del(`${V1}/reviews/${rid}`); toast('Review deleted'); navigate('/reviews') } catch (e) { toast((e as Error).message, 'err') } }} />}
      {taskFrom !== undefined && <TaskModal review={review} from={taskFrom} onClose={() => setTaskFrom(undefined)} onDone={() => { setTaskFrom(undefined); loadTasks(); loadReview(); setTab('tasks') }} />}
    </div>
  )
}

// ---------- header actions ----------

function Actions({ review, me, decider, onStatus, openModal }: { review: Review; me?: Participant; decider: boolean; onStatus: (a: string) => void; openModal: (m: 'verdict' | 'upload' | 'edit' | 'cancel') => void }) {
  const role = review.my_role
  const s = review.status
  const locked = ['approved', 'rejected', 'cancelled'].includes(s)
  const out: React.ReactNode[] = []
  if (role === 'owner') {
    if (s === 'draft') out.push(<button key="start" className="btn primary" disabled={!review.current_revision_id} onClick={() => onStatus('start')} title="Open the review to everyone on it">Start review</button>)
    if (s === 'changes_requested') {
      out.push(<button key="up" className="btn primary" onClick={() => openModal('upload')}>Upload v{review.revisions.length + 1}</button>)
      out.push(<button key="resume" className="btn" onClick={() => onStatus('resume')} title="Back in review without a new revision">Resume</button>)
    }
    if (s === 'in_review' && decider) out.push(<button key="done" className="btn primary" onClick={() => openModal('verdict')}>Complete…</button>)
    if (locked) out.push(<button key="reopen" className="btn" onClick={() => onStatus('reopen')}>Reopen</button>)
  }
  if (s === 'in_review' && role === 'approver' && me) {
    out.push(<button key="decide" className={`btn ${me.verdict ? '' : 'primary'}`} onClick={() => openModal('verdict')}>{me.verdict ? `${VERDICT_LABEL[me.verdict as Exclude<Verdict, ''>]} · change` : 'Decide…'}</button>)
  }
  if (s === 'in_review' && role === 'reviewer' && me) {
    out.push(<button key="finish" className={`btn ${me.state === 'done' ? '' : 'primary'}`} onClick={() => openModal('verdict')}>{me.state === 'done' && me.verdict ? `${REVIEWER_VERDICT_LABEL[me.verdict as Exclude<Verdict, ''>]} · change` : 'Finish review…'}</button>)
  }
  if (role === 'owner') {
    out.push(
      <details key="more" className="menu">
        <summary className="btn" aria-label="More">⋯</summary>
        <div className="menu-pop">
          {!locked && <button className="menu-item" onClick={() => openModal('upload')}>Upload new revision</button>}
          <button className="menu-item" onClick={() => openModal('edit')}>Edit details…</button>
          {!locked && <button className="menu-item danger-text" onClick={() => openModal('cancel')}>Cancel review</button>}
        </div>
      </details>,
    )
  }
  return <>{out}</>
}

// ---------- composer ----------

function Composer({ rid, revisionId, pending, onCancel, onSaved }: { rid: number; revisionId: number; pending: { page: number; anchor: Anchor }; onCancel: () => void; onSaved: (c: Comment) => void }) {
  const { toast } = useToast()
  const [kind, setKind] = useState<CommentKind>('comment')
  const [severity, setSeverity] = useState<Severity>('major')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [pending])
  const save = async () => {
    if (!body.trim()) return
    setBusy(true)
    try {
      const c = await api.post<Comment>(`${V1}/reviews/${rid}/comments`, { revision_id: revisionId, page: pending.page, anchor: pending.anchor, kind, severity: kind === 'issue' ? severity : '', body })
      onSaved(c)
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <div className="composer card">
      <div className="row muted small">New thread on page {pending.page}<span className="spacer" /><button className="btn ghost sm" onClick={onCancel}>✕</button></div>
      {pending.anchor.quote && <blockquote className="quote">{pending.anchor.quote}</blockquote>}
      <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: 'comment', label: '💬 Comment' }, { value: 'question', label: '? Question' }, { value: 'issue', label: '! Issue' }]} />
      {kind === 'issue' && <Segmented size="sm" value={severity} onChange={setSeverity} options={[{ value: 'minor', label: 'Minor' }, { value: 'major', label: 'Major' }, { value: 'critical', label: 'Critical' }]} />}
      <textarea ref={ref} rows={3} value={body} onChange={e => setBody(e.target.value)} placeholder={kind === 'issue' ? 'What is wrong, and what should it say?' : kind === 'question' ? 'What would you like to know?' : 'Your comment…'}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') onCancel() }} />
      <div className="row"><span className="muted small">⌘/Ctrl + Enter</span><span className="spacer" /><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !body.trim()}>Post</button></div>
    </div>
  )
}

// ---------- threads ----------

function Threads({ review, threads, carried, page, selected, onSelect, reload, onTask, locked }: {
  review: Review; threads: Comment[]; carried: Set<number>; page: number; selected: number | null; onSelect: (t: Comment) => void; reload: () => void; onTask: (c: Comment) => void; locked: boolean
}) {
  const [status, setStatus] = useState<'open' | 'all' | 'resolved' | 'rejected'>('open')
  const [kind, setKind] = useState<'' | CommentKind>('')
  const [here, setHere] = useState(false)
  const list = threads
    .filter(t => status === 'all' || t.status === status)
    .filter(t => !kind || t.kind === kind)
    .filter(t => !here || t.page === page)
    .sort((a, b) => (a.page - b.page) || ((a.anchor?.rects?.[0]?.y ?? 0) - (b.anchor?.rects?.[0]?.y ?? 0)) || a.id - b.id)
  const selRef = useRef<HTMLDivElement>(null)
  useEffect(() => { selRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [selected])
  return (
    <>
      <div className="thread-filters">
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} aria-label="State"><option value="open">Open</option><option value="all">All</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select>
        <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} aria-label="Kind"><option value="">Every kind</option><option value="issue">Issues</option><option value="question">Questions</option><option value="comment">Comments</option></select>
        <label className="row small"><input type="checkbox" checked={here} onChange={e => setHere(e.target.checked)} style={{ width: 'auto' }} /> Page {page}</label>
      </div>
      {list.length === 0 && <p className="muted small" style={{ padding: '12px 2px' }}>{threads.length ? 'Nothing matches.' : 'No threads yet.'}</p>}
      <div className="thread-list">
        {list.map(t => (
          <div key={t.id} ref={selected === t.id ? selRef : undefined}>
            <ThreadCard review={review} t={t} carried={carried.has(t.id)} open={selected === t.id} onSelect={() => onSelect(t)} reload={reload} onTask={() => onTask(t)} locked={locked} />
          </div>
        ))}
      </div>
    </>
  )
}

function ThreadCard({ review, t, carried, open, onSelect, reload, onTask, locked }: { review: Review; t: Comment; carried: boolean; open: boolean; onSelect: () => void; reload: () => void; onTask: () => void; locked: boolean }) {
  const { user } = useApp()
  const { toast } = useToast()
  const [reply, setReply] = useState('')
  const [closing, setClosing] = useState<ThreadStatus | null>(null)
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<Comment | null>(null)
  const [busy, setBusy] = useState(false)
  const role = review.my_role
  const mine = t.author_id === user?.id
  const canModerate = role === 'owner' || role === 'approver'
  const canClose = !locked && (canModerate || mine)
  const canReply = !locked && role !== 'observer'
  const revNum = review.revisions.find(v => v.id === t.revision_id)?.number
  const run = async (fn: () => Promise<unknown>, msg?: string) => { setBusy(true); try { await fn(); reload(); if (msg) toast(msg) } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) } }
  const setStatus = (status: ThreadStatus) => run(async () => { await api.post(`${V1}/reviews/${review.id}/comments/${t.id}/status`, { status, note }); setClosing(null); setNote('') },
    { open: 'Reopened', resolved: 'Resolved', rejected: 'Rejected' }[status])
  const send = () => reply.trim() && run(async () => { await api.post(`${V1}/reviews/${review.id}/comments`, { parent_id: t.id, body: reply }); setReply('') })
  return (
    <div className={`thread card ${open ? 'open' : ''} st-${t.status} kind-${t.kind} ${t.severity ? 'sev-' + t.severity : ''}`} onClick={() => !open && onSelect()}>
      <div className="thread-head">
        <span className={`kind-ico ${t.kind} ${t.severity}`}>{KIND_ICON[t.kind]}</span>
        <span className="grow">
          <span className="row wrap" style={{ gap: 6 }}>
            <b>{t.author_name}</b>
            {t.kind === 'issue' && <SeverityBadge severity={t.severity} />}
            {t.kind === 'question' && <span className="badge">Question</span>}
            {t.status !== 'open' && <span className={`badge st-${t.status}`}>{t.status === 'resolved' ? '✓ Resolved' : '✕ Rejected'}</span>}
            {carried && <span className="badge warn" title="Opened on an earlier revision and still open">from v{revNum}</span>}
          </span>
          <span className="muted small">#{t.id} · <button type="button" className="linklike" onClick={e => { e.stopPropagation(); onSelect() }}>page {t.page || '—'}</button> · {ago(t.created_at)}{t.edited_at && ' · edited'}</span>
        </span>
        {(t.replies?.length ?? 0) > 0 && !open && <span className="badge">↩ {t.replies!.length}</span>}
      </div>
      {t.anchor?.quote && <blockquote className="quote">{t.anchor.quote}</blockquote>}
      {editing?.id === t.id ? <EditBox review={review} c={t} onDone={() => { setEditing(null); reload() }} /> :
        <div className={`body ${open ? '' : 'clamp'}`}>{t.deleted ? <i className="muted">deleted</i> : t.body}</div>}
      {open && <>
        {t.replies?.map(r => (
          <div key={r.id} className="reply">
            <Avatar id={r.author_id} name={r.author_name} size="sm" />
            <div className="grow">
              <div className="small"><b>{r.author_name}</b> <span className="muted">{ago(r.created_at)}{r.edited_at && ' · edited'}</span>
                {r.author_id === user?.id && !locked && !r.deleted && <span className="reply-tools"><button className="linklike" onClick={() => setEditing(r)}>edit</button> <button className="linklike danger-text" onClick={() => run(() => api.del(`${V1}/reviews/${review.id}/comments/${r.id}`), 'Deleted')}>delete</button></span>}</div>
              {editing?.id === r.id ? <EditBox review={review} c={r} onDone={() => { setEditing(null); reload() }} /> : <div className="body">{r.deleted ? <i className="muted">deleted</i> : r.body}</div>}
            </div>
          </div>
        ))}
        {t.status !== 'open' && <div className={`status-note st-${t.status}`}>{t.status === 'resolved' ? 'Resolved' : 'Rejected'} {t.status_at && ago(t.status_at)}{t.status_note && <>: {t.status_note}</>}</div>}
        {canReply && t.status === 'open' && (
          <div className="reply-box">
            <textarea rows={2} value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply…" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} />
            <button className="btn primary sm" onClick={send} disabled={busy || !reply.trim()}>Reply</button>
          </div>
        )}
        {closing && (
          <div className="close-box">
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} autoFocus placeholder={closing === 'rejected' ? 'Why is this not going to change? (required)' : 'What was done? (optional)'} />
            <div className="row"><span className="spacer" /><button className="btn sm" onClick={() => setClosing(null)}>Cancel</button>
              <button className={`btn sm ${closing === 'rejected' ? 'danger' : 'primary'}`} disabled={busy || (closing === 'rejected' && !note.trim())} onClick={() => setStatus(closing)}>{closing === 'rejected' ? 'Reject' : 'Resolve'}</button></div>
          </div>
        )}
        {!closing && (
          <div className="thread-actions">
            {canClose && t.status === 'open' && <><button className="btn sm" onClick={() => setClosing('resolved')}>✓ Resolve</button><button className="btn sm" onClick={() => setClosing('rejected')}>✕ Reject</button></>}
            {canClose && t.status !== 'open' && <button className="btn sm" onClick={() => setStatus('open')}>Reopen</button>}
            {canReply && <button className="btn ghost sm" onClick={onTask}>☐ Make task</button>}
            <span className="spacer" />
            {mine && !locked && !t.deleted && <><button className="btn ghost sm" onClick={() => setEditing(t)}>Edit</button><button className="btn ghost sm danger-text" onClick={() => run(() => api.del(`${V1}/reviews/${review.id}/comments/${t.id}`), 'Deleted')}>Delete</button></>}
          </div>
        )}
      </>}
    </div>
  )
}

function EditBox({ review, c, onDone }: { review: Review; c: Comment; onDone: () => void }) {
  const { toast } = useToast()
  const [body, setBody] = useState(c.body)
  const [kind, setKind] = useState<CommentKind>(c.kind)
  const [severity, setSeverity] = useState<Severity>(c.severity || 'major')
  const root = c.parent_id === 0
  const save = async () => {
    try { await api.put(`${V1}/reviews/${review.id}/comments/${c.id}`, { body, kind: root ? kind : undefined, severity: root && kind === 'issue' ? severity : '' }); onDone() } catch (e) { toast((e as Error).message, 'err') }
  }
  return (
    <div className="grid" style={{ gap: 6 }} onClick={e => e.stopPropagation()}>
      {root && <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: 'comment', label: 'Comment' }, { value: 'question', label: 'Question' }, { value: 'issue', label: 'Issue' }]} />}
      {root && kind === 'issue' && <Segmented size="sm" value={severity} onChange={setSeverity} options={[{ value: 'minor', label: 'Minor' }, { value: 'major', label: 'Major' }, { value: 'critical', label: 'Critical' }]} />}
      <textarea rows={3} value={body} onChange={e => setBody(e.target.value)} autoFocus />
      <div className="row"><span className="spacer" /><button className="btn sm" onClick={onDone}>Cancel</button><button className="btn primary sm" onClick={save} disabled={!body.trim()}>Save</button></div>
    </div>
  )
}

// ---------- tasks ----------

function Tasks({ review, tasks, threads, locked, onNew, reload, onOpenThread }: { review: Review; tasks: Task[]; threads: Comment[]; locked: boolean; onNew: () => void; reload: () => void; onOpenThread: (t: Comment) => void }) {
  const { user } = useApp()
  const { toast } = useToast()
  const canModerate = review.my_role === 'owner' || review.my_role === 'approver'
  const toggle = async (t: Task) => {
    try { await api.put(`${V1}/reviews/${review.id}/tasks/${t.id}`, { status: t.status === 'done' ? 'open' : 'done' }); reload() } catch (e) { toast((e as Error).message, 'err') }
  }
  const del = async (t: Task) => { try { await api.del(`${V1}/reviews/${review.id}/tasks/${t.id}`); reload() } catch (e) { toast((e as Error).message, 'err') } }
  return (
    <>
      {!locked && review.my_role !== 'observer' && <button className="btn sm mb-sm" onClick={onNew}>+ Add task</button>}
      {tasks.length === 0 && <p className="muted small">No tasks. Turn a thread into one with <b>☐ Make task</b>, or add one here.</p>}
      <ul className="task-list">
        {tasks.map(t => {
          const can = !locked && (canModerate || t.created_by === user?.id || t.assignee_id === user?.id)
          const th = threads.find(x => x.id === t.comment_id)
          const overdue = t.status === 'open' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10)
          return (
            <li key={t.id} className={t.status}>
              <input type="checkbox" checked={t.status === 'done'} disabled={!can} onChange={() => toggle(t)} style={{ width: 'auto' }} aria-label="Done" />
              <div className="grow">
                <div className="t-title">{t.title}</div>
                <div className="muted small">
                  {t.assignee_id ? <>→ {t.assignee_name}</> : 'unassigned'}
                  {t.due_date && <> · <span className={overdue ? 'bad' : ''}>due {fmtDate(t.due_date)}</span></>}
                  {th && <> · <button className="linklike" onClick={() => onOpenThread(th)}>from #{th.id}</button></>}
                  {t.status === 'done' && t.done_at && <> · done {ago(t.done_at)}</>}
                </div>
                {t.notes && <div className="small">{t.notes}</div>}
              </div>
              {can && (canModerate || t.created_by === user?.id) && <button className="btn ghost sm danger-text" onClick={() => del(t)} title="Delete">✕</button>}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function TaskModal({ review, from, onClose, onDone }: { review: Review; from: Comment | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [f, setF] = useState({ title: from ? from.body.split('\n')[0].slice(0, 200) : '', notes: '', assignee_id: from && review.my_role !== 'owner' ? review.owner_id : 0, due_date: '' })
  const [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { await api.post(`${V1}/reviews/${review.id}/tasks`, { ...f, comment_id: from?.id || 0 }); toast('Task added'); onDone() } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal title={from ? `Task from #${from.id}` : 'New task'} onClose={onClose}>
      <form onSubmit={save} className="grid" style={{ gap: 12 }}>
        <Field label="Task"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required maxLength={300} autoFocus /></Field>
        <div className="two-col tight">
          <Field label="Assignee"><select value={f.assignee_id} onChange={e => setF({ ...f, assignee_id: Number(e.target.value) })}>
            <option value={0}>Nobody yet</option>{review.participants.map(p => <option key={p.user_id} value={p.user_id}>{personName(p)} ({ROLE_LABEL[p.role]})</option>)}
          </select></Field>
          <Field label="Due"><input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        <Field label="Notes" help="Optional"><textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Add task</button></div>
      </form>
    </Modal>
  )
}

// ---------- people ----------

function People({ review, live, reload }: { review: Review; live: { user_id: number; active: boolean; page: number }[]; reload: () => void }) {
  const { user, users, reloadUsers } = useApp()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const owner = review.my_role === 'owner'
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); reload(); toast(msg) } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) } }
  return (
    <>
      <ul className="people-list">
        {review.participants.map(p => {
          const here = live.find(l => l.user_id === p.user_id)
          return (
            <li key={p.user_id}>
              <span className="pos-rel"><Avatar id={p.user_id} name={personName(p)} size="lg" />{here && <span className={`here-dot ${here.active ? '' : 'idle'}`} title={here.active ? `Here now, page ${here.page}` : 'Here, idle'} />}</span>
              <div className="grow">
                <div className="row wrap" style={{ gap: 6 }}><b>{personName(p)}</b>{p.user_id === user?.id && <span className="badge">you</span>}</div>
                <div className="muted small">{p.email}</div>
                <div className="small">
                  {p.verdict ? <span className={`badge v-${p.verdict}`}>{p.role === 'reviewer' ? REVIEWER_VERDICT_LABEL[p.verdict as Exclude<Verdict, ''>] : VERDICT_LABEL[p.verdict as Exclude<Verdict, ''>]}</span>
                    : p.role !== 'owner' && p.role !== 'observer' && <span className="badge">{p.state === 'invited' ? 'Not opened yet' : 'Reviewing'}</span>}
                  <span className="muted"> · {fmtDuration(p.active_seconds)} · {p.last_seen_at ? `seen ${ago(p.last_seen_at)}` : 'never opened'}</span>
                </div>
                {p.verdict_note && <div className="small quote-inline">“{p.verdict_note}”</div>}
              </div>
              {owner && p.role !== 'owner' ? (
                <select value={p.role} disabled={busy} onChange={e => {
                  const role = e.target.value as Role
                  if (role === 'owner' && !window.confirm(`Hand the review over to ${personName(p)}? You stay on as a reviewer.`)) return
                  run(() => api.put(`${V1}/reviews/${review.id}/participants/${p.user_id}`, { role }), 'Role changed')
                }} style={{ width: 'auto' }} title={ROLE_HELP[p.role]}>
                  <option value="approver">Approver</option><option value="reviewer">Reviewer</option><option value="observer">Observer</option><option value="owner">Make owner…</option>
                </select>
              ) : <RoleBadge role={p.role} />}
              {owner && p.role !== 'owner' && <button className="btn ghost sm danger-text" disabled={busy} onClick={() => window.confirm(`Take ${personName(p)} off this review?`) && run(() => api.del(`${V1}/reviews/${review.id}/participants/${p.user_id}`), 'Removed')} title="Remove">✕</button>}
            </li>
          )
        })}
      </ul>
      {owner && <div className="mt"><PersonPicker users={users} exclude={review.participants.map(p => p.user_id)} busy={busy}
        onAdd={inv => run(async () => { await api.post(`${V1}/reviews/${review.id}/participants`, inv); if (inv.email) await reloadUsers() }, 'Added')} /></div>}
      {review.my_role !== 'owner' && <button className="btn ghost sm danger-text mt" onClick={() => window.confirm('Leave this review? You will not see it any more.') && api.del(`${V1}/reviews/${review.id}/participants/${user!.id}`).then(() => navigate('/reviews'))}>Leave this review</button>}
      <p className="muted small mt">{review.require_resolved ? 'Approval needs every issue resolved or rejected.' : 'Approval is allowed with issues still open.'} {review.participants.some(p => p.role === 'approver') ? 'Every approver must approve.' : 'There is no approver: the owner completes the review.'}</p>
    </>
  )
}

// ---------- log ----------

const KIND_GROUPS = [['', 'Everything'], ['comment', 'Comments'], ['issue', 'Issues'], ['task', 'Tasks'], ['verdict', 'Verdicts'], ['review', 'Review'], ['participant', 'People'], ['revision', 'Revisions'], ['session', 'Sessions']]

function Log({ rid, tick, review, onOpenThread }: { rid: number; tick: number; review: Review; onOpenThread: (cid: number) => void }) {
  const [kind, setKind] = useState('')
  const [who, setWho] = useState(0)
  const [events, setEvents] = useState<Event[] | null>(null)
  useEffect(() => { api.get<Event[]>(`${V1}/reviews/${rid}/events?kind=${kind}&user=${who}&limit=500`).then(setEvents).catch(() => {}) }, [rid, kind, who, tick])
  return (
    <>
      <div className="thread-filters">
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">{KIND_GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={who} onChange={e => setWho(Number(e.target.value))} aria-label="Who"><option value={0}>Everyone</option>{review.participants.map(p => <option key={p.user_id} value={p.user_id}>{personName(p)}</option>)}</select>
        <a className="btn ghost sm" href={`${V1}/reviews/${rid}/events.csv`} title="Download the whole log">CSV</a>
      </div>
      {!events ? <Loading /> : events.length === 0 ? <p className="muted small">Nothing yet.</p> : (
        <ol className="log-list">
          {events.map(e => (
            <li key={e.id} className={`ev ev-${e.kind.split('.')[0]}`}>
              <Avatar id={e.user_id} name={e.user_name || '?'} size="sm" />
              <div className="grow">
                <div className="small"><b>{e.user_name || 'Someone'}</b> <span className="muted" title={fmtDateTime(e.created_at)}>{ago(e.created_at)}</span></div>
                <div className="small">{e.comment_id ? <button className="linklike" onClick={() => onOpenThread(e.comment_id)}>{e.summary}</button> : e.summary}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

// ---------- modals ----------

function VerdictModal({ review, me, decider, onClose, onDone }: { review: Review; me: Participant; decider: boolean; onClose: () => void; onDone: (r: Review) => void }) {
  const { toast } = useToast()
  const ownerCompletes = review.my_role === 'owner' // no approver on the review: the owner decides
  const [v, setV] = useState<Verdict>(me.verdict || 'approved')
  const [note, setNote] = useState(me.verdict_note || '')
  const [busy, setBusy] = useState(false)
  const blocked = decider && v === 'approved' && review.require_resolved && review.open_issues > 0
  const reviewers = review.participants.filter(p => p.role === 'reviewer')
  const pending = reviewers.filter(p => p.state !== 'done')
  const save = async (verdict: Verdict) => {
    setBusy(true)
    try {
      const r = await api.post<Review>(`${V1}/reviews/${review.id}/verdict`, { verdict, note })
      toast('Saved'); onDone(r)
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  const labels = decider ? VERDICT_LABEL : REVIEWER_VERDICT_LABEL
  return (
    <Modal title={decider ? (ownerCompletes ? 'Complete the review' : 'Your decision') : 'Finish your review'} onClose={onClose}>
      <div className="grid" style={{ gap: 14 }}>
        {decider && pending.length > 0 && <div className="callout">{plural(pending.length, 'reviewer')} {pending.length === 1 ? 'has' : 'have'} not finished yet: {pending.map(p => personName(p)).join(', ')}.</div>}
        <Segmented value={v} onChange={setV} options={(['approved', 'changes', 'rejected'] as const).map(x => ({ value: x, label: labels[x] }))} />
        {blocked && <div className="callout danger">{plural(review.open_issues, 'issue')} still open. This review only approves once every issue is resolved or rejected.</div>}
        <Field label="Note" help={decider ? 'Shown in the log and the report.' : 'Optional — what the owner should know.'}><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></Field>
        <div className="form-actions">
          {me.verdict && <button className="btn ghost" onClick={() => save('')} disabled={busy}>Withdraw</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${v === 'rejected' ? 'danger' : 'primary'}`} disabled={busy || blocked} onClick={() => save(v)}>{labels[v as Exclude<Verdict, ''>]}</button>
        </div>
        {decider && <p className="muted small">{v === 'approved' ? (review.participants.filter(p => p.role === 'approver').length > 1 ? 'The review is approved once every approver approves.' : 'The review becomes approved.') : v === 'changes' ? 'The owner uploads a new revision; everyone looks again.' : 'The review ends as rejected.'}</p>}
      </div>
    </Modal>
  )
}

function UploadModal({ review, onClose, onDone }: { review: Review; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [pages, setPages] = useState(0)
  const [note, setNote] = useState('')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const next = review.revisions.length + 1
  const pick = async (f?: File) => { if (!f) return; setFile(f); try { setPages(await countPages(f)) } catch { setPages(0) } }
  const save = async () => {
    if (!file) return
    setBusy(true)
    try { await upload<Revision>(`${V1}/reviews/${review.id}/revisions`, { file, page_count: String(pages), note }, setProgress); toast(`v${next} uploaded`); onDone() } catch (e) { toast((e as Error).message, 'err'); setBusy(false) }
  }
  return (
    <Modal title={next === 1 ? 'Upload the document' : `Upload v${next}`} onClose={onClose}>
      <div className="grid" style={{ gap: 12 }}>
        <input type="file" accept="application/pdf,.pdf" onChange={e => pick(e.target.files?.[0])} />
        {file && <span className="muted small">{fmtBytes(file.size)}{pages > 0 && ` · ${plural(pages, 'page')}`}</span>}
        {next > 1 && <Field label="What changed?" help="Shown in the log."><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Net 45, new liability cap" /></Field>}
        {next > 1 && <p className="muted small">Open threads carry over to the new revision. Everyone's verdict is cleared so they look again{review.status === 'changes_requested' ? ', and the review goes back in review' : ''}.</p>}
        {busy && <div className="bar lg"><span className="fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        <div className="form-actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!file || busy} onClick={save}>{busy ? `Uploading… ${Math.round(progress * 100)}%` : 'Upload'}</button></div>
      </div>
    </Modal>
  )
}

function EditModal({ review, onClose, onDone, onDelete }: { review: Review; onClose: () => void; onDone: () => void; onDelete: () => void }) {
  const { toast } = useToast()
  const [f, setF] = useState({ title: review.title, description: review.description, due_date: review.due_date, require_resolved: review.require_resolved })
  const save = async (e: React.FormEvent) => { e.preventDefault(); try { await api.put(`${V1}/reviews/${review.id}`, f); toast('Saved'); onDone() } catch (e) { toast((e as Error).message, 'err') } }
  return (
    <Modal title="Review details" onClose={onClose}>
      <form onSubmit={save} className="grid" style={{ gap: 12 }}>
        <Field label="Title"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required maxLength={200} /></Field>
        <Field label="Description"><textarea rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Due date"><input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
        <label className="row small"><input type="checkbox" checked={f.require_resolved} onChange={e => setF({ ...f, require_resolved: e.target.checked })} style={{ width: 'auto' }} /> Approve only when every issue is resolved or rejected</label>
        <div className="form-actions"><button type="button" className="btn ghost danger-text" onClick={onDelete}>Delete review…</button><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  )
}
