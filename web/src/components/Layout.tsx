import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import { Avatar } from './people'

const nav = [
  { to: '/home', label: 'Home', ico: '◉' },
  { to: '/reviews', label: 'Reviews', ico: '▤' },
  { to: '/tasks', label: 'Tasks', ico: '☑' },
  { to: '/settings', label: 'Settings', ico: '⚙' },
]

export default function Layout() {
  const { user, settings, status, theme, toggleTheme, setUser } = useApp()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const loc = useLocation()
  const logout = async () => { await api.post(`${V1}/auth/logout`); setUser(null); navigate('/login') }
  const title = settings?.title || 'Pocket Collaborator'
  // the document view uses the whole width
  const wide = /^\/reviews\/\d+\/?$/.test(loc.pathname)
  return (
    <div className={`app ${wide ? 'wide' : ''}`}>
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand"><span className="logo"><img src="/favicon.svg" alt="" /></span><span className="brand-name">{title}</span></div>
        <nav>
          {nav.map(n => <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}><span className="ico">{n.ico}</span>{n.label}</NavLink>)}
        </nav>
        <div className="foot">
          <span className="foot-user" title={user?.email}>
            {user && <Avatar id={user.id} name={user.name || user.email} />}
            <span className="foot-id">
              <span className="foot-name">{user?.name || user?.email}</span>
              {status?.version && <a className="ver" href="https://github.com/abjelosevic88/pocket-homelab-collaborator/releases" target="_blank" rel="noreferrer" title="Version — click for release notes">v{status.version.replace(/^v/, '')}</a>}
            </span>
          </span>
          <span className="foot-actions">
            <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle theme">{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</button>
            {status?.auth_mode === 'local' && <button className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out"><SignOutIcon /></button>}
          </span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-btn" onClick={() => setOpen(o => !o)} aria-label="Menu">☰</button>
          <span className="topbar-title">{title}</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle theme">{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</button>
        </header>
        <main className="content"><Outlet /></main>
        <nav className="tabbar">
          {nav.map(n => <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}><span className="ico">{n.ico}</span><span>{n.label}</span></NavLink>)}
        </nav>
      </div>
    </div>
  )
}

const ico = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
function MoonIcon() { return <svg {...ico}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg> }
function SunIcon() { return <svg {...ico}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg> }
function SignOutIcon() { return <svg {...ico}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h10" /></svg> }
