import { useAuth } from '@clerk/react'
import { useCallback } from 'react'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Clerkのセッショントークンを付けて /api を呼ぶ */
export function useApi() {
  const { getToken } = useAuth()
  return useCallback(
    async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
      const token = await getToken()
      const res = await fetch(`/api${path}`, {
        method: init?.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new ApiError(res.status, body.error ?? res.statusText)
      }
      return (res.status === 204 ? undefined : await res.json()) as T
    },
    [getToken],
  )
}
