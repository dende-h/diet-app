import { describe, expect, it } from 'vitest'
import { formatTick, xTicks, yTicks } from './ticks'
import { toDayNum } from './calc'

describe('yTicks', () => {
  it('picks a round step that fits the number of ticks', () => {
    expect(yTicks(57.3, 62.6, 6)).toEqual({ step: 1, values: [58, 59, 60, 61, 62] })
    expect(yTicks(60.1, 61.2, 6)).toEqual({ step: 0.2, values: [60.2, 60.4, 60.6, 60.8, 61, 61.2] })
  })

  it('makes the values round relative to an offset', () => {
    // 開始体重 62.3kg からの増減
    expect(yTicks(57.0, 63.0, 4, 62.3)).toEqual({ step: 2, values: [-4, -2, 0] })
  })
})

describe('xTicks', () => {
  const start = toDayNum('2026-01-01')

  it('places weekly ticks on the goal weeks', () => {
    expect(xTicks(start, start + 84, 4, start)).toEqual([start, start + 28, start + 56, start + 84])
    expect(xTicks(start, start + 84, 6, start)).toHaveLength(7)
    expect(xTicks(start + 10, start + 30, 4, start)).toEqual([start + 14, start + 21, start + 28])
  })

  it('uses daily ticks for a short range', () => {
    expect(xTicks(start, start + 4, 6, start)).toEqual([start, start + 1, start + 2, start + 3, start + 4])
  })
})

describe('formatTick', () => {
  it('formats changes with a sign', () => {
    expect(formatTick(-2, 1, true)).toBe('−2')
    expect(formatTick(1, 1, true)).toBe('+1')
    expect(formatTick(0, 1, true)).toBe('0')
    expect(formatTick(-0.5, 0.5, true)).toBe('−0.5')
  })

  it('formats absolute weights without a sign', () => {
    expect(formatTick(62, 1, false)).toBe('62')
    expect(formatTick(60.4, 0.2, false)).toBe('60.4')
  })
})
