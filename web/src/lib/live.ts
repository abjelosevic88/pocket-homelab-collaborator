import { useCallback, useEffect, useRef, useState } from 'react'
import type { Presence } from './types'

export interface RemoteCursor { conn: string; user_id: number; name: string; color: string; page: number; x: number; y: number; at: number }

interface Options {
  onChanged?: (what: string[], by: number) => void
  onBye?: () => void
}

const STATE_EVERY = 5000

/**
 * The live channel of one open document: presence, cursors, change notices,
 * and the activity signal the server measures review time from. The browser
 * only reports facts (which page is in view, whether the tab is visible,
 * whether there was input since the last report); the server keeps the clock.
 */
export function useLive(reviewId: number, revisionId: number, opts: Options) {
  const [people, setPeople] = useState<Presence[]>([])
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({})
  const [me, setMe] = useState<{ conn: string; color: string } | null>(null)
  const [connected, setConnected] = useState(false)
  const ws = useRef<WebSocket | null>(null)
  const page = useRef(1)
  const input = useRef(true)
  const lastCursor = useRef(0)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const send = useCallback((m: object) => {
    const s = ws.current
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(m))
  }, [])
  const sendState = useCallback(() => {
    send({ t: 'state', page: page.current, visible: document.visibilityState === 'visible', input: input.current })
    input.current = false
  }, [send])

  useEffect(() => {
    if (!reviewId || !revisionId) return
    let stopped = false
    let retry = 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const s = new WebSocket(`${proto}//${location.host}/api/v1/reviews/${reviewId}/live?revision=${revisionId}&page=${page.current}`)
      ws.current = s
      s.onopen = () => { setConnected(true); retry = 1000; input.current = true; sendState() }
      s.onmessage = ev => {
        let m: Record<string, unknown>
        try { m = JSON.parse(ev.data) } catch { return }
        switch (m.t) {
          case 'hello': setMe({ conn: m.conn as string, color: m.color as string }); break
          case 'presence': setPeople(m.people as Presence[]); break
          case 'cursor': {
            const c = m as unknown as RemoteCursor
            setCursors(cur => {
              const next = { ...cur }
              if (!c.page) delete next[c.conn]
              else next[c.conn] = { ...c, at: Date.now() }
              return next
            })
            break
          }
          case 'changed': optsRef.current.onChanged?.(m.what as string[], m.by as number); break
          case 'bye': stopped = true; optsRef.current.onBye?.(); break
        }
      }
      s.onclose = () => {
        setConnected(false)
        setPeople([])
        setCursors({})
        if (stopped) return
        timer = setTimeout(connect, retry)
        retry = Math.min(retry * 2, 30000)
      }
    }
    connect()

    // anything the person does counts as "still reviewing"
    const mark = () => { input.current = true }
    const evs = ['mousemove', 'keydown', 'wheel', 'touchstart', 'pointerdown', 'scroll']
    evs.forEach(e => window.addEventListener(e, mark, { passive: true, capture: true }))
    const vis = () => { if (document.visibilityState === 'visible') input.current = true; sendState() }
    document.addEventListener('visibilitychange', vis)
    const iv = setInterval(sendState, STATE_EVERY)
    // cursors that stopped moving fade out
    const sweep = setInterval(() => setCursors(cur => {
      const now = Date.now()
      const stale = Object.values(cur).filter(c => now - c.at > 30000)
      if (!stale.length) return cur
      const next = { ...cur }
      stale.forEach(c => delete next[c.conn])
      return next
    }), 5000)

    return () => {
      stopped = true
      clearTimeout(timer)
      clearInterval(iv)
      clearInterval(sweep)
      evs.forEach(e => window.removeEventListener(e, mark, { capture: true }))
      document.removeEventListener('visibilitychange', vis)
      ws.current?.close()
      ws.current = null
    }
  }, [reviewId, revisionId, sendState])

  const setPage = useCallback((p: number) => {
    if (p === page.current) return
    page.current = p
    input.current = true
    sendState()
  }, [sendState])

  const sendCursor = useCallback((p: number, x: number, y: number) => {
    const now = Date.now()
    if (p !== 0 && now - lastCursor.current < 40) return
    lastCursor.current = now
    send({ t: 'cursor', page: p, x, y })
  }, [send])

  return { people, cursors, me, connected, setPage, sendCursor }
}
