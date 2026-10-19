import type { DateFormat, ReviewStatus, Role, Severity, TimeFormat, Verdict } from './types'

// ---- dates: the format comes from Settings → General and is set once by the app context.
let DATE_FMT: DateFormat = 'auto'
let TIME_FMT: TimeFormat = 'auto'
export function setDateFormats(d: DateFormat, t: TimeFormat) { DATE_FMT = d; TIME_FMT = t }

export const DATE_FORMATS: { id: DateFormat; label: string }[] = [
  { id: 'auto', label: 'Browser locale' }, { id: 'dmy-dot', label: '31.12.2026' }, { id: 'dmy-slash', label: '31/12/2026' },
  { id: 'mdy-slash', label: '12/31/2026' }, { id: 'ymd', label: '2026-12-31' }, { id: 'dmmmy', label: '31 Dec 2026' }, { id: 'mmmdy', label: 'Dec 31, 2026' },
]
export const TIME_FORMATS: { id: TimeFormat; label: string }[] = [{ id: 'auto', label: 'Browser locale' }, { id: '24h', label: '17:05' }, { id: '12h', label: '5:05 PM' }]

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Format a calendar date (y, m 1-12, d) in the chosen format; withYear=false drops the year for nearby dates. */
export function fmtYMD(y: number, m: number, d: number, withYear = true, fmt: DateFormat = DATE_FMT): string {
  const dd = String(d).padStart(2, '0'), mm = String(m).padStart(2, '0')
  switch (fmt) {
    case 'dmy-dot': return withYear ? `${dd}.${mm}.${y}` : `${dd}.${mm}.`
    case 'dmy-slash': return withYear ? `${dd}/${mm}/${y}` : `${dd}/${mm}`
    case 'mdy-slash': return withYear ? `${mm}/${dd}/${y}` : `${mm}/${dd}`
    case 'ymd': return withYear ? `${y}-${mm}-${dd}` : `${mm}-${dd}`
    case 'dmmmy': return withYear ? `${d} ${MON[m - 1]} ${y}` : `${d} ${MON[m - 1]}`
    case 'mmmdy': return withYear ? `${MON[m - 1]} ${d}, ${y}` : `${MON[m - 1]} ${d}`
    default: return new Date(y, m - 1, d).toLocaleDateString(undefined, withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' })
  }
}

/** "2026-03-14" → "14 Mar 2026" (or the chosen format); "" stays "". */
export function fmtDate(d: string, withYear = true): string {
  if (!d) return ''
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return fmtYMD(y, m, day, withYear)
}

export function fmtTime(t: Date, fmt: TimeFormat = TIME_FMT): string {
  const h = t.getHours(), mi = String(t.getMinutes()).padStart(2, '0')
  switch (fmt) {
    case '24h': return `${String(h).padStart(2, '0')}:${mi}`
    case '12h': return `${h % 12 || 12}:${mi} ${h < 12 ? 'AM' : 'PM'}`
    default: return t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
}

/** ISO timestamp → "14 Mar 2026 17:05" in the chosen formats. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  return `${fmtYMD(t.getFullYear(), t.getMonth() + 1, t.getDate())} ${fmtTime(t)}`
}

/** Relative for the last week ("3 h ago"), the full date and time after that. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return fmtDateTime(iso)
}

/** Seconds → "45 s", "12 min", "1 h 5 min", "3 d 4 h". */
export function fmtDuration(sec: number): string {
  if (sec > 0 && sec < 60) return `${Math.round(sec)} s`
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h >= 48) return `${Math.floor(h / 24)} d ${h % 24} h`
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#c026d3', '#475569']
export function colorFor(id: number): string { return PALETTE[Math.abs(id) % PALETTE.length] }

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  draft: 'Draft', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
}
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', approver: 'Approver', reviewer: 'Reviewer', observer: 'Observer' }
export const ROLE_HELP: Record<Role, string> = {
  owner: 'Uploads revisions, manages people, starts and closes the review.',
  approver: 'Signs off: approves, requests changes or rejects. Moderates every thread.',
  reviewer: 'Reads, comments and raises issues, then finishes with a verdict.',
  observer: 'Reads along; cannot comment.',
}
export const VERDICT_LABEL: Record<Exclude<Verdict, ''>, string> = { approved: 'Approved', changes: 'Changes requested', rejected: 'Rejected' }
export const REVIEWER_VERDICT_LABEL: Record<Exclude<Verdict, ''>, string> = { approved: 'Looks good', changes: 'Needs changes', rejected: 'Reject' }
export const SEVERITY_LABEL: Record<Exclude<Severity, ''>, string> = { critical: 'Critical', major: 'Major', minor: 'Minor' }

export function personName(p: { name?: string; email?: string } | undefined | null): string {
  if (!p) return 'Someone'
  return p.name || p.email || 'Someone'
}

export function plural(n: number, one: string, many = one + 's'): string { return `${n} ${n === 1 ? one : many}` }
