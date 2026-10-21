import { useRef, useState } from 'react'
import type { ReviewStatus, Role, Severity, User } from '../lib/types'
import { fmtBytes, plural, ROLE_HELP, ROLE_LABEL, SEVERITY_LABEL, STATUS_LABEL } from '../lib/format'
import { Select } from './Select'
import { Icon } from './icons'

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>
}

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`badge role-${role}`} title={ROLE_HELP[role]}>{ROLE_LABEL[role]}</span>
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  if (!severity) return null
  return <span className={`badge sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>
}

/** Page count of a PDF the person picked, measured in the browser before upload. */
export async function countPages(file: File): Promise<number> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try { return (await task.promise).numPages } finally { await task.destroy() }
}

const ROLE_HINT: Record<Role, string> = { owner: 'hands the review over', approver: 'signs off', reviewer: 'comments, verdict', observer: 'reads along' }

/** Searchable role picker; withOwner adds "Make owner…" (hand the review over). */
export function RoleSelect({ value, onChange, withOwner, disabled }: { value: Role; onChange: (r: Role) => void; withOwner?: boolean; disabled?: boolean }) {
  const roles: Role[] = withOwner ? ['approver', 'reviewer', 'observer', 'owner'] : ['approver', 'reviewer', 'observer']
  return <Select value={value} onChange={v => onChange(v as Role)} ariaLabel="Role" className="role-select" disabled={disabled}
    options={roles.map(r => ({ value: r, label: r === 'owner' ? 'Make owner…' : ROLE_LABEL[r], hint: ROLE_HINT[r] }))} />
}

export interface PersonInvite { user_id?: number; email?: string; name?: string; role: Role }

/** Pick an existing account or type an email (a passwordless account is made for it), and a role. */
export function PersonPicker({ users, exclude, onAdd, busy }: { users: User[]; exclude: number[]; onAdd: (p: PersonInvite) => void; busy?: boolean }) {
  const [who, setWho] = useState('')
  const [role, setRole] = useState<Role>('reviewer')
  const options = users.filter(u => !exclude.includes(u.id)).map(u => ({ value: String(u.id), label: u.name || u.email, hint: u.name ? u.email : undefined }))
  if (who.startsWith('email:')) options.push({ value: who, label: who.slice(6), hint: 'new' })
  const add = () => {
    if (!who) return
    if (who.startsWith('email:')) onAdd({ email: who.slice(6), role })
    else onAdd({ user_id: Number(who), role })
    setWho('')
  }
  return (
    <div className="row wrap person-picker">
      <Select value={who} onChange={setWho} options={options} placeholder="Person or email…" ariaLabel="Person"
        onCreate={label => { const e = label.trim().toLowerCase(); return e.includes('@') ? `email:${e}` : '' }} createLabel="Invite"
        className="grow" />
      <RoleSelect value={role} onChange={setRole} />
      <button type="button" className="btn" onClick={add} disabled={!who || busy}>Add</button>
      {who.startsWith('email:') && <span className="muted small block" style={{ flexBasis: '100%' }}>{who.slice(6)} gets an account; they sign in with single sign-on, or an admin sets a password.</span>}
    </div>
  )
}

/** Drop a PDF here or click to choose one. Shows the picked file with its size and page count. */
export function PdfDrop({ file, pages, onPick, hint = 'or click to choose one', disabled }: { file: File | null; pages: number; onPick: (f: File) => void; hint?: string; disabled?: boolean }) {
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={`dropzone ${drag ? 'over' : ''} ${file ? 'has' : ''} ${disabled ? 'disabled' : ''}`} role="button" tabIndex={0}
      onClick={() => !disabled && input.current?.click()} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); input.current?.click() } }}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); if (!disabled && e.dataTransfer.files[0]) onPick(e.dataTransfer.files[0]) }}>
      <span className="drop-ico" aria-hidden>{file
        ? <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 14l2 2 4-4" /></svg>
        : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4" /><path d="M7 9l5-5 5 5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>}</span>
      {file ? <><b>{file.name}</b><span className="muted">{fmtBytes(file.size)}{pages > 0 && ` · ${plural(pages, 'page')}`} · click or drop to change</span></>
        : <><b>Drop a PDF here</b><span className="muted">{hint}</span></>}
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e => { if (e.target.files?.[0]) onPick(e.target.files[0]); e.target.value = '' }} />
    </div>
  )
}

/** True when the file looks like a PDF (by type or name). */
export const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

const SOURCE_APPS: Record<string, string> = { office: 'Pocket Office', documents: 'Pocket Documents' }

/** Where the document came from, with a way back to the original. */
export function SourceChip({ review, small }: { review: { source_app: string; source_url: string; source_label: string }; small?: boolean }) {
  if (!review.source_app) return null
  const app = SOURCE_APPS[review.source_app] || review.source_app
  const body = <><Icon name="external" size={11} />{small ? app : `From ${app}`}{review.source_label && !small ? ` · ${review.source_label}` : ''}</>
  if (!review.source_url) return <span className={`badge source ${small ? 'sm' : ''}`} title={review.source_label}>{body}</span>
  return <a className={`badge source ${small ? 'sm' : ''}`} href={review.source_url} target="_blank" rel="noreferrer" title={`Open the original in ${app}${review.source_label ? ' — ' + review.source_label : ''}`} onClick={e => e.stopPropagation()}>{body}</a>
}
