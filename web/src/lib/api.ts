// Minimal fetch wrapper for the JSON API.
export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function request<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const init: RequestInit = { method, headers: {}, credentials: 'same-origin' }
  if (body !== undefined) {
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(url, init)
  if (res.status === 401 && !url.includes('/auth/')) {
    window.dispatchEvent(new CustomEvent('pcl:unauthorized'))
  }
  if (!res.ok) {
    let msg = res.statusText
    let data: Record<string, unknown> = {}
    try {
      data = await res.json()
      msg = (data.error as string) || msg
    } catch {}
    throw new ApiError(res.status, msg, data)
  }
  if (raw) return (await res.text()) as unknown as T
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  getText: (url: string) => request<string>('GET', url, undefined, true),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

export const V1 = '/api/v1'

/** POST multipart/form-data with upload progress (0..1). */
export function upload<T>(url: string, fields: Record<string, string | Blob>, onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      let j: Record<string, unknown> = {}
      try { j = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(j as T)
      else reject(new ApiError(xhr.status, (j.error as string) || xhr.statusText || 'Upload failed', j))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed — check the connection'))
    xhr.send(fd)
  })
}
