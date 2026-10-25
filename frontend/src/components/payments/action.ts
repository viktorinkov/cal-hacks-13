import { useState } from 'react'
import { toast } from 'sonner'

export const ACTION_TIMEOUT_MS = 10_000

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'Something went wrong.'
}

export function withTimeout<T>(work: Promise<T>, ms = ACTION_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The host didn’t answer in time. Check the row before you try again.')), ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/** One reducer call at a time: a pending key, a toast on the result, the refusal kept for the screen. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const run = async (key: string, work: () => Promise<void>, copy: { success: string; failure: string }): Promise<boolean> => {
    setBusy(key)
    setError(null)
    try {
      await withTimeout(work())
      toast.success(copy.success)
      return true
    } catch (caught) {
      const message = messageOf(caught)
      setError({ key, message })
      toast.error(copy.failure, { description: message })
      return false
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, run, clear: () => setError(null) }
}
