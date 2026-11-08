import { describe, expect, it } from 'vitest'
import type { UserData } from '../shared/calc'
import { buildReport } from './feedback'

const data: UserData = {
  profile: { sex: 'female', birthYear: 1992, heightCm: 158, activity: 1.375 },
  goal: { startDate: '2026-10-01', endDate: '2026-12-24', startWeight: 62, lossKg: 5 },
  weights: [
    { date: '2026-10-22', slot: 'morning', weight: 60.6 },
    { date: '2026-10-29', slot: 'evening', weight: 61.1 },
    { date: '2026-10-29', slot: 'morning', weight: 60.4 },
    { date: '2026-10-30', slot: 'morning', weight: 60.2 },
  ],
  intakes: [
    { id: 1, date: '2026-10-29', kcal: 900, label: '夕食' },
    { id: 2, date: '2026-10-29', kcal: 550, label: '昼食' },
  ],
}

describe('buildReport', () => {
  const report = buildReport(data, '2026-10-30', 'morning')

  it('summarizes the goal and the current week', () => {
    expect(report).toContain('目標: 2026-10-01 開始時 62.0kg → 2026-12-24 に 57.0kg')
    expect(report).toContain('今週（第5週 10/29〜11/4）')
  })

  it('names the weigh-in that triggered the feedback', () => {
    expect(report).toContain('今回の記録: 朝の体重 60.2kg')
    expect(report).toContain('今日の体重: 朝 60.2kg')
  })

  it('lists morning and evening weights per day', () => {
    expect(report).toContain('10/29 朝 60.4kg / 夜 61.1kg')
  })

  it('reports yesterday against the border', () => {
    expect(report).toMatch(/10\/29（昨日）: 1,450kcal（ボーダー比 [+-]\d+）/)
    expect(report).toContain('10/28: 記録なし')
    expect(report).toContain('今日ここまで: 記録なし')
  })

  it('reports an evening weigh-in', () => {
    const evening = buildReport(
      { ...data, weights: [...data.weights, { date: '2026-10-30', slot: 'evening', weight: 60.9 }] },
      '2026-10-30',
      'evening',
    )
    expect(evening).toContain('今回の記録: 夜の体重 60.9kg')
    expect(evening).toContain('今日の体重: 朝 60.2kg / 夜 60.9kg')
  })

  it('requires profile and goal', () => {
    expect(() => buildReport({ ...data, goal: null }, '2026-10-30', 'morning')).toThrow()
  })
})
