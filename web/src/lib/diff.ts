import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Rect } from './types'

/**
 * Comparing two revisions by their text: every word with its box on the page,
 * diffed line by line first and then word by word inside the lines that
 * changed (so a word added early in a paragraph that re-wraps every line below
 * it still shows as one added word). Pictures and layout are not compared.
 */

export interface Word { t: string; page: number; line: number; r: Rect }

/** One change: words removed from the left, added on the right, or both (replaced). */
export interface Change { del: number[]; ins: number[]; leftAt: number; rightAt: number }

export interface DocDiff {
  left: Word[]
  right: Word[]
  removed: Set<number>
  added: Set<number>
  changes: Change[]
  /** pairs of the same text on both sides as (page-1 + y), in order — for syncing the scroll */
  anchors: [number, number][]
}

/** Every word of a document with its box (0..1 of the page). */
export async function extractWords(doc: PDFDocumentProxy, dead: () => boolean = () => false): Promise<Word[]> {
  const out: Word[] = []
  let line = -1
  for (let n = 1; n <= doc.numPages; n++) {
    if (dead()) return out
    const page = await doc.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    let lastY = NaN, lastX = Infinity
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue
      const tx = pdfjs.Util.transform(vp.transform, it.transform)
      const fh = Math.hypot(tx[2], tx[3]) || it.height || 10
      const left = tx[4], base = tx[5], top = base - fh * 0.85
      const width = it.width * vp.scale
      // a new line when the baseline moves or the text jumps back to the left
      if (!(Math.abs(base - lastY) < fh * 0.5) || left < lastX - fh) line++
      lastY = base
      const len = it.str.length
      const re = /\S+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(it.str))) {
        const x0 = left + (width * m.index) / len, x1 = left + (width * (m.index + m[0].length)) / len
        out.push({ t: m[0], page: n, line, r: { x: x0 / vp.width, y: top / vp.height, w: (x1 - x0) / vp.width, h: fh / vp.height } })
      }
      lastX = left + width
    }
    page.cleanup()
  }
  return out
}

/**
 * Myers' diff of two sequences of ids. Returns, for each item of a, the index
 * of the same item in b (or -1). Gives up (null) past maxD edits.
 */
export function myers(a: ArrayLike<number>, b: ArrayLike<number>, maxD = 2500): Int32Array | null {
  const N = a.length, M = b.length
  const match = new Int32Array(N).fill(-1)
  // the common start and end cost nothing
  let s = 0
  while (s < N && s < M && a[s] === b[s]) { match[s] = s; s++ }
  let e = 0
  while (e < N - s && e < M - s && a[N - 1 - e] === b[M - 1 - e]) { match[N - 1 - e] = M - 1 - e; e++ }
  const n = N - s - e, m = M - s - e
  if (n === 0 || m === 0) return match
  const max = n + m, off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  const A = (i: number) => a[s + i], B = (j: number) => b[s + j]
  let found = -1
  for (let d = 0; d <= Math.min(max, maxD) && found < 0; d++) {
    trace.push(v.slice(off - d, off + d + 1)) // the state after d-1 edits, k = -d..d
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && A(x) === B(y)) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) { found = d; break }
    }
  }
  if (found < 0) return null
  let x = n, y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d], at = (k: number) => prev[k + d]
    const k = x - y
    const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const px = at(pk), py = px - pk
    while (x > px && y > py) { x--; y--; match[s + x] = s + y }
    x = px; y = py
  }
  while (x > 0 && y > 0) { x--; y--; match[s + x] = s + y }
  return match
}

function intern(list: string[], ids: Map<string, number>): Int32Array {
  const out = new Int32Array(list.length)
  list.forEach((t, i) => {
    let id = ids.get(t)
    if (id === undefined) { id = ids.size; ids.set(t, id) }
    out[i] = id
  })
  return out
}

/** Pairs matched items of a and b; a-only and b-only items in between are the gaps. */
function walk(na: number, nb: number, match: Int32Array, onPair: (i: number, j: number) => void, onGap: (as: number[], bs: number[]) => void) {
  let j = 0
  let ga: number[] = []
  for (let i = 0; i <= na; i++) {
    const to = i < na ? match[i] : nb
    if (i < na && to < 0) { ga.push(i); continue }
    const gb: number[] = []
    for (; j < to; j++) gb.push(j)
    if (ga.length || gb.length) onGap(ga, gb)
    ga = []
    if (i < na) { onPair(i, to); j = to + 1 }
  }
}

export function diffWords(left: Word[], right: Word[]): DocDiff {
  // lines of each side
  const lines = (ws: Word[]) => {
    const out: { words: number[]; text: string }[] = []
    ws.forEach((w, i) => {
      if (!out.length || ws[i - 1].line !== w.line) out.push({ words: [], text: '' })
      const l = out[out.length - 1]
      l.words.push(i); l.text += (l.text ? ' ' : '') + w.t
    })
    return out
  }
  const L = lines(left), R = lines(right)
  const lineIds = new Map<string, number>()
  const lineMatch = myers(intern(L.map(l => l.text), lineIds), intern(R.map(l => l.text), lineIds)) ?? new Int32Array(L.length).fill(-1)

  const wordMatch = new Int32Array(left.length).fill(-1)
  const wordIds = new Map<string, number>()
  walk(L.length, R.length, lineMatch,
    (i, j) => L[i].words.forEach((w, k) => { wordMatch[w] = R[j].words[k] }),
    (ls, rs) => {
      const a = ls.flatMap(i => L[i].words), b = rs.flatMap(j => R[j].words)
      if (!a.length || !b.length) return
      const m = myers(intern(a.map(i => left[i].t), wordIds), intern(b.map(j => right[j].t), wordIds), 4000)
      if (m) m.forEach((to, k) => { if (to >= 0) wordMatch[a[k]] = b[to] })
    })

  const removed = new Set<number>(), added = new Set<number>()
  const changes: Change[] = []
  const anchors: [number, number][] = []
  const posOf = (w: Word) => w.page - 1 + w.r.y
  let lastL = -1, lastR = -1
  walk(left.length, right.length, wordMatch,
    (i, j) => {
      const a = posOf(left[i]), b = posOf(right[j])
      // keep the pairs that move forward on both sides (two-column pages can jump back)
      if (a > lastL && b > lastR) { anchors.push([a, b]); lastL = a; lastR = b }
    },
    (ls, rs) => {
      ls.forEach(i => removed.add(i)); rs.forEach(j => added.add(j))
      changes.push({ del: ls, ins: rs, leftAt: ls.length ? posOf(left[ls[0]]) : -1, rightAt: rs.length ? posOf(right[rs[0]]) : -1 })
    })
  return { left, right, removed, added, changes, anchors }
}

/** Boxes of words on one page, joined into one box per run on the same line. */
export function joinBoxes(words: Word[], idx: number[]): Map<number, Rect[]> {
  const out = new Map<number, Rect[]>()
  let prev: Word | null = null
  for (const i of idx) {
    const w = words[i]
    const list = out.get(w.page) ?? []
    const last = list[list.length - 1]
    if (last && prev && prev.page === w.page && prev.line === w.line && w.r.x >= last.x - 0.002 && w.r.x - (last.x + last.w) < 0.05) {
      const x2 = Math.max(last.x + last.w, w.r.x + w.r.w)
      const y2 = Math.max(last.y + last.h, w.r.y + w.r.h)
      last.y = Math.min(last.y, w.r.y); last.w = x2 - last.x; last.h = y2 - last.y
    } else list.push({ ...w.r })
    out.set(w.page, list)
    prev = w
  }
  return out
}

/** Maps a scroll position on one side to the other through the matching text. */
export function mapPos(anchors: [number, number][], y: number, from: 0 | 1): number {
  const to = from === 0 ? 1 : 0
  if (!anchors.length) return y
  if (y <= anchors[0][from]) return anchors[0][to] - (anchors[0][from] - y)
  const last = anchors[anchors.length - 1]
  if (y >= last[from]) return last[to] + (y - last[from])
  let lo = 0, hi = anchors.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (anchors[mid][from] <= y) lo = mid; else hi = mid }
  const a = anchors[lo], b = anchors[hi]
  const t = b[from] === a[from] ? 0 : (y - a[from]) / (b[from] - a[from])
  return a[to] + t * (b[to] - a[to])
}
