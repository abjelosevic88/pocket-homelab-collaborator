// Left column: new review, sections, the open reviews, settings — the Pocket Calendar sidebar.
import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../lib/app-context'
import type { Dashboard, Review } from '../lib/types'
import { STATUS_LABEL } from '../lib/format'
import { Icon } from './icons'
import { type Anchor, type MenuItem, Menu, rectOf } from './ui'

const MAX = 12

export function Sidebar({ reviews, dash, onNavigate, onNew }: { reviews: Review[]; dash: Dashboard | null; onNavigate: () => void; onNew: () => void }) {
  const { status, settings } = useApp()
  const title = settings?.title || status?.title || 'Pocket Collaborator'
  const waiting = (dash?.to_review || 0) + (dash?.to_approve || 0)
  const nav = [
    { to: '/home', label: 'Home', icon: 'home', badge: 0, tip: '' },
    { to: '/reviews', label: 'Reviews', icon: 'review', badge: waiting, tip: `${dash?.to_review || 0} to review, ${dash?.to_approve || 0} to decide` },
    { to: '/tasks', label: 'Tasks', icon: 'check-square', badge: dash?.open_tasks || 0, tip: 'open tasks for you' },
  ]
  // live ones first, then the API's order (most recent activity)
  const list = [...reviews].sort((a, b) => Number(!!b.live_now?.length) - Number(!!a.live_now?.length))
  return (
    <aside className="sidebar" aria-label="Collaborator">
      <div className="sb-brand">
        <img src="/favicon.svg" alt="" className="sb-logo" />
        <span className="sb-title">{title !== 'Pocket Collaborator' ? title : <>Pocket <b>Collaborator</b></>}</span>
        {status?.version && <span className="sb-version" title={`Version ${status.version}`}>{/^\d/.test(status.version) ? 'v' + status.version : status.version}</span>}
      </div>
      <button type="button" className="btn primary create-btn" onClick={onNew} title="New review (n)">
        <Icon name="plus" size={17} strokeWidth={2.2} />New review<kbd className="kbd-on-primary">N</kbd>
      </button>

      <nav className="sb-nav" aria-label="Sections">
        {nav.map(n => (
          <NavLink key={n.to} to={n.to} end onClick={onNavigate} className={({ isActive }) => `sb-nav-item ${isActive ? 'active' : ''}`}>
            <Icon name={n.icon} size={16} />{n.label}{n.badge > 0 && <span className="badge accent" title={n.tip}>{n.badge}</span>}
          </NavLink>
        ))}
      </nav>

      <ReviewGroup title="Open reviews" list={list} onNavigate={onNavigate} onNew={onNew} />

      <div className="sb-foot">
        <Link to="/settings" className="sb-foot-link" onClick={onNavigate}><Icon name="settings" size={15} />Settings</Link>
        <button type="button" className="sb-foot-link" onClick={() => { onNavigate(); window.dispatchEvent(new CustomEvent('pcl:shortcuts')) }}><Icon name="keyboard" size={15} />Shortcuts</button>
      </div>
    </aside>
  )
}

function ReviewGroup({ title, list, onNavigate, onNew }: { title: string; list: Review[]; onNavigate: () => void; onNew: () => void }) {
  const [open, setOpen] = useState(true)
  const shown = list.slice(0, MAX)
  return (
    <section className="sb-sec">
      <h4 className="sb-h">
        <button type="button" className="sb-h-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />{title}</button>
        <button type="button" className="btn ghost icon-only xs" aria-label="New review" title="New review (n)" onClick={onNew}><Icon name="plus" size={14} /></button>
      </h4>
      {open && (list.length === 0
        ? <p className="sb-empty">Nothing under review. <button type="button" className="link-btn" onClick={onNew}>Start one</button></p>
        : <>
          <ul className="cal-list">{shown.map(r => <ReviewRow key={r.id} r={r} onNavigate={onNavigate} />)}</ul>
          {list.length > MAX && <Link to="/reviews" className="sb-more" onClick={onNavigate}>All {list.length} open reviews…</Link>}
        </>)}
    </section>
  )
}

function ReviewRow({ r, onNavigate }: { r: Review; onNavigate: () => void }) {
  const navigate = useNavigate()
  const [menu, setMenu] = useState<Anchor | null>(null)
  const live = r.live_now?.length || 0
  const items: MenuItem[] = [
    { label: 'Open the document', icon: 'file', onSelect: () => { onNavigate(); navigate(`/reviews/${r.id}`) } },
    { label: 'Report', icon: 'chart', onSelect: () => { onNavigate(); navigate(`/reviews/${r.id}/report`) } },
    ...(r.source_url ? ['sep' as const, { label: 'Open the original', icon: 'external', onSelect: () => window.open(r.source_url, '_blank', 'noopener') }] : []),
  ]
  const tip = [r.title, STATUS_LABEL[r.status], live ? `${live} here now` : '', r.open_issues ? `${r.open_issues} open issues` : ''].filter(Boolean).join(' · ')
  return (
    <li className="cal-row rv-row">
      <NavLink to={`/reviews/${r.id}`} onClick={onNavigate} className={({ isActive }) => `cal-check ${isActive ? 'is-active' : ''}`} title={tip}>
        <span className={`rv-dot st-${r.status}`}><Icon name="file" size={13} />{live > 0 && <span className="live-dot" />}</span>
        <span className="cal-name ellipsis">{r.title}</span>
        <span className="rv-meta">
          {r.open_issues > 0 ? <span className="badge warn" title="Open issues">{r.open_issues}</span>
            : r.open_threads > 0 ? <span className="badge" title="Open threads">{r.open_threads}</span> : null}
        </span>
      </NavLink>
      <button type="button" className="btn ghost icon-only xs cal-more" aria-label={`Options for ${r.title}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={e => setMenu(rectOf(e.currentTarget))}><Icon name="more" size={15} /></button>
      {menu && <Menu anchor={menu} items={items} onClose={() => setMenu(null)} width={210} />}
    </li>
  )
}
