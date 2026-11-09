// フロントとWorkerの両方で使う計算ロジック。日付はすべて端末ローカルの 'YYYY-MM-DD'。

export type Sex = 'male' | 'female'

export interface Profile {
  sex: Sex
  birthYear: number
  heightCm: number
  activity: number
}

export interface Goal {
  startDate: string
  endDate: string
  startWeight: number
  lossKg: number
}

/** 1日の代表値として計算に使う体重 */
export interface WeightEntry {
  date: string
  weight: number
}

/** 体重は時刻つきで1日2回まで記録でき、記録後は変更しない */
export const MAX_WEIGHINS_PER_DAY = 2

export interface WeightRecord {
  date: string
  /** その日の何回目の記録か（1 か 2） */
  seq: number
  /** 'HH:MM' */
  time: string
  weight: number
}

/** 記録の並び順（日付 → 時刻 → 記録した順） */
export function compareRecords(a: WeightRecord, b: WeightRecord): number {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.seq - b.seq
}

/**
 * 記録から1日1つの代表値を作る。体重は食事や水分で1日のうちに重くなっていくので、
 * その日いちばん早い時刻の記録（ふつうは朝起きてすぐ）を使う。
 */
export function dailyWeights(records: WeightRecord[]): WeightEntry[] {
  const byDate = new Map<string, WeightRecord>()
  for (const r of [...records].sort(compareRecords)) {
    if (!byDate.has(r.date)) byDate.set(r.date, r)
  }
  return [...byDate.values()].map((r) => ({ date: r.date, weight: r.weight }))
}

/** AIフィードバック（体重の記録ごとに1件） */
export interface StoredFeedback {
  seq: number
  status: 'pending' | 'done'
  content: string
}

/** 夜に自動で作る「今日のまとめ」（1人1日1件。GET /api/reviews/:date） */
export interface DailyReview {
  content: string
  /** 作った回数。自動で1回、記録を足したあとの作り直しで1回の最大2回 */
  generations: number
}

export const MAX_REVIEW_GENERATIONS = 2

/** まとめを自動で作る時刻（日本時間の時）。実際の起動時刻は wrangler.jsonc の triggers.crons（UTC） */
export const REVIEW_HOUR = 22

/** その日に体重・食事・運動のどれかを記録しているか（何もない日はまとめを作らない） */
export function hasRecords(data: Pick<UserData, 'weights' | 'intakes' | 'exercises'>, date: string): boolean {
  return (
    data.weights.some((w) => w.date === date) ||
    data.intakes.some((i) => i.date === date) ||
    data.exercises.some((e) => e.date === date)
  )
}

export interface IntakeEntry {
  id: number
  date: string
  /** 'HH:MM'。時刻を記録する前のデータは '' */
  time: string
  kcal: number
  /** 食事の内容。本人が書いたもの、なければ写真から推定した料理名（どちらもなければ ''） */
  label: string
}

/** 食事の内容の最大文字数（写真の補足にも使う） */
export const MAX_MEAL_LABEL_LENGTH = 60

/**
 * 写真判定のあとに内容の欄に入れる文。補足だけ（「ご飯少なめ」など）だと何を食べたか残らないので、
 * 補足に料理名が入っていなければ、AIが見分けた料理名を前につける
 */
export function mealLabel(estimate: CalorieEstimate, note: string): string {
  if (!note) return estimate.label
  if (estimate.items.every((i) => note.includes(i.name))) return note
  return `${estimate.label}（${note}）`.slice(0, MAX_MEAL_LABEL_LENGTH)
}

/** その日の運動（自由記述）。AIフィードバックの材料にするだけで、消費カロリーは計算しない */
export interface ExerciseEntry {
  date: string
  text: string
}

export const MAX_EXERCISE_LENGTH = 200

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/** 端末の現在時刻 'HH:MM' */
export function localTime(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** GET /api/data のレスポンス */
export interface UserData {
  profile: Profile | null
  goal: Goal | null
  weights: WeightRecord[]
  intakes: IntakeEntry[]
  exercises: ExerciseEntry[]
}

/** 写真からのカロリー推定（POST /api/estimate）の結果 */
export interface CalorieEstimate {
  kcal: number
  /** 料理名をつないだもの（記録のメモに使う） */
  label: string
  items: { name: string; kcal: number }[]
}

/** 写真からのカロリー推定は1人1日この回数まで。それ以上は手入力 */
export const DAILY_ESTIMATE_LIMIT = 10

/** 写真からのカロリー推定の、その日の残り回数（GET /api/estimates/:date） */
export interface EstimateUsage {
  used: number
  limit: number
  remaining: number
}

export const ACTIVITY_LEVELS = [
  { value: 1.2, label: 'ほぼ座りっぱなし（デスクワーク中心）' },
  { value: 1.375, label: '軽い運動（週1〜3回）' },
  { value: 1.55, label: '中程度の運動（週3〜5回）' },
  { value: 1.725, label: '激しい運動（週6〜7回）' },
] as const

/** 維持カロリーのうち、摂取ボーダーとする割合 */
export const BORDER_RATIO = 0.75

// ---- 日付 ----

export function toDayNum(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

export function fromDayNum(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return fromDayNum(toDayNum(date) + days)
}

export function localToday(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isValidDate(date: unknown): date is string {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && fromDayNum(toDayNum(date)) === date
}

// ---- カロリー ----

/** Mifflin-St Jeor式の基礎代謝 */
export function bmr(profile: Profile, weight: number, date: string): number {
  const age = Number(date.slice(0, 4)) - profile.birthYear
  const base = 10 * weight + 6.25 * profile.heightCm - 5 * age
  return profile.sex === 'male' ? base + 5 : base - 161
}

export interface CalorieTarget {
  weight: number
  bmr: number
  maintenance: number
  border: number
}

export function calorieTarget(profile: Profile, weight: number, date: string): CalorieTarget {
  const b = bmr(profile, weight, date)
  const maintenance = b * profile.activity
  return {
    weight,
    bmr: Math.round(b),
    maintenance: Math.round(maintenance),
    border: Math.round(maintenance * BORDER_RATIO),
  }
}

/** date 時点で最新の体重（なければ目標の開始体重） */
export function weightAsOf(weights: WeightEntry[], date: string, fallback: number): number {
  let best: WeightEntry | undefined
  for (const w of weights) {
    if (w.date <= date && (!best || w.date > best.date)) best = w
  }
  return best ? best.weight : fallback
}

export function intakeTotal(intakes: IntakeEntry[], date: string): number {
  return intakes.reduce((sum, i) => (i.date === date ? sum + i.kcal : sum), 0)
}

// ---- 週ごとの目標 ----

export interface WeekPlan {
  /** 0始まりの週番号 */
  index: number
  startDate: string
  /** 週の最終日（この日の終わりまでが週） */
  endDate: string
  /** 週の開始時点の基準体重 */
  refWeight: number
  /** この週に減らす目標 */
  targetLoss: number
  /** 週末時点の目標体重 */
  targetWeight: number
}

export interface Plan {
  targetWeight: number
  totalWeeks: number
  initialWeeklyLoss: number
  /** 開始済みの週（今週まで） */
  weeks: WeekPlan[]
  /** 今日を含む週。期間前・期間後は null */
  current: WeekPlan | null
  phase: 'before' | 'active' | 'finished'
}

/**
 * 週の開始時点の基準体重。体重は日々ぶれるので直近4日の平均を使い、
 * その期間に記録がなければそれ以前の最新値を使う。
 */
export function refWeightAt(weights: WeightEntry[], date: string): number | null {
  const from = addDays(date, -3)
  const recent = weights.filter((w) => w.date >= from && w.date <= date)
  if (recent.length > 0) return recent.reduce((s, w) => s + w.weight, 0) / recent.length
  let best: WeightEntry | undefined
  for (const w of weights) {
    if (w.date < from && (!best || w.date > best.date)) best = w
  }
  return best ? best.weight : null
}

export function computePlan(goal: Goal, weights: WeightEntry[], today: string): Plan {
  const start = toDayNum(goal.startDate)
  const end = toDayNum(goal.endDate)
  const now = toDayNum(today)
  const targetWeight = goal.startWeight - goal.lossKg
  const totalWeeks = (end - start) / 7
  const initialWeeklyLoss = totalWeeks > 0 ? goal.lossKg / totalWeeks : goal.lossKg

  const weeks: WeekPlan[] = []
  let current: WeekPlan | null = null
  for (let k = 0; ; k++) {
    const weekStart = start + 7 * k
    if (weekStart >= end || weekStart > now) break
    const weekEnd = Math.min(weekStart + 7, end)
    const prev = weeks[k - 1]
    const ref =
      k === 0
        ? goal.startWeight
        : (refWeightAt(weights, fromDayNum(weekStart)) ?? prev.targetWeight)
    // 残り期間で均等に落とす前提で、この週の分を割り当てる
    const remaining = Math.max(ref - targetWeight, 0)
    const targetLoss = (remaining * (weekEnd - weekStart)) / (end - weekStart)
    const week: WeekPlan = {
      index: k,
      startDate: fromDayNum(weekStart),
      endDate: fromDayNum(weekEnd - 1),
      refWeight: ref,
      targetLoss,
      targetWeight: ref - targetLoss,
    }
    weeks.push(week)
    if (now < weekEnd) current = week
  }

  const phase = now < start ? 'before' : now >= end ? 'finished' : 'active'
  return { targetWeight, totalWeeks, initialWeeklyLoss, weeks, current, phase }
}

// ---- グラフ ----

export interface Point {
  /** dayNum */
  x: number
  y: number
}

export interface ChartLines {
  /** 当初の計画（開始→ゴールの直線） */
  planned: Point[]
  /** 週ごとに調整した目標（各週末の目標体重を結んだ折れ線） */
  adjusted: Point[]
  /** 実績 */
  actual: Point[]
  startX: number
  endX: number
}

/** 各点について、その日までの days 日間の記録を平均した点を返す（日々のぶれをならす） */
export function movingAverage(points: Point[], days = 7): Point[] {
  return points.map((p) => {
    const window = points.filter((q) => q.x <= p.x && q.x > p.x - days)
    return { x: p.x, y: window.reduce((s, q) => s + q.y, 0) / window.length }
  })
}

export function chartLines(goal: Goal, weights: WeightEntry[], today: string): ChartLines {
  const plan = computePlan(goal, weights, today)
  const startX = toDayNum(goal.startDate)
  const endX = toDayNum(goal.endDate)

  const adjusted: Point[] = [{ x: startX, y: goal.startWeight }]
  for (const w of plan.weeks) {
    adjusted.push({ x: toDayNum(w.endDate) + 1, y: w.targetWeight })
  }
  const last = adjusted[adjusted.length - 1]
  if (last.x < endX) {
    // 最後に調整した週末から、ゴールまでの残りの計画
    adjusted.push({ x: endX, y: plan.targetWeight })
  }

  const actual = weights
    .filter((w) => w.date >= goal.startDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({ x: toDayNum(w.date), y: w.weight }))

  return {
    planned: [
      { x: startX, y: goal.startWeight },
      { x: endX, y: plan.targetWeight },
    ],
    adjusted,
    actual,
    startX,
    endX,
  }
}
