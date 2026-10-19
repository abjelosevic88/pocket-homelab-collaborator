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
          <span className="row" title={user?.email}>{user && <Avatar id={user.id} name={user.name || user.email} />}<span className="foot-id"><span>{user?.name || user?.email}</span>{status?.version && <a className="ver" href="https://github.com/abjelosevic88/pocket-homelab-collaborator/releases" target="_blank" rel="noreferrer" title="Version — click for release notes">v{status.version.replace(/^v/, '')}</a>}</span></span>
          <span className="row">
            <button className="btn ghost sm" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
            {status?.auth_mode === 'local' && <button className="btn ghost sm" onClick={logout} title="Sign out">⎋</button>}
          </span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-btn" onClick={() => setOpen(o => !o)} aria-label="Menu">☰</button>
          <span className="topbar-title">{title}</span>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
        </header>
        <main className="content"><Outlet /></main>
        <nav className="tabbar">
          {nav.map(n => <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}><span className="ico">{n.ico}</span><span>{n.label}</span></NavLink>)}
        </nav>
      </div>
    </div>
  )
}
