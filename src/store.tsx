import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Goal, IntakeEntry, Profile, UserData, WeightEntry } from '../shared/calc'
import { useApi } from './api'

interface Store {
  data: UserData | null
  error: string | null
  reload: () => Promise<void>
  saveProfile: (profile: Profile) => Promise<void>
  saveGoal: (goal: Goal) => Promise<void>
  saveWeight: (date: string, weight: number) => Promise<void>
  deleteWeight: (date: string) => Promise<void>
  addIntake: (date: string, kcal: number, label: string) => Promise<void>
  deleteIntake: (id: number) => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const store = use(StoreContext)
  if (!store) throw new Error('useStore must be used inside DataProvider')
  return store
}

/** ログイン中ユーザーの全データを読み込んで保持する（2人で使う規模なので丸ごと持つ） */
export function DataProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const [data, setData] = useState<UserData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await api<UserData>('/data'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    void reload()
  }, [reload])

  const update = (fn: (d: UserData) => UserData) => setData((d) => (d ? fn(d) : d))

  const store = useMemo<Store>(
    () => ({
      data,
      error,
      reload,
      async saveProfile(profile) {
        const saved = await api<Profile>('/profile', { method: 'PUT', body: profile })
        update((d) => ({ ...d, profile: saved }))
      },
      async saveGoal(goal) {
        const saved = await api<Goal>('/goal', { method: 'POST', body: goal })
        update((d) => ({ ...d, goal: saved }))
      },
      async saveWeight(date, weight) {
        const saved = await api<WeightEntry>(`/weights/${date}`, { method: 'PUT', body: { weight } })
        update((d) => ({
          ...d,
          weights: [...d.weights.filter((w) => w.date !== date), saved].sort((a, b) => a.date.localeCompare(b.date)),
        }))
      },
      async deleteWeight(date) {
        await api(`/weights/${date}`, { method: 'DELETE' })
        update((d) => ({ ...d, weights: d.weights.filter((w) => w.date !== date) }))
      },
      async addIntake(date, kcal, label) {
        const saved = await api<IntakeEntry>('/intakes', { method: 'POST', body: { date, kcal, label } })
        update((d) => ({ ...d, intakes: [...d.intakes, saved] }))
      },
      async deleteIntake(id) {
        await api(`/intakes/${id}`, { method: 'DELETE' })
        update((d) => ({ ...d, intakes: d.intakes.filter((i) => i.id !== id) }))
      },
    }),
    [api, data, error, reload],
  )

  return <StoreContext value={store}>{children}</StoreContext>
}
