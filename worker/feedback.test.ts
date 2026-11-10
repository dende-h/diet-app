import { describe, expect, it } from 'vitest'
import type { UserData } from '../shared/calc'
import { buildDailyReport, buildReport } from './feedback'

const data: UserData = {
  profile: { sex: 'female', birthYear: 1992, heightCm: 158, activity: 1.375 },
  goal: { startDate: '2026-10-01', endDate: '2026-12-24', startWeight: 62, lossKg: 5 },
  weights: [
    { date: '2026-10-22', seq: 1, time: '07:00', weight: 60.6 },
    { date: '2026-10-29', seq: 1, time: '22:15', weight: 61.1 },
    { date: '2026-10-29', seq: 2, time: '06:50', weight: 60.4 },
    { date: '2026-10-30', seq: 1, time: '07:05', weight: 60.2 },
  ],
  intakes: [
    { id: 1, date: '2026-10-29', time: '19:30', kcal: 900, label: '夕食' },
    { id: 2, date: '2026-10-29', time: '', kcal: 550, label: '昼食' },
  ],
  exercises: [
    { date: '2026-10-20', text: 'old' },
    { date: '2026-10-29', text: 'walk 30min' },
  ],
}

describe('buildReport', () => {
  const report = buildReport(data, '2026-10-30', 1)

  it('summarizes the goal and the current week', () => {
    expect(report).toContain('目標: 2026-10-01 開始時 62.0kg → 2026-12-24 に 57.0kg')
    expect(report).toContain('今週（第5週 10/29〜11/4）')
  })

  it('names the weigh-in that triggered the feedback', () => {
    expect(report).toContain('今回の記録: 今日1回目の体重 60.2kg（07:05に計測）')
    expect(report).toContain('今日の体重: 07:05 60.2kg')
  })

  it('lists each day weights in time order', () => {
    expect(report).toContain('10/29 06:50 60.4kg / 22:15 61.1kg')
  })

  it('reports yesterday against the border', () => {
    expect(report).toMatch(/10\/29（昨日）: 1,450kcal（ボーダー比 [+-]\d+）/)
    expect(report).toContain('10/28: 記録なし')
    expect(report).toContain('今日ここまで: 記録なし')
  })

  it('lists yesterday meals with their times', () => {
    expect(report).toContain('昨日の食事:\n時刻不明 昼食 550kcal\n19:30 夕食 900kcal')
  })

  it('includes recent exercise notes only', () => {
    expect(report).toContain('10/29: walk 30min')
    expect(report).not.toContain('old')
  })

  it('reports a second weigh-in later in the day', () => {
    const second = buildReport(
      { ...data, weights: [...data.weights, { date: '2026-10-30', seq: 2, time: '21:40', weight: 60.9 }] },
      '2026-10-30',
      2,
    )
    expect(second).toContain('今回の記録: 今日2回目の体重 60.9kg（21:40に計測）')
    expect(second).toContain('今日の体重: 07:05 60.2kg / 21:40 60.9kg')
  })

  it('requires profile and goal', () => {
    expect(() => buildReport({ ...data, goal: null }, '2026-10-30', 1)).toThrow()
  })
})

describe('buildDailyReport', () => {
  const report = buildDailyReport(data, '2026-10-29')

  it('names the day and its weigh-ins', () => {
    expect(report).toContain('振り返る日: 2026-10-29')
    expect(report).toContain('この日の体重: 06:50 60.4kg / 22:15 61.1kg')
  })

  it('adds the next morning weight, or says it is not recorded yet', () => {
    expect(report).toContain('翌日（10/30、今日）の体重: 07:05 60.2kg')
    expect(report).toMatch(/直近14日の体重[^]*10\/30 07:05 60\.2kg/)
    expect(buildDailyReport(data, '2026-10-30')).toContain('翌日（10/31、今日）の体重: まだ記録なし')
  })

  it('totals the whole day against the border', () => {
    expect(report).toMatch(/この日の合計: 1,450kcal（ボーダー比 [+-]\d+）/)
    expect(report).toContain('この日の食事:\n時刻不明 昼食 550kcal\n19:30 夕食 900kcal')
    expect(report).not.toContain('昨日の食事')
  })

  it('marks the day exercise', () => {
    expect(report).toContain('10/29（この日）: walk 30min')
  })

  it('reports a day with no meals', () => {
    expect(buildDailyReport(data, '2026-10-30')).toContain('この日の合計: 記録なし')
  })
})
