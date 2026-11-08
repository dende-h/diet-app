import { useEffect, useRef, useState } from 'react'
import type { Point } from '../../shared/calc'
import { formatTick, xTicks, yTicks } from '../../shared/ticks'

export interface Series {
  key: string
  points: Point[]
  className: string
  /** 最後の点に丸を付ける */
  endDot?: boolean
}

export interface Marker {
  x: number
  y: number
  label: string
  /** ラベルを点の上と下のどちらに置くか */
  place: 'above' | 'below'
}

interface Props {
  series: Series[]
  xMin: number
  xMax: number
  /** 日付の目盛りの基準（目標の開始日）。週ごとの目盛りがこの日から7日おきになる */
  xAnchor: number
  today: number
  markers: Marker[]
  /** 縦軸の数値を、この値からの増減で表示する（undefined なら体重そのもの） */
  baseline?: number
  /** 縦軸の見出し */
  yTitle: string
}

const PAD = { top: 30, right: 16, bottom: 28, left: 42 }

/** x が [xMin, xMax] に入る点と、範囲の端で線を切った位置の y を集める */
function visibleYs(points: Point[], xMin: number, xMax: number): number[] {
  const ys: number[] = []
  points.forEach((p, i) => {
    if (p.x >= xMin && p.x <= xMax) ys.push(p.y)
    const next = points[i + 1]
    if (!next) return
    for (const edge of [xMin, xMax]) {
      if ((p.x < edge && next.x > edge) || (p.x > edge && next.x < edge)) {
        ys.push(p.y + ((next.y - p.y) * (edge - p.x)) / (next.x - p.x))
      }
    }
  })
  return ys
}

/** dayNum → '11/8' */
function monthDay(x: number): string {
  const d = new Date(x * 86_400_000)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** 縦軸がkg、横軸が日付の折れ線グラフ */
export function LineChart({ series, xMin, xMax, xAnchor, today, markers, baseline, yTitle }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const ys = series.flatMap((s) => visibleYs(s.points, xMin, xMax))
  let yMin = Math.min(...ys)
  let yMax = Math.max(...ys)
  if (!Number.isFinite(yMin)) {
    yMin = 0
    yMax = 1
  }
  const span = Math.max(yMax - yMin, 1)
  yMin -= span * 0.12
  yMax += span * 0.12

  const w = Math.max(size.width - PAD.left - PAD.right, 1)
  const h = Math.max(size.height - PAD.top - PAD.bottom, 1)
  const px = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * w
  const py = (y: number) => PAD.top + ((yMax - y) / (yMax - yMin)) * h
  const path = (points: Point[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ')

  const offset = baseline ?? 0
  const yt = yTicks(yMin, yMax, Math.min(Math.max(Math.round(h / 44), 3), 7), offset)
  const xt = xTicks(xMin, xMax, Math.max(Math.floor(w / 58), 2), xAnchor)
  // 端の日付ラベルがはみ出さないよう寄せる
  const anchorAt = (x: number) => (x < PAD.left + 16 ? 'start' : x > PAD.left + w - 16 ? 'end' : 'middle')

  return (
    <div className="chart" ref={ref}>
      {size.width > 0 && (
        <svg width={size.width} height={size.height} role="img" aria-label="体重の推移と目標のグラフ">
          <defs>
            <clipPath id="plot">
              <rect x={PAD.left - 6} y={0} width={w + 12} height={size.height} />
            </clipPath>
          </defs>

          <text className="axis-title" x={8} y={16}>
            {yTitle}
          </text>

          {/* 縦軸（kg） */}
          {yt.values.map((v) => {
            const y = py(v + offset)
            return (
              <g key={v}>
                <line className={v === 0 && baseline !== undefined ? 'grid grid-base' : 'grid'} x1={PAD.left} x2={PAD.left + w} y1={y} y2={y} />
                <text className="tick" x={PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle">
                  {formatTick(v, yt.step, baseline !== undefined)}
                </text>
              </g>
            )
          })}

          {/* 横軸（日付） */}
          <line className="axis" x1={PAD.left} x2={PAD.left + w} y1={PAD.top + h} y2={PAD.top + h} />
          {xt.map((x) => (
            <g key={x}>
              <line className="grid grid-x" x1={px(x)} x2={px(x)} y1={PAD.top} y2={PAD.top + h} />
              <text className="tick" x={px(x)} y={PAD.top + h + 18} textAnchor={anchorAt(px(x))}>
                {monthDay(x)}
              </text>
            </g>
          ))}

          {today >= xMin && today <= xMax && (
            <g className="today">
              <line x1={px(today)} x2={px(today)} y1={PAD.top} y2={PAD.top + h} />
              <text
                x={px(today) + (px(today) > PAD.left + w - 32 ? -4 : 4)}
                y={PAD.top + 12}
                textAnchor={px(today) > PAD.left + w - 32 ? 'end' : 'start'}
              >
                今日
              </text>
            </g>
          )}

          <g clipPath="url(#plot)">
            {series.map((s) => {
              const last = s.points.at(-1)
              return (
                <g key={s.key} className={s.className}>
                  {s.points.length > 1 && <path d={path(s.points)} />}
                  {s.endDot && last && last.x >= xMin && last.x <= xMax && (
                    <circle cx={px(last.x)} cy={py(last.y)} r={4.5} />
                  )}
                </g>
              )
            })}
          </g>

          {markers
            .filter((m) => m.x >= xMin && m.x <= xMax)
            .map((m) => {
              const x = px(m.x)
              const y = py(m.y)
              return (
                <g key={m.label} className="marker">
                  <circle cx={x} cy={y} r={3.5} />
                  <text x={x} y={m.place === 'above' ? y - 10 : y + 18} textAnchor={anchorAt(x)}>
                    {m.label}
                  </text>
                </g>
              )
            })}
        </svg>
      )}
    </div>
  )
}
