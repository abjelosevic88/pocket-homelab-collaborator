import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import type { Report } from '../lib/types'
import { fmtDateTime, fmtDuration, plural, REVIEWER_VERDICT_LABEL, ROLE_LABEL, SEVERITY_LABEL, VERDICT_LABEL } from '../lib/format'
import { Card, Empty, Loading, PageHeader, Segmented, useAsync } from '../components/ui'
import { Avatar } from '../components/people'
import { RoleBadge, SeverityBadge, StatusBadge } from '../components/review-bits'
import { Icon } from '../components/icons'
import { useCrumb } from '../components/Layout'

/** Seconds → a step of the sequential ramp (0 = nothing, 1..9 = light → dark), square-root scaled so short visits still show. */
function step(sec: number, max: number): number {
  if (sec <= 0 || max <= 0) return 0
  return Math.max(1, Math.min(9, Math.ceil(Math.sqrt(sec / max) * 9)))
}

const pct = (f: number) => `${Math.round(f * 100)}%`

export default function ReportPage() {
  const { id } = useParams()
  const [rev, setRev] = useState(0)
  const { data: r, loading, error } = useAsync(() => api.get<Report>(`${V1}/reviews/${id}/report${rev ? `?revision=${rev}` : ''}`), [id, rev])
  useCrumb(r?.review.title)
  if (error) return <div className="callout danger"><Icon name="alert" size={15} /><span>{error}</span></div>
  if (loading && !r) return <Loading />
  if (!r) return null
  const t = r.totals
  const verdictText = (role: string, v: string) => !v ? '—' : role === 'reviewer' ? REVIEWER_VERDICT_LABEL[v as keyof typeof REVIEWER_VERDICT_LABEL] : VERDICT_LABEL[v as keyof typeof VERDICT_LABEL]
  return (
    <div className="report">
      <PageHeader
        title={<span className="row wrap" style={{ gap: 8 }}>{r.review.title} <StatusBadge status={r.review.status} /></span>}
        sub={<>Review report · owner {r.review.owner} · started {r.review.started_at ? fmtDateTime(r.review.started_at) : 'not yet'}{r.review.decided_at && ` · decided ${fmtDateTime(r.review.decided_at)}`} · generated {fmtDateTime(r.generated_at)}</>}
        actions={<>
          <Link className="btn" to={`/reviews/${id}`}><Icon name="arrow-left" size={15} />Document</Link>
          <a className="btn" href={`${V1}/reviews/${id}/comments.csv`}><Icon name="download" size={15} />Comments CSV</a>
          <a className="btn" href={`${V1}/reviews/${id}/events.csv`}><Icon name="download" size={15} />Log CSV</a>
          <a className="btn primary" href={`${V1}/reviews/${id}/report.pdf${rev ? `?revision=${rev}` : ''}`}><Icon name="download" size={15} />Download PDF</a>
        </>} />

      <div className="stats">
        <Tile n={fmtDuration(t.active_seconds)} l="review time, everyone" title="Measured by the server while the document was open, visible and in use" />
        <Tile n={t.elapsed_seconds ? fmtDuration(t.elapsed_seconds) : '—'} l={r.review.decided_at ? 'start to decision' : 'since the start'} />
        <Tile n={`${t.open_issues} / ${t.issues}`} l="issues open / found" bad={t.open_issues > 0} />
        <Tile n={`${t.open_threads} / ${t.threads}`} l="threads open / total" />
        <Tile n={pct(t.avg_coverage)} l="average coverage" title="Share of pages each approver and reviewer had in front of them for at least 5 seconds" />
        <Tile n={t.pages_per_hour.toFixed(1)} l="pages per hour" title="Pages read per hour of review time — the inspection rate" />
        <Tile n={t.issues_per_page.toFixed(2)} l="issues per page" title="Defect density" />
        <Tile n={`${t.open_tasks} / ${t.tasks}`} l="tasks open / total" />
      </div>

      <div className="two-col">
        <Card title="Sign-off">
          {r.decision.length === 0 ? <p className="muted">No approver on this review: the owner completes it.</p> : (
            <ul className="mini-list">
              {r.decision.map((d, i) => (
                <li key={i}><Avatar id={i + 1} name={d.name} /><div className="grow"><b>{d.name}</b> <span className="muted small">{ROLE_LABEL[d.role]}</span>{d.note && <div className="small quote-inline">“{d.note}”</div>}</div>
                  <div className="right"><span className={`badge v-${d.verdict || 'none'}`}>{d.verdict ? VERDICT_LABEL[d.verdict] : 'Waiting'}</span><div className="muted small">{d.at && fmtDateTime(d.at)}</div></div></li>
              ))}
            </ul>
          )}
          <p className="muted small mt-sm">{r.review.require_resolved ? 'Approval needs every issue resolved or rejected.' : 'Approval is allowed with issues still open.'}</p>
        </Card>
        <Card title="Issues by severity">
          <SeverityBars rows={r.severity} />
        </Card>
      </div>

      <Card title="People" className="mt" flush>
        <div className="table-wrap">
          <table className="table report-people">
            <thead><tr><th>Person</th><th>Verdict</th><th className="right">Time</th><th className="right">Sessions</th><th style={{ minWidth: 160 }}>Coverage of v{r.revision.number}</th><th className="right">Issues</th><th className="right">Other threads</th><th className="right">Replies</th><th className="right">Closed</th><th className="right">Pace</th></tr></thead>
            <tbody>
              {r.people.map(p => (
                <tr key={p.user_id}>
                  <td><span className="row"><Avatar id={p.user_id} name={p.name} /><span><b>{p.name}</b><span className="block"><RoleBadge role={p.role} /></span></span></span></td>
                  <td>{verdictText(p.role, p.verdict)}{p.verdict_at && <div className="muted small">{fmtDateTime(p.verdict_at)}</div>}</td>
                  <td className="right num">{fmtDuration(p.active_seconds)}</td>
                  <td className="right num">{p.sessions}</td>
                  <td><div className="meter" title={`${p.pages_read} of ${t.pages} pages`}><span style={{ width: pct(p.coverage) }} /></div><span className="small muted">{pct(p.coverage)} · {p.pages_read}/{t.pages} pages</span></td>
                  <td className="right num" title={`${p.critical} critical, ${p.major} major, ${p.minor} minor`}>{p.issues}{p.issues > 0 && <span className="muted small"> ({p.critical}/{p.major}/{p.minor})</span>}</td>
                  <td className="right num">{p.threads - p.issues}</td>
                  <td className="right num">{p.replies}</td>
                  <td className="right num">{p.closed}</td>
                  <td className="right num small">{p.pages_read > 0 ? <>{fmtDuration(p.seconds_per_page)}/page</> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small pad" style={{ paddingTop: 8 }}>Time is measured by the server while the document is open in a visible tab and in use (input within the idle window). A page counts as read after 5 seconds in view. Issues in brackets: critical/major/minor.</p>
      </Card>

      <Card title="Where the time went" className="mt" actions={r.revisions.length > 1 && (
        <Segmented size="sm" value={rev || r.revision.id} onChange={setRev} options={r.revisions.map(v => ({ value: v.id, label: `v${v.number}` }))} />
      )}>
        <Heatmap r={r} />
      </Card>

      <Card title={`Sessions (${r.sessions.length})`} className="mt">
        <Sessions r={r} />
      </Card>

      <div className="two-col mt">
        <Card title={`Open issues (${r.open_issues.length})`}>
          {r.open_issues.length === 0 ? <p className="ok">Every issue is resolved or rejected.</p> : (
            <ul className="mini-list">
              {r.open_issues.map(i => (
                <li key={i.id}><SeverityBadge severity={i.severity} /><Link className="grow" to={`/reviews/${id}`}><span className="small muted">#{i.id} · v{i.revision} p.{i.page} · {i.author}</span><span className="block">{i.body}</span></Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Tasks (${t.open_tasks} open of ${t.tasks})`}>
          {r.tasks.length === 0 ? <p className="muted">No tasks.</p> : (
            <ul className="task-list">
              {r.tasks.map(tk => (
                <li key={tk.id} className={tk.status}><span className="task-box"><Icon name={tk.status === 'done' ? 'check-square' : 'square'} size={15} /></span><div className="grow"><div className="t-title">{tk.title}</div><div className="muted small">{tk.assignee_name || 'unassigned'}{tk.due_date && ` · due ${tk.due_date}`}{tk.done_at && ` · done ${fmtDateTime(tk.done_at)}`}</div></div></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`All threads (${t.threads} threads, ${t.comments} messages)`} className="mt">
        {r.threads.length === 0 ? <Empty title="No comments" /> : r.threads.map(th => (
          <div key={th.id} className={`rep-thread st-${th.status}`}>
            <div className="small"><b>#{th.id}</b> · {th.kind === 'issue' ? <SeverityBadge severity={th.severity} /> : <span className="badge">{th.kind}</span>} · v{th.revision} p.{th.page} · {th.author} · <span className="muted">{fmtDateTime(th.created_at)}</span> <span className={`badge st-${th.status}`}>{th.status}</span></div>
            {th.quote && <blockquote className="quote">{th.quote}</blockquote>}
            <div>{th.body}</div>
            {th.replies.map((rp, i) => <div key={i} className="rep-reply small"><b>{rp.author}</b> <span className="muted">{fmtDateTime(rp.created_at)}</span><div>{rp.body}</div></div>)}
            {th.status !== 'open' && <div className={`status-note st-${th.status} small`}>{th.status === 'resolved' ? 'Resolved' : 'Rejected'} by {th.status_by || 'someone'} {th.status_at && fmtDateTime(th.status_at)}{th.status_note && `: ${th.status_note}`}</div>}
          </div>
        ))}
      </Card>

      <Card title={`Activity log (${r.timeline.length})`} className="mt" flush>
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table className="table compact">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>{r.timeline.map(e => <tr key={e.id}><td className="nowrap muted small">{fmtDateTime(e.created_at)}</td><td className="nowrap">{e.user_name || '—'}</td><td><code className="small">{e.kind}</code></td><td className="small">{e.summary}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Tile({ n, l, title, bad }: { n: React.ReactNode; l: string; title?: string; bad?: boolean }) {
  return <div className="stat" title={title}><div className={`n ${bad ? 'bad' : ''}`}>{n}</div><div className="l">{l}</div></div>
}

// ---- issues by severity: one stacked bar per severity, open / resolved / rejected ----
const STATES = [{ k: 'open', l: 'Open', c: 'var(--series-1)' }, { k: 'resolved', l: 'Resolved', c: 'var(--series-3)' }, { k: 'rejected', l: 'Rejected', c: 'var(--series-2)' }] as const

function SeverityBars({ rows }: { rows: Report['severity'] }) {
  const max = Math.max(1, ...rows.map(r => r.open + r.resolved + r.rejected))
  const total = rows.reduce((s, r) => s + r.open + r.resolved + r.rejected, 0)
  if (total === 0) return <p className="muted">No issues raised.</p>
  return (
    <div className="viz">
      <div className="legend">{STATES.map(s => <span key={s.k}><i style={{ background: s.c }} />{s.l}</span>)}</div>
      <div className="sev-bars">
        {rows.map(r => {
          const sum = r.open + r.resolved + r.rejected
          return (
            <div key={r.severity} className="sev-row">
              <span className="l">{SEVERITY_LABEL[r.severity as 'minor']}</span>
              <span className="track">
                {STATES.map(s => {
                  const v = r[s.k]
                  return v > 0 ? <span key={s.k} className="seg" style={{ width: `${(v / max) * 100}%`, background: s.c }} title={`${SEVERITY_LABEL[r.severity as 'minor']}: ${v} ${s.l.toLowerCase()}`} /> : null
                })}
              </span>
              <span className="n">{sum}</span>
            </div>
          )
        })}
      </div>
      <table className="table compact mt-sm">
        <thead><tr><th>Severity</th>{STATES.map(s => <th key={s.k} className="right">{s.l}</th>)}<th className="right">Total</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.severity}><td>{SEVERITY_LABEL[r.severity as 'minor']}</td><td className="right num">{r.open}</td><td className="right num">{r.resolved}</td><td className="right num">{r.rejected}</td><td className="right num">{r.open + r.resolved + r.rejected}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

// ---- attention heatmap: people × pages ----
function Heatmap({ r }: { r: Report }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const h = r.heatmap
  if (!h.pages) return <p className="muted">The page count of this revision is not known yet — it is measured the first time someone opens it.</p>
  const pages = Array.from({ length: h.pages }, (_, i) => i + 1)
  const show = (e: React.MouseEvent, text: string) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTip({ x: box.left + box.width / 2, y: box.top, text })
  }
  return (
    <div className="viz">
      <div className="row wrap mb-sm">
        <span className="muted small grow">Seconds each person spent on each page of v{r.revision.number}; darker is longer. Red ticks under a page mark its issues. {r.totals.unread_pages.length > 0 ? <b className="bad">Nobody read {plural(r.totals.unread_pages.length, 'page')}: {r.totals.unread_pages.join(', ')}.</b> : 'Every page was read by someone.'}</span>
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
      </div>
      {view === 'chart' ? <>
        <div className="heat-scroll" onMouseLeave={() => setTip(null)}>
          <div className="heat" style={{ gridTemplateColumns: `minmax(110px, 160px) repeat(${h.pages}, minmax(18px, 1fr))` }}>
            <span />
            {pages.map(p => <span key={p} className="heat-x">{h.pages <= 30 || p % 5 === 0 || p === 1 ? p : ''}</span>)}
            {h.rows.map(row => (
              <React.Fragment key={row.user_id}>
                <span className="heat-y" title={ROLE_LABEL[row.role]}>{row.name}</span>
                {row.seconds.map((s, i) => (
                  <span key={i} className={`heat-cell s${step(s, h.max)}`} onMouseEnter={e => show(e, `${row.name} · page ${i + 1}: ${s ? fmtDuration(s) : 'not read'}`)} />
                ))}
              </React.Fragment>
            ))}
            <span className="heat-y muted">All</span>
            {h.page_totals.map((s, i) => <span key={i} className={`heat-cell s${step(s, Math.max(...h.page_totals))}`} onMouseEnter={e => show(e, `Page ${i + 1}: ${s ? fmtDuration(s) : 'nobody'} in total${h.page_issues[i] ? `, ${plural(h.page_issues[i], 'issue')}` : ''}`)} />)}
            <span />
            {h.page_issues.map((n, i) => <span key={i} className="heat-issue">{n > 0 && <i title={plural(n, 'issue')} style={{ height: Math.min(4 + n * 3, 14) }} />}</span>)}
          </div>
        </div>
        <div className="legend heat-legend"><span className="small muted">0</span><span className="ramp">{Array.from({ length: 9 }, (_, i) => <i key={i} className={`heat-cell s${i + 1}`} />)}</span><span className="small muted">{fmtDuration(h.max)} (longest)</span></div>
        {tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
      </> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Person</th>{pages.map(p => <th key={p} className="right">p.{p}</th>)}</tr></thead>
            <tbody>
              {h.rows.map(row => <tr key={row.user_id}><td className="nowrap">{row.name}</td>{row.seconds.map((s, i) => <td key={i} className="right num small">{s ? fmtDuration(s) : '—'}</td>)}</tr>)}
              <tr><td><b>All</b></td>{h.page_totals.map((s, i) => <td key={i} className="right num small"><b>{s ? fmtDuration(s) : '—'}</b></td>)}</tr>
              <tr><td>Issues</td>{h.page_issues.map((n, i) => <td key={i} className="right num small">{n || ''}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- sessions: one row per person along the review's time span ----
function Sessions({ r }: { r: Report }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  if (!r.sessions.length) return <p className="muted">Nobody has opened the document yet.</p>
  const t0 = Math.min(...r.sessions.map(s => +new Date(s.started_at)))
  const t1 = Math.max(...r.sessions.map(s => +new Date(s.last_at)))
  const span = Math.max(1, t1 - t0)
  const people = r.people.filter(p => r.sessions.some(s => s.user_id === p.user_id))
  return (
    <div className="viz" onMouseLeave={() => setTip(null)}>
      <div className="gantt">
        {people.map(p => (
          <div key={p.user_id} className="gantt-row">
            <span className="l">{p.name}</span>
            <span className="track">
              {r.sessions.filter(s => s.user_id === p.user_id).map((s, i) => {
                const a = (+new Date(s.started_at) - t0) / span, b = (+new Date(s.last_at) - t0) / span
                return <span key={i} className="seg" style={{ left: `${a * 100}%`, width: `max(4px, ${(b - a) * 100}%)` }}
                  onMouseEnter={e => { const bx = e.currentTarget.getBoundingClientRect(); setTip({ x: bx.left + bx.width / 2, y: bx.top, text: `${p.name} · v${s.revision} · ${fmtDateTime(s.started_at)} – ${fmtDateTime(s.last_at).split(' ').pop()} · ${fmtDuration(s.active_seconds)} active` }) }} />
              })}
            </span>
            <span className="n num">{fmtDuration(r.sessions.filter(s => s.user_id === p.user_id).reduce((x, s) => x + s.active_seconds, 0))}</span>
          </div>
        ))}
        <div className="gantt-row axis"><span /><span className="track"><span className="muted small">{fmtDateTime(new Date(t0).toISOString())}</span><span className="muted small">{fmtDateTime(new Date(t1).toISOString())}</span></span><span /></div>
      </div>
      {tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </div>
  )
}
