import { Link } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import type { Dashboard } from '../lib/types'
import { ago, fmtDate } from '../lib/format'
import { Card, Empty, Loading, PageHeader, useAsync } from '../components/ui'
import { Avatar, LiveStack } from '../components/people'
import { ReviewRow } from './Reviews'

const WHY: Record<string, string> = { review: 'Your review', approve: 'Your decision', changes: 'Changes requested', draft: 'Draft — start it' }

export default function Home() {
  const { user } = useApp()
  const { data, loading } = useAsync(() => api.get<Dashboard>(`${V1}/dashboard`), [])
  if (loading && !data) return <Loading />
  if (!data) return null
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <>
      <PageHeader title={`${hello}, ${(user?.name || user?.email || '').split(' ')[0]}`} sub="What is waiting for you across your reviews."
        actions={<Link className="btn primary" to="/reviews?new=1">+ New review</Link>} />
      <div className="stats">
        <Link to="/reviews?role=reviewer" className="stat"><div className="n">{data.to_review}</div><div className="l">to review</div></Link>
        <Link to="/reviews?role=approver" className="stat"><div className="n">{data.to_approve}</div><div className="l">to decide</div></Link>
        <Link to="/tasks" className="stat"><div className="n">{data.open_tasks}</div><div className="l">open tasks for you</div></Link>
        <div className="stat" title="Measured while documents are open, visible and in use"><div className="n">{data.week_text}</div><div className="l">your review time, last 7 days</div></div>
      </div>

      {data.live.length > 0 && (
        <Card title="Happening now" className="mb">
          <ul className="mini-list">
            {data.live.map(l => (
              <li key={l.review_id}><span className="live-pulse" /><Link to={`/reviews/${l.review_id}`} className="grow"><b>{l.title}</b></Link><LiveStack people={l.people} max={5} /></li>
            ))}
          </ul>
        </Card>
      )}

      <div className="two-col">
        <div>
          <h2 className="section-h">Waiting for you</h2>
          {data.waiting.length === 0 ? <div className="card"><Empty title="Nothing waiting">You are all caught up.</Empty></div> :
            <div className="review-list">{data.waiting.map(w => <ReviewRow key={w.review.id} r={w.review} why={WHY[w.why]} />)}</div>}
          {data.tasks.length > 0 && <>
            <h2 className="section-h mt">Your tasks</h2>
            <div className="card"><ul className="mini-list pad-x">
              {data.tasks.slice(0, 8).map(t => (
                <li key={t.id}><span className="muted">☐</span><Link to={`/reviews/${t.review_id}`} className="grow"><b>{t.title}</b><span className="muted small block">{t.review_title}</span></Link>
                  {t.due_date && <span className={`small ${t.due_date < new Date().toISOString().slice(0, 10) ? 'bad' : 'muted'}`}>{fmtDate(t.due_date)}</span>}</li>
              ))}
            </ul></div>
          </>}
        </div>
        <div>
          <h2 className="section-h">Recent activity</h2>
          <div className="card">
            {data.recent.length === 0 ? <Empty title="Quiet so far" /> : (
              <ol className="log-list pad-x">
                {data.recent.map(e => (
                  <li key={e.id}>
                    <Avatar id={e.user_id} name={e.user_name || '?'} size="sm" />
                    <div className="grow small"><b>{e.user_name || 'Someone'}</b> {e.summary}
                      <div className="muted"><Link to={`/reviews/${e.review_id}`}>{e.review_title}</Link> · {ago(e.created_at)}</div></div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
