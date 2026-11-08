// グラフの目盛りの計算

const Y_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]
const X_STEPS = [1, 2, 7, 14, 28, 56, 84, 168, 364]

export interface YTicks {
  step: number
  /** 表示上の値（offset を引いた値）。実際の y は value + offset */
  values: number[]
}

/**
 * [min, max] を最大 maxTicks 区間程度に区切る、きりのいい目盛り。
 * offset を引いた値がきりのいい数になる（開始体重からの増減で目盛りを振るときに使う）。
 */
export function yTicks(min: number, max: number, maxTicks: number, offset = 0): YTicks {
  const span = Math.max(max - min, 1e-9)
  const step = Y_STEPS.find((s) => span / s <= maxTicks) ?? Y_STEPS[Y_STEPS.length - 1]
  const values: number[] = []
  const first = Math.ceil((min - offset) / step - 1e-9)
  const last = Math.floor((max - offset) / step + 1e-9)
  for (let k = first; k <= last; k++) values.push(Number((k * step).toFixed(6)))
  return { step, values }
}

/**
 * 日付（dayNum）の目盛り。anchor（目標の開始日）から step 日ごとに置くので、
 * 1週間以上の間隔では目標の週の区切りと一致する。
 */
export function xTicks(min: number, max: number, maxTicks: number, anchor: number): number[] {
  const span = Math.max(max - min, 1)
  const step = X_STEPS.find((s) => span / s <= maxTicks) ?? X_STEPS[X_STEPS.length - 1]
  const ticks: number[] = []
  for (let x = anchor + Math.ceil((min - anchor) / step) * step; x <= max; x += step) ticks.push(x)
  return ticks
}

/** 目盛りの数値。間隔が1未満なら小数1桁。signed なら増減として +/− を付ける */
export function formatTick(value: number, step: number, signed: boolean): string {
  const text = Math.abs(value).toFixed(step < 1 ? 1 : 0)
  if (Number(text) === 0) return '0'
  if (value < 0) return `−${text}`
  return signed ? `+${text}` : text
}
