import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { V1 } from '../lib/api'
import type { Revision } from '../lib/types'
import { fmtDate, plural } from '../lib/format'
import { DocDiff, diffWords, extractWords, joinBoxes, mapPos } from '../lib/diff'
import PdfViewer, { Mark, ScrollPos } from './PdfViewer'
import { Select } from './Select'
import { Segmented } from './ui'
import { Icon } from './icons'

type Follow = (ScrollPos & { nonce: number }) | null
type Jump = { page: number; y: number; nonce: number } | null

/**
 * Two revisions side by side: words taken out are red on the left, words put
 * in are green on the right. One zoom for both; scrolling one side scrolls the
 * other to the same text. On a phone the sides take turns.
 */
export default function Compare({ rid, revisions, currentId, leftId, rightId, onPick, onClose }: {
  rid: number; revisions: Revision[]; currentId: number; leftId: number; rightId: number
  onPick: (left: number, right: number) => void; onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const [docs, setDocs] = useState<[PDFDocumentProxy | null, PDFDocumentProxy | null]>([null, null])
  const [diff, setDiff] = useState<DocDiff | null>(null)
  const [state, setState] = useState<'loading' | 'diffing' | 'ready' | 'notext' | 'failed'>('loading')
  const [sync, setSync] = useState(() => localStorage.getItem('pcl-compare-sync') !== '0')
  const [follow, setFollow] = useState<[Follow, Follow]>([null, null])
  const [jump, setJump] = useState<[Jump, Jump]>([null, null])
  const [cur, setCur] = useState(-1)
  const [side, setSide] = useState<'left' | 'right'>('right')

  const onLeftDoc = useCallback((d: PDFDocumentProxy | null) => setDocs(x => [d, x[1]]), [])
  const onRightDoc = useCallback((d: PDFDocumentProxy | null) => setDocs(x => [x[0], d]), [])

  // diff once both documents are open
  useEffect(() => {
    setDiff(null); setCur(-1)
    const [a, b] = docs
    if (!a || !b) { setState('loading'); return }
    let dead = false
    setState('diffing')
    ;(async () => {
      try {
        const [l, r] = await Promise.all([extractWords(a, () => dead), extractWords(b, () => dead)])
        if (dead) return
        if (!l.length || !r.length) { setState('notext'); return }
        await new Promise(res => setTimeout(res, 0))
        const d = diffWords(l, r)
        if (!dead) { setDiff(d); setState('ready') }
      } catch { if (!dead) setState('failed') }
    })()
    return () => { dead = true }
  }, [docs])

  const marks = useMemo(() => {
    const left = new Map<number, Mark[]>(), right = new Map<number, Mark[]>()
    if (!diff) return { left, right }
    const put = (into: Map<number, Mark[]>, boxes: Map<number, import('../lib/types').Rect[]>, cls: string) =>
      boxes.forEach((rects, page) => into.set(page, [...(into.get(page) ?? []), { rects, cls }]))
    const c = diff.changes[cur]
    const sorted = (s: Set<number>, skip?: number[]) => { const out = [...s].filter(i => !skip?.includes(i)); return out.sort((x, y) => x - y) }
    put(left, joinBoxes(diff.left, sorted(diff.removed, c?.del)), 'del')
    put(right, joinBoxes(diff.right, sorted(diff.added, c?.ins)), 'ins')
    if (c) {
      put(left, joinBoxes(diff.left, c.del), 'del cur')
      put(right, joinBoxes(diff.right, c.ins), 'ins cur')
    }
    return { left, right }
  }, [diff, cur])

  // only the side being used leads; the other one's scrolling is the echo
  const active = useRef<0 | 1>(1)
  const last = useRef<[ScrollPos | null, ScrollPos | null]>([null, null])
  const moved = (from: 0 | 1) => (pos: ScrollPos) => {
    last.current[from] = pos
    if (!sync || from !== active.current) return
    const docY = diff ? mapPos(diff.anchors, pos.docY, from) : pos.docY
    const next = { docY, fx: pos.fx, nonce: Date.now() + Math.random() }
    setFollow(f => (from === 0 ? [f[0], next] : [next, f[1]]))
  }
  const toggleSync = () => { setSync(!sync); localStorage.setItem('pcl-compare-sync', sync ? '0' : '1') }

  const go = (i: number) => {
    if (!diff || !diff.changes.length) return
    const n = (i + diff.changes.length) % diff.changes.length
    setCur(n)
    const c = diff.changes[n]
    const at = (y: number): Jump => ({ page: Math.floor(y) + 1, y: y - Math.floor(y), nonce: Date.now() })
    const l = c.leftAt >= 0 ? c.leftAt : mapPos(diff.anchors, c.rightAt, 1)
    const r = c.rightAt >= 0 ? c.rightAt : mapPos(diff.anchors, c.leftAt, 0)
    // with sync on, move one side and let the other follow; otherwise move both
    if (!sync) { setJump([at(l), at(r)]); return }
    const lead: 0 | 1 = side === 'left' && c.leftAt >= 0 ? 0 : c.rightAt >= 0 ? 1 : 0
    active.current = lead
    setJump(lead === 0 ? [at(l), null] : [null, at(r)])
  }

  // on a phone one side shows at a time: the other one opens where this one was
  const pickSide = (to: 'left' | 'right') => {
    const from: 0 | 1 = side === 'left' ? 0 : 1
    setSide(to)
    active.current = to === 'left' ? 0 : 1
    const pos = last.current[from]
    if (to !== side && pos) setTimeout(() => {
      const docY = diff ? mapPos(diff.anchors, pos.docY, from) : pos.docY
      const next = { docY, fx: pos.fx, nonce: Date.now() }
      setFollow(f => (from === 0 ? [f[0], next] : [next, f[1]]))
    }, 80)
  }
  const lead = (n: 0 | 1) => ({ onPointerEnter: () => { active.current = n }, onTouchStart: () => { active.current = n }, onFocus: () => { active.current = n } })

  const rev = (id: number) => revisions.find(v => v.id === id)
  const options = [...revisions].reverse().map(v => ({ value: String(v.id), label: `v${v.number}${v.id === currentId ? ' (current)' : ''}`, hint: `${fmtDate(v.created_at.slice(0, 10))} · ${v.filename}` }))
  const words = (s: Set<number> | undefined) => s?.size ?? 0
  const lv = rev(leftId), rv = rev(rightId)

  return (
    <div className="compare">
      <div className="compare-bar">
        <Segmented size="sm" className="compare-side" value={side} onChange={pickSide}
          options={[{ value: 'left', label: <>v{lv?.number ?? '?'}<i className="dot del" /></> }, { value: 'right', label: <>v{rv?.number ?? '?'}<i className="dot ins" /></> }]} />
        <span className="compare-legend small">
          <span><i className="dot del" />Removed</span>
          <span><i className="dot ins" />Added</span>
        </span>
        <span className="muted small compare-status">
          {state === 'loading' && 'Opening both revisions…'}
          {state === 'diffing' && <><span className="spinner" /> Comparing the text…</>}
          {state === 'notext' && 'One side has no text to compare (a scan?) — look at them side by side.'}
          {state === 'failed' && 'Could not compare these revisions.'}
          {state === 'ready' && diff && (diff.changes.length === 0 ? 'The text is the same.' : <>{plural(diff.changes.length, 'change')} · <span className="ins-ink">+{plural(words(diff.added), 'word')}</span> · <span className="del-ink">−{plural(words(diff.removed), 'word')}</span></>)}
        </span>
        <span className="spacer" />
        {state === 'ready' && diff && diff.changes.length > 0 && (
          <span className="row compare-nav">
            <button type="button" className="btn ghost sm" onClick={() => go(cur - 1)} aria-label="Previous change" title="Previous change"><Icon name="chevron-up" size={15} /></button>
            <span className="small num">{cur >= 0 ? `${cur + 1} / ${diff.changes.length}` : `– / ${diff.changes.length}`}</span>
            <button type="button" className="btn ghost sm" onClick={() => go(cur + 1)} aria-label="Next change" title="Next change"><Icon name="chevron-down" size={15} /></button>
          </span>
        )}
        <button type="button" className={`btn sm ${sync ? 'on' : ''}`} onClick={toggleSync} aria-pressed={sync} title={sync ? 'Scrolling one side scrolls the other — click to scroll them separately' : 'Scroll both sides together'}>
          <Icon name={sync ? 'link' : 'link-off'} size={14} />{sync ? 'Synced' : 'Not synced'}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => onPick(rightId, leftId)} title="Swap the sides" aria-label="Swap the sides"><Icon name="repeat" size={14} /></button>
        <button type="button" className="btn sm" onClick={onClose}><Icon name="x" size={14} />Close</button>
      </div>
      <div className={`compare-panes show-${side}`}>
        <div className="compare-pane left" {...lead(0)}>
          <PdfViewer url={`${V1}/reviews/${rid}/revisions/${leftId}/file`} zoom={zoom} onZoom={setZoom} onDoc={onLeftDoc}
            marks={marks.left} onScrollPos={moved(0)} follow={follow[0]} jump={jump[0]}
            title={<Select className="rev-select" value={String(leftId)} onChange={v => onPick(Number(v), rightId)} ariaLabel="Left revision" options={options} />} />
        </div>
        <div className="compare-pane right" {...lead(1)}>
          <PdfViewer url={`${V1}/reviews/${rid}/revisions/${rightId}/file`} zoom={zoom} onZoom={setZoom} onDoc={onRightDoc}
            marks={marks.right} onScrollPos={moved(1)} follow={follow[1]} jump={jump[1]}
            title={<Select className="rev-select" value={String(rightId)} onChange={v => onPick(leftId, Number(v))} ariaLabel="Right revision" options={options} />} />
        </div>
      </div>
    </div>
  )
}
