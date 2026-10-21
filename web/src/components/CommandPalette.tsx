// ⌘K / "/" — jump to a review, its report, or a page, or run a command from the keyboard.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import type { Review } from '../lib/types'
import { STATUS_LABEL } from '../lib/format'
import { Icon } from './icons'
import { useDebounce } from './ui'

export interface PaletteCommand { id: string; label: string; icon: string; hint?: string; keywords?: string; run: () => void }

export function CommandPalette({ onClose, commands, reviews }: { onClose: () => void; commands: PaletteCommand[]; reviews: Review[] }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  // finished reviews are not in the sidebar list: ask the server once something is typed
  const dq = useDebounce(q.trim(), 200)
  const [found, setFound] = useState<Review[]>([])
  useEffect(() => {
    if (!dq) { setFound([]); return }
    let live = true
    api.get<Review[]>(`${V1}/reviews?status=&role=&q=${encodeURIComponent(dq)}`).then(r => { if (live) setFound(r || []) }).catch(() => {})
    return () => { live = false }
  }, [dq])

  type Row = { key: string; group: string; icon: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode; hint?: string; run: () => void }
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const n = q.trim().toLowerCase()
    const words = n.split(/\s+/).filter(Boolean)
    const hit = (text: string) => words.every(w => text.toLowerCase().includes(w))
    const seen = new Set<number>()
    for (const r of [...reviews, ...found]) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      const text = `${r.title} ${r.source_label || ''}`
      const sub = [STATUS_LABEL[r.status], r.open_issues ? `${r.open_issues} open issues` : '', r.live_now?.length ? `${r.live_now.length} here now` : ''].filter(Boolean).join(' · ')
      if (n && !hit(text)) {
        // "budget report" → the report of the Budget review
        if (hit(`${text} report`) && words.some(w => 'report'.startsWith(w) && w.length > 2))
          out.push({ key: `r${r.id}-report`, group: 'Reviews', icon: <Icon name="chart" size={16} />, label: `${r.title} — Report`, run: () => navigate(`/reviews/${r.id}/report`) })
        continue
      }
      out.push({ key: `r${r.id}`, group: 'Reviews', icon: <Icon name="file" size={16} />, label: r.title, sub, run: () => navigate(`/reviews/${r.id}`) })
      if (out.filter(x => x.group === 'Reviews').length >= 12) break
    }
    for (const c of commands) {
      if (n && !hit(`${c.label} ${c.keywords || ''}`)) continue
      out.push({ key: c.id, group: 'Commands', icon: <Icon name={c.icon} size={16} />, label: c.label, hint: c.hint, run: c.run })
    }
    return out
  }, [q, reviews, found, commands, navigate])
  useEffect(() => setHi(0), [q])
  useEffect(() => { list.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hi])

  const run = (r: Row | undefined) => { if (!r) return; onClose(); r.run() }
  let last = ''
  return createPortal(
    <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette-box" role="dialog" aria-label="Search and commands">
        <div className="pal-input">
          <Icon name="search" size={18} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Jump to a review, its report, or run a command…" aria-label="Search"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(rows.length - 1, h + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(rows[hi]) }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
            }} />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list} role="listbox">
          {rows.length === 0 && <div className="pal-empty">Nothing matches.</div>}
          {rows.map((r, i) => {
            const head = r.group !== last ? <div className="pal-group" key={'g' + r.group}>{r.group}</div> : null
            last = r.group
            return (
              <React.Fragment key={r.key}>
                {head}
                <div data-i={i} role="option" aria-selected={i === hi} className={`pal-row ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => run(r)}>
                  <span className="pal-ico">{r.icon}</span>
                  <span className="grow"><span className="pal-label">{r.label}</span>{r.sub && <span className="pal-sub">{r.sub}</span>}</span>
                  {r.hint && <kbd>{r.hint}</kbd>}
                  {i === hi && <Icon name="chevron-right" size={14} className="muted" />}
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>, document.body)
}
