import { useState } from 'react'
import type { ReviewStatus, Role, Severity, User } from '../lib/types'
import { ROLE_HELP, ROLE_LABEL, SEVERITY_LABEL, STATUS_LABEL } from '../lib/format'
import { Select } from './Select'

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
      <select value={role} onChange={e => setRole(e.target.value as Role)} aria-label="Role" style={{ width: 'auto' }}>
        <option value="reviewer">Reviewer</option>
        <option value="approver">Approver</option>
        <option value="observer">Observer</option>
      </select>
      <button type="button" className="btn" onClick={add} disabled={!who || busy}>Add</button>
      {who.startsWith('email:') && <span className="muted small block" style={{ flexBasis: '100%' }}>{who.slice(6)} gets an account; they sign in with single sign-on, or an admin sets a password.</span>}
    </div>
  )
}
