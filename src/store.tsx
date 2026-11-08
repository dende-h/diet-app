import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  dailyWeights,
  type ExerciseEntry,
  type Goal,
  type IntakeEntry,
  type Profile,
  type UserData,
  type WeightEntry,
  type WeightRecord,
  type WeightSlot,
} from '../shared/calc'
import { ApiError, useApi } from './api'

interface Store {
  data: UserData | null
  /** 1日1つの体重（朝を優先し、なければ夜）。カロリーや週の目標、グラフの計算に使う */
  daily: WeightEntry[]
  error: string | null
  reload: () => Promise<void>
  saveProfile: (profile: Profile) => Promise<void>
  saveGoal: (goal: Goal) => Promise<void>
  /** 記録済みの枠には記録できない（AlreadyRecorded を投げる） */
  recordWeight: (date: string, slot: WeightSlot, weight: number) => Promise<void>
  addIntake: (entry: Omit<IntakeEntry, 'id'>) => Promise<void>
  deleteIntake: (id: number) => Promise<void>
  /** 空の文字列で削除 */
  saveExercise: (date: string, text: string) => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

/** ほかの端末などで、その枠がすでに記録されていた */
export class AlreadyRecorded extends Error {}

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

  const daily = useMemo(() => dailyWeights(data?.weights ?? []), [data])

  const store = useMemo<Store>(
    () => ({
      data,
      daily,
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
      async recordWeight(date, slot, weight) {
        try {
          const saved = await api<WeightRecord>(`/weights/${date}/${slot}`, { method: 'POST', body: { weight } })
          update((d) => ({ ...d, weights: [...d.weights, saved] }))
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            await reload()
            throw new AlreadyRecorded(e.message)
          }
          throw e
        }
      },
      async addIntake(entry) {
        const saved = await api<IntakeEntry>('/intakes', { method: 'POST', body: entry })
        update((d) => ({ ...d, intakes: [...d.intakes, saved] }))
      },
      async deleteIntake(id) {
        await api(`/intakes/${id}`, { method: 'DELETE' })
        update((d) => ({ ...d, intakes: d.intakes.filter((i) => i.id !== id) }))
      },
      async saveExercise(date, text) {
        const saved = await api<ExerciseEntry>(`/exercises/${date}`, { method: 'PUT', body: { text } })
        update((d) => ({
          ...d,
          exercises: [...d.exercises.filter((e) => e.date !== date), ...(saved.text ? [saved] : [])],
        }))
      },
    }),
    [api, data, daily, error, reload],
  )

  return <StoreContext value={store}>{children}</StoreContext>
}
