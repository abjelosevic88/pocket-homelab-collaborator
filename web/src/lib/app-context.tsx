import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, V1 } from './api'
import type { Settings, User } from './types'
import { setDateFormats } from './format'

interface AuthStatus { needs_setup: boolean; auth_mode: string; authenticated: boolean; user: User | null; version: string; title: string; oidc?: boolean; oidc_name?: string }

export type ThemeMode = 'system' | 'light' | 'dark'

interface AppState {
  status: AuthStatus | null
  user: User | null
  settings: Settings | null
  users: User[]
  themeMode: ThemeMode
  theme: 'light' | 'dark'
  setThemeMode: (m: ThemeMode) => void
  toggleTheme: () => void
  refresh: () => Promise<void>
  reloadUsers: () => Promise<void>
  setUser: (u: User | null) => void
  setSettings: (s: Settings) => void
}

const Ctx = createContext<AppState>(null!)
export function useApp() { return useContext(Ctx) }

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [users, setUsers] = useState<User[]>([])
  // the theme follows the system unless someone picks light or dark (the old key always pinned one)
  const [themeMode, setThemeModeRaw] = useState<ThemeMode>(() => (localStorage.getItem('pcl-theme-mode') as ThemeMode) || 'system')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = () => setSystemDark(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  const theme: 'light' | 'dark' = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', theme === 'dark' ? '#111113' : '#ffffff'))
  }, [theme])
  const setThemeMode = useCallback((m: ThemeMode) => {
    setThemeModeRaw(m)
    localStorage.removeItem('pcl-theme')
    if (m === 'system') localStorage.removeItem('pcl-theme-mode'); else localStorage.setItem('pcl-theme-mode', m)
  }, [])
  useEffect(() => { if (settings?.title) document.title = settings.title }, [settings?.title])
  useEffect(() => { if (settings) setDateFormats(settings.date_format || 'auto', settings.time_format || 'auto') }, [settings?.date_format, settings?.time_format]) // eslint-disable-line react-hooks/exhaustive-deps

  const reloadUsers = useCallback(async () => { setUsers(await api.get<User[]>(`${V1}/users`)) }, [])

  const refresh = useCallback(async () => {
    const st = await api.get<AuthStatus>(`${V1}/auth/status`)
    setStatus(st)
    setUser(st.user)
    if (st.authenticated) {
      setSettings(await api.get<Settings>(`${V1}/settings`))
      await reloadUsers()
    }
  }, [reloadUsers])

  useEffect(() => { refresh().catch(() => setStatus({ needs_setup: false, auth_mode: 'local', authenticated: false, user: null, version: '', title: 'Pocket Review' })) }, [refresh])
  useEffect(() => {
    const h = () => { setUser(null); setStatus(s => s ? { ...s, authenticated: false, user: null } : s) }
    window.addEventListener('pcl:unauthorized', h)
    return () => window.removeEventListener('pcl:unauthorized', h)
  }, [])

  return <Ctx.Provider value={{ status, user, settings, users, themeMode, theme, setThemeMode, toggleTheme: () => setThemeMode(theme === 'dark' ? 'light' : 'dark'), refresh, reloadUsers, setUser, setSettings }}>{children}</Ctx.Provider>
}
