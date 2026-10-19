import type { Presence } from '../lib/types'
import { colorFor, initials } from '../lib/format'

/** A round avatar with initials, coloured by user id so a person looks the same everywhere. */
export function Avatar({ id, name, size = '', color, ring, title }: { id: number; name: string; size?: '' | 'sm' | 'lg'; color?: string; ring?: string; title?: string }) {
  return (
    <span className={`avatar ${size}`} style={{ background: color || colorFor(id), boxShadow: ring ? `0 0 0 2px var(--surface), 0 0 0 4px ${ring}` : undefined }} title={title ?? name}>
      {initials(name)}
    </span>
  )
}

/** Who has the document open right now: one avatar per person, ringed in their live colour, dimmed when idle. */
export function LiveStack({ people, max = 6, onPick, meConn }: { people: Presence[]; max?: number; onPick?: (p: Presence) => void; meConn?: string }) {
  // one entry per person: their most active tab
  const byUser = new Map<number, Presence>()
  for (const p of people) {
    const cur = byUser.get(p.user_id)
    if (!cur || (p.active && !cur.active)) byUser.set(p.user_id, p)
  }
  const list = [...byUser.values()]
  const shown = list.slice(0, max)
  return (
    <span className="live-stack">
      {shown.map(p => (
        <button key={p.conn} type="button" className={`live-person ${p.active ? '' : 'idle'}`} onClick={() => onPick?.(p)}
          title={`${p.name}${p.conn === meConn ? ' (you)' : ''} — on page ${p.page}${p.active ? '' : ' · idle'}`}
          aria-label={`${p.name}${p.conn === meConn ? ' (you)' : ''}, page ${p.page}${p.active ? '' : ', idle'}`}>
          <Avatar id={p.user_id} name={p.name} color={p.color} title="" />
          <span className="pg" aria-hidden>{p.page}</span>
        </button>
      ))}
      {list.length > max && <span className="avatar more">+{list.length - max}</span>}
    </span>
  )
}
