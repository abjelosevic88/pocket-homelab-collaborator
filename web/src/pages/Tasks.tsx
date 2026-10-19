import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import type { Task } from '../lib/types'
import { ago, fmtDate } from '../lib/format'
import { Empty, Loading, PageHeader, Segmented, useAsync, useToast } from '../components/ui'

export default function Tasks() {
  const { toast } = useToast()
  const [which, setWhich] = useState<'open' | 'all'>('open')
  const { data, loading, reload } = useAsync(() => api.get<Task[]>(`${V1}/tasks${which === 'all' ? '?all=1' : ''}`), [which])
  const toggle = async (t: Task) => {
    try { await api.put(`${V1}/reviews/${t.review_id}/tasks/${t.id}`, { status: t.status === 'done' ? 'open' : 'done' }); reload() } catch (e) { toast((e as Error).message, 'err') }
  }
  const groups = new Map<number, Task[]>()
  for (const t of data || []) groups.set(t.review_id, [...(groups.get(t.review_id) || []), t])
  const today = new Date().toISOString().slice(0, 10)
  return (
    <>
      <PageHeader title="Your tasks" sub="Everything assigned to you across your reviews, plus unassigned tasks you created." actions={<Segmented value={which} onChange={setWhich} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />} />
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty title={which === 'open' ? 'No open tasks' : 'No tasks'}>Tasks come out of reviews: anyone on a review can turn a thread into a task and give it to someone.</Empty></div> : (
        [...groups.entries()].map(([rid, ts]) => (
          <div key={rid} className="card mb">
            <div className="card-head"><h2><Link to={`/reviews/${rid}`}>{ts[0].review_title}</Link></h2></div>
            <ul className="task-list pad-x">
              {ts.map(t => (
                <li key={t.id} className={t.status}>
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} style={{ width: 'auto' }} aria-label="Done" />
                  <div className="grow">
                    <div className="t-title">{t.title}</div>
                    <div className="muted small">
                      {t.due_date && <span className={t.status === 'open' && t.due_date < today ? 'bad' : ''}>due {fmtDate(t.due_date)} · </span>}
                      added {ago(t.created_at)}{t.comment_id > 0 && ` · from #${t.comment_id}`}{t.status === 'done' && t.done_at && ` · done ${ago(t.done_at)}`}
                    </div>
                    {t.notes && <div className="small">{t.notes}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </>
  )
}
