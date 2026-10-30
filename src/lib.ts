import { useCallback, useEffect, useRef, useState } from 'react'
import { localToday } from '../shared/calc'
import { useApi } from './api'

export const APP_NAME = 'へるログ'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** '2026-10-30' → '10/30(金)' */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  return `${m}/${d}(${wd})`
}

export function formatKcal(n: number): string {
  return Math.round(n).toLocaleString('ja-JP')
}

/** 今日の日付。アプリを開きっぱなしで日付をまたいでも追従する */
export function useToday(): string {
  const [today, setToday] = useState(localToday)
  useEffect(() => {
    const update = () => setToday(localToday())
    const timer = setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return today
}

export type Route = 'home' | 'history' | 'graph' | 'settings'

function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, '')
  return name === 'history' || name === 'graph' || name === 'settings' ? name : 'home'
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = useCallback((r: Route) => {
    location.hash = r === 'home' ? '/' : `/${r}`
    window.scrollTo(0, 0)
  }, [])
  return [route, navigate]
}

export interface Feedback {
  status: 'idle' | 'loading' | 'done' | 'error' | 'unavailable'
  content?: string
  retry: () => void
}

/**
 * その日のAIフィードバックを取得する。サーバー側で1日1件に制限しているので、
 * その日最初の呼び出しで生成され、以降は保存済みのものが返る。
 */
export function useFeedback(date: string, enabled: boolean): Feedback {
  const api = useApi()
  const [state, setState] = useState<Omit<Feedback, 'retry'>>({ status: 'idle' })
  const requested = useRef<string | null>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    // 別のリクエストが生成中（pending）の間は少し待って取り直す
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const res = await api<{ status: 'done'; content: string } | { status: 'pending' } | { status: 'unavailable' }>(
          `/feedback/${date}`,
          { method: 'POST' },
        )
        if (res.status !== 'pending') {
          setState(res)
          return
        }
      } catch {
        setState({ status: 'error' })
        return
      }
      await new Promise((r) => setTimeout(r, 4000))
    }
    setState({ status: 'error' })
  }, [api, date])

  useEffect(() => {
    if (!enabled || requested.current === date) return
    requested.current = date
    void load()
  }, [enabled, date, load])

  return { ...state, retry: () => void load() }
}
