import { BackendError } from './BackendAdapter'

export interface HttpOptions {
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** JSON over fetch with a timeout and typed errors. */
export function createHttp({ baseUrl, timeoutMs = 8000, fetchImpl }: HttpOptions) {
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      throw new BackendError(aborted ? 'timeout' : 'network', aborted ? 'The backend did not answer in time' : 'Could not reach the backend')
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let json: unknown = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        throw new BackendError('bad_response', `Backend sent non-JSON (${res.status})`, res.status)
      }
    }
    if (!res.ok) {
      const err = (json ?? {}) as { code?: string; message?: string; error?: string }
      throw new BackendError(err.code ?? `http_${res.status}`, err.message ?? err.error ?? `Request failed (${res.status})`, res.status)
    }
    return json
  }

  return {
    get: (path: string) => request('GET', path),
    post: (path: string, body: unknown = {}) => request('POST', path, body),
  }
}
