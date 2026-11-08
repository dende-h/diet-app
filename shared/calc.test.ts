import { describe, expect, it } from 'vitest'
import {
  addDays,
  bmr,
  calorieTarget,
  chartLines,
  computePlan,
  dailyWeights,
  isValidDate,
  movingAverage,
  refWeightAt,
  weightAsOf,
  type Goal,
  type Profile,
} from './calc'

const profile: Profile = { sex: 'male', birthYear: 1990, heightCm: 170, activity: 1.2 }
// 2026-01-01開始、12週間で6kg減 → 週0.5kg
const goal: Goal = { startDate: '2026-01-01', endDate: '2026-03-26', startWeight: 80, lossKg: 6 }

describe('dates', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('validates dates', () => {
    expect(isValidDate('2026-02-28')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('2026-2-1')).toBe(false)
  })
})

describe('calories', () => {
  it('computes Mifflin-St Jeor BMR', () => {
    // 10*70 + 6.25*170 - 5*36 + 5 = 1587.5
    expect(bmr(profile, 70, '2026-05-01')).toBeCloseTo(1587.5)
    expect(bmr({ ...profile, sex: 'female' }, 70, '2026-05-01')).toBeCloseTo(1421.5)
  })
  it('uses 75% of maintenance as the border', () => {
    const t = calorieTarget(profile, 70, '2026-05-01')
    expect(t.maintenance).toBe(Math.round(1587.5 * 1.2))
    expect(t.border).toBe(Math.round(1587.5 * 1.2 * 0.75))
  })
  it('picks the latest weight on or before the date', () => {
    const ws = [
      { date: '2026-01-02', weight: 79 },
      { date: '2026-01-05', weight: 78.5 },
    ]
    expect(weightAsOf(ws, '2026-01-04', 80)).toBe(79)
    expect(weightAsOf(ws, '2026-01-01', 80)).toBe(80)
  })
})

describe('weekly plan', () => {
  it('starts with an even weekly loss', () => {
    const plan = computePlan(goal, [], '2026-01-03')
    expect(plan.totalWeeks).toBe(12)
    expect(plan.initialWeeklyLoss).toBeCloseTo(0.5)
    expect(plan.current?.index).toBe(0)
    expect(plan.current?.targetLoss).toBeCloseTo(0.5)
    expect(plan.phase).toBe('active')
  })

  it('raises the weekly target when behind schedule', () => {
    // 1週目終わりでも80kgのまま → 残り11週で6kg
    const ws = [{ date: '2026-01-08', weight: 80 }]
    const plan = computePlan(goal, ws, '2026-01-09')
    expect(plan.current?.index).toBe(1)
    expect(plan.current?.refWeight).toBe(80)
    expect(plan.current?.targetLoss).toBeCloseTo(6 / 11)
  })

  it('lowers the weekly target when ahead of schedule', () => {
    const ws = [{ date: '2026-01-08', weight: 78.5 }]
    const plan = computePlan(goal, ws, '2026-01-08')
    expect(plan.current?.targetLoss).toBeCloseTo(4.5 / 11)
  })

  it('averages recent weigh-ins for the reference weight', () => {
    const ws = [
      { date: '2026-01-05', weight: 79.0 },
      { date: '2026-01-07', weight: 79.4 },
      { date: '2026-01-08', weight: 78.8 },
    ]
    expect(refWeightAt(ws, '2026-01-08')).toBeCloseTo((79.0 + 79.4 + 78.8) / 3)
    expect(refWeightAt([{ date: '2026-01-01', weight: 80 }], '2026-01-08')).toBe(80)
  })

  it('targets nothing once the goal weight is reached', () => {
    const ws = [{ date: '2026-01-15', weight: 73 }]
    const plan = computePlan(goal, ws, '2026-01-15')
    expect(plan.current?.targetLoss).toBe(0)
  })

  it('handles before and after the period', () => {
    expect(computePlan(goal, [], '2025-12-31').phase).toBe('before')
    const after = computePlan(goal, [], '2026-04-01')
    expect(after.phase).toBe('finished')
    expect(after.current).toBeNull()
    expect(after.weeks).toHaveLength(12)
  })

  it('assigns the remainder to a short final week', () => {
    const g: Goal = { ...goal, endDate: '2026-01-11' } // 10日間
    const ws = [{ date: '2026-01-08', weight: 79 }]
    const plan = computePlan(g, ws, '2026-01-09')
    expect(plan.current?.endDate).toBe('2026-01-10')
    expect(plan.current?.targetWeight).toBeCloseTo(74)
  })
})

describe('chart lines', () => {
  it('smooths with a trailing moving average', () => {
    const pts = [
      { x: 0, y: 10 },
      { x: 1, y: 12 },
      { x: 8, y: 6 },
      { x: 9, y: 8 },
    ]
    expect(movingAverage(pts, 7).map((p) => p.y)).toEqual([10, 11, 6, 7])
  })

  it('connects week-end targets and ends at the goal', () => {
    const ws = [
      { date: '2026-01-01', weight: 80 },
      { date: '2026-01-08', weight: 79.8 },
    ]
    const lines = chartLines(goal, ws, '2026-01-09')
    expect(lines.planned).toHaveLength(2)
    expect(lines.adjusted[0]).toEqual({ x: lines.startX, y: 80 })
    expect(lines.adjusted.at(-1)).toEqual({ x: lines.endX, y: 74 })
    // 開始点 + 2週分の週末 + ゴール
    expect(lines.adjusted).toHaveLength(4)
    expect(lines.actual).toHaveLength(2)
  })
})

describe('dailyWeights', () => {
  it('uses the earliest weigh-in of each day', () => {
    expect(
      dailyWeights([
        // 2回目に記録したが、時刻は1回目より早い
        { date: '2026-01-02', seq: 1, time: '22:10', weight: 80.9 },
        { date: '2026-01-02', seq: 2, time: '06:45', weight: 80.1 },
        { date: '2026-01-01', seq: 1, time: '21:30', weight: 81.0 },
      ]),
    ).toEqual([
      { date: '2026-01-01', weight: 81.0 },
      { date: '2026-01-02', weight: 80.1 },
    ])
  })
})
