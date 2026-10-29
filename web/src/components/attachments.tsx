import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { upload, V1 } from '../lib/api'
import { useToast } from './ui'
import { Icon } from './icons'

/** Pictures in comments: paste (⌘V), drop or pick them; they upload at once and post with the comment. */

export const MAX_IMAGES = 10
export const imageUrl = (rid: number, id: number) => `${V1}/reviews/${rid}/images/${id}`

type Pending = { key: string; id?: number; preview: string }

export function useImageAttach(rid: number, initial: number[] = []) {
  const { toast } = useToast()
  const [items, setItems] = useState<Pending[]>(() => initial.map(id => ({ key: `i${id}`, id, preview: imageUrl(rid, id) })))
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), [])

  const count = useRef(items.length)
  count.current = items.length
  const add = useCallback((files: File[]) => {
    const pics = files.filter(f => f.type.startsWith('image/'))
    if (!pics.length) return false
    const room = MAX_IMAGES - count.current
    if (room < pics.length) toast(`Up to ${MAX_IMAGES} pictures per comment`, 'err')
    const next = pics.slice(0, Math.max(0, room)).map(f => {
      const preview = URL.createObjectURL(f)
      urls.current.push(preview)
      const key = Math.random().toString(36).slice(2)
      upload<{ id: number }>(`${V1}/reviews/${rid}/images`, { file: f })
        .then(im => setItems(list => list.map(x => (x.key === key ? { ...x, id: im.id } : x))))
        .catch(e => { toast((e as Error).message, 'err'); setItems(list => list.filter(x => x.key !== key)) })
      return { key, preview }
    })
    count.current += next.length
    setItems(cur => [...cur, ...next])
    return true
  }, [rid, toast])

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); add(files) }
  }
  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files)
    if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); add(files) }
  }
  const remove = (key: string) => setItems(list => list.filter(x => x.key !== key))
  const clear = () => setItems([])
  return {
    items, add, remove, clear, onPaste, onDrop,
    ids: items.filter(x => x.id).map(x => x.id!) as number[],
    uploading: items.some(x => !x.id),
    has: items.length > 0,
  }
}
export type ImageAttach = ReturnType<typeof useImageAttach>

/** The paperclip: pick pictures from disk (or the camera roll on a phone). */
export function AttachButton({ att, size = 'sm' }: { att: ImageAttach; size?: 'sm' | 'xs' }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={`btn ghost icon-only ${size}`} onClick={() => input.current?.click()} title="Add a picture — or paste one (⌘V / Ctrl+V)" aria-label="Add a picture"><Icon name="image" size={15} /></button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={e => { att.add(Array.from(e.target.files || [])); e.target.value = '' }} />
    </>
  )
}

/** The pictures waiting to go out with a comment. */
export function AttachStrip({ att }: { att: ImageAttach }) {
  if (!att.has) return null
  return (
    <div className="att-strip">
      {att.items.map(x => (
        <span key={x.key} className={`att-thumb ${x.id ? '' : 'busy'}`}>
          <img src={x.preview} alt="" />
          {!x.id && <span className="spinner" />}
          <button type="button" className="att-x" onClick={() => att.remove(x.key)} aria-label="Remove picture" title="Remove"><Icon name="x" size={12} strokeWidth={2.4} /></button>
        </span>
      ))}
    </div>
  )
}

/** Pictures in a posted comment; a click opens them large. */
export function CommentImages({ rid, ids }: { rid: number; ids: number[] }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!ids?.length) return null
  return (
    <>
      <div className={`cmt-images n${Math.min(ids.length, 3)}`} onClick={e => e.stopPropagation()}>
        {ids.map((id, i) => (
          <button key={id} type="button" className="cmt-img" onClick={() => setOpen(i)} title="Open the picture">
            <img src={imageUrl(rid, id)} alt={`Picture ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>
      {open !== null && <Lightbox rid={rid} ids={ids} at={open} onMove={setOpen} onClose={() => setOpen(null)} />}
    </>
  )
}

function Lightbox({ rid, ids, at, onMove, onClose }: { rid: number; ids: number[]; at: number; onMove: (i: number) => void; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      if (e.key === 'ArrowRight' && at < ids.length - 1) onMove(at + 1)
      if (e.key === 'ArrowLeft' && at > 0) onMove(at - 1)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [at, ids.length, onMove, onClose])
  const url = imageUrl(rid, ids[at])
  return createPortal(
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="Picture">
      <img src={url} alt="" onClick={e => e.stopPropagation()} />
      <div className="lb-bar" onClick={e => e.stopPropagation()}>
        {ids.length > 1 && <>
          <button type="button" className="btn ghost icon-only sm" disabled={at === 0} onClick={() => onMove(at - 1)} aria-label="Previous picture"><Icon name="chevron-left" size={16} /></button>
          <span className="small">{at + 1} / {ids.length}</span>
          <button type="button" className="btn ghost icon-only sm" disabled={at === ids.length - 1} onClick={() => onMove(at + 1)} aria-label="Next picture"><Icon name="chevron-right" size={16} /></button>
        </>}
        <a className="btn ghost icon-only sm" href={url} target="_blank" rel="noreferrer" title="Open in a new tab" aria-label="Open in a new tab"><Icon name="external" size={15} /></a>
        <button type="button" className="btn ghost icon-only sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
      </div>
    </div>, document.body)
}
