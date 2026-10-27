import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'

export interface PersonOption { id: number; name: string; count: number }

/** Whose threads are shown. "except" keeps showing people who start commenting later. */
export type PeopleSel = { mode: 'all' } | { mode: 'only'; ids: number[] } | { mode: 'except'; ids: number[] }

export const EVERYONE: PeopleSel = { mode: 'all' }

export function personShown(sel: PeopleSel, id: number) {
  return sel.mode === 'all' || (sel.mode === 'only' ? sel.ids.includes(id) : !sel.ids.includes(id))
}

export function parsePeopleSel(raw: string | null): PeopleSel {
  try {
    const v = JSON.parse(raw || '')
    if ((v?.mode === 'only' || v?.mode === 'except') && Array.isArray(v.ids)) return { mode: v.mode, ids: v.ids.filter((x: unknown) => typeof x === 'number') }
  } catch { /* fall through */ }
  return EVERYONE
}

interface Props {
  value: PeopleSel
  onChange: (sel: PeopleSel) => void
  people: PersonOption[]
  meId?: number
}

const Chevron = () => <svg className="sel-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>

/** Who started the threads that are shown: any combination of me and the others. */
export function PeopleFilter({ value, onChange, people, meId }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const toggle = (id: number) => {
    if (value.mode === 'all') return onChange({ mode: 'except', ids: [id] })
    const ids = value.ids.includes(id) ? value.ids.filter(x => x !== id) : [...value.ids, id]
    onChange(value.mode === 'except' && ids.length === 0 ? EVERYONE : { mode: value.mode, ids })
  }
  const is = (s: PeopleSel) => s.mode === value.mode && (s.mode === 'all' || (value.mode !== 'all' && s.ids.length === value.ids.length && s.ids.every(id => value.ids.includes(id))))

  const name = (id: number) => id === meId ? 'me' : people.find(p => p.id === id)?.name ?? 'someone'
  const names = (ids: number[]) => ids.length <= 2 ? ids.map(name).join(' and ') : `${ids.length} people`
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const label = value.mode === 'all' ? 'Everyone'
    : value.mode === 'only' ? (value.ids.length === 0 ? 'Nobody' : value.ids.length === 1 && value.ids[0] === meId ? 'Only me' : cap(names(value.ids)))
    : `Everyone but ${names(value.ids)}`
  const quick: [string, PeopleSel][] = [['Everyone', EVERYONE]]
  if (meId !== undefined) quick.push(['Only me', { mode: 'only', ids: [meId] }], ['Everyone but me', { mode: 'except', ids: [meId] }])

  return (
    <div ref={root} className={`sel people-filter ${open ? 'open' : ''}`} onKeyDown={e => { if (open && e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}>
      <button type="button" className={`sel-btn ${value.mode === 'all' ? '' : 'is-set'}`} onClick={() => setOpen(o => !o)} aria-haspopup="true" aria-expanded={open} aria-label="People" title="Show threads started by these people">
        <Icon name="users" size={13} /><span className="sel-val">{label}</span><Chevron />
      </button>
      {open && (
        <div className="sel-pop">
          <div className="sel-list">
            <div className="sel-group">Threads started by</div>
            {quick.map(([l, s]) => (
              <button key={l} type="button" className={`sel-opt action ${is(s) ? 'cur' : ''}`} onClick={() => onChange(s)}>
                <span className="sel-lbl">{l}</span>{is(s) && <span className="sel-check"><Icon name="check" size={14} /></span>}
              </button>
            ))}
            <div className="sel-group">People</div>
            {people.length === 0 && <div className="sel-empty muted">Nobody has commented yet</div>}
            {people.map(p => (
              <label key={p.id} className="sel-opt people-opt">
                <input type="checkbox" checked={personShown(value, p.id)} onChange={() => toggle(p.id)} />
                <span className="sel-lbl">{p.id === meId ? `Me (${p.name})` : p.name}</span>
                <span className="sel-hint muted">{p.count}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
