import { useCallback, useEffect, useRef, useState } from 'react'
import { localToday, type StoredFeedback, type WeightSlot } from '../shared/calc'
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

export type SlotFeedback = { status: 'loading' } | { status: 'done'; content: string } | { status: 'error' }

type GenerateResponse = { status: 'done'; content: string } | { status: 'pending' } | { status: 'unavailable' }

/**
 * その日の体重の枠ごとのAIフィードバック。
 * live（今日）のときは、記録済みでまだフィードバックがない枠を生成する。
 * 記録した直後だけでなく、生成前にアプリを閉じた場合も次に開いたときに生成される。
 */
export function useSlotFeedbacks(date: string, recorded: WeightSlot[], live: boolean) {
  // トークン取得関数が描画ごとに変わっても、読み込み中のリクエストを取り消さないように ref で持つ
  const api = useApi()
  const apiRef = useRef(api)
  useEffect(() => {
    apiRef.current = api
  })
  const [items, setItems] = useState<Record<string, SlotFeedback>>({})
  const [loadedDates, setLoadedDates] = useState<Record<string, true>>({})
  const started = useRef(new Set<string>())

  const put = useCallback((key: string, value: SlotFeedback) => setItems((s) => ({ ...s, [key]: value })), [])

  const generate = useCallback(
    async (d: string, slot: WeightSlot) => {
      const key = `${d}:${slot}`
      put(key, { status: 'loading' })
      // 別のリクエストが生成中（pending）の間は少し待って取り直す
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          const res = await apiRef.current<GenerateResponse>(`/feedbacks/${d}/${slot}`, { method: 'POST' })
          if (res.status === 'done') return put(key, { status: 'done', content: res.content })
          if (res.status === 'unavailable') break
        } catch {
          break
        }
        await new Promise((r) => setTimeout(r, 4000))
      }
      put(key, { status: 'error' })
    },
    [put],
  )

  // その日の保存済みフィードバックを読む
  useEffect(() => {
    if (loadedDates[date]) return
    let cancelled = false
    const markLoaded = () => setLoadedDates((s) => ({ ...s, [date]: true }))
    apiRef.current<{ feedbacks: StoredFeedback[] }>(`/feedbacks/${date}`)
      .then((res) => {
        if (cancelled) return
        setItems((s) => {
          const next = { ...s }
          for (const f of res.feedbacks) next[`${date}:${f.slot}`] = { status: 'done', content: f.content }
          return next
        })
        markLoaded()
      })
      .catch(() => {
        if (!cancelled) markLoaded()
      })
    return () => {
      cancelled = true
    }
  }, [date, loadedDates])

  const pending = live && loadedDates[date] ? recorded.filter((slot) => !items[`${date}:${slot}`]) : []
  const pendingKey = pending.join(',')
  useEffect(() => {
    if (!pendingKey) return
    for (const slot of pendingKey.split(',') as WeightSlot[]) {
      const key = `${date}:${slot}`
      if (started.current.has(key)) continue
      started.current.add(key)
      void generate(date, slot)
    }
  }, [date, pendingKey, generate])

  return {
    get: (slot: WeightSlot): SlotFeedback | undefined => items[`${date}:${slot}`],
    retry: (slot: WeightSlot) => void generate(date, slot),
  }
}
