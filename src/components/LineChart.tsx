import { useEffect, useRef, useState } from 'react'
import type { Point } from '../../shared/calc'

export interface Series {
  key: string
  points: Point[]
  className: string
  /** 最後の点に丸を付ける */
  endDot?: boolean
}

export interface Marker {
  x: number
  y?: number
  label: string
}

interface Props {
  series: Series[]
  xMin: number
  xMax: number
  today: number
  markers: Marker[]
}

const PAD = { top: 28, right: 20, bottom: 28, left: 20 }

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

/** 数値ラベルを一切出さない、線だけの折れ線グラフ */
export function LineChart({ series, xMin, xMax, today, markers }: Props) {
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

  return (
    <div className="chart" ref={ref}>
      {size.width > 0 && (
        <svg width={size.width} height={size.height} role="img" aria-label="体重の推移と目標のグラフ">
          <defs>
            <clipPath id="plot">
              <rect x={PAD.left - 6} y={0} width={w + 12} height={size.height} />
            </clipPath>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} className="grid" x1={PAD.left} x2={PAD.left + w} y1={PAD.top + (h * i) / 4} y2={PAD.top + (h * i) / 4} />
          ))}
          {today >= xMin && today <= xMax && (
            <g className="today">
              <line x1={px(today)} x2={px(today)} y1={PAD.top - 8} y2={PAD.top + h} />
              <text x={px(today)} y={PAD.top - 12} textAnchor="middle">
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
              const anchor = x < PAD.left + 30 ? 'start' : x > PAD.left + w - 30 ? 'end' : 'middle'
              return (
                <g key={m.label} className="marker">
                  {m.y !== undefined && <circle cx={x} cy={py(m.y)} r={3.5} />}
                  <text x={x} y={PAD.top + h + 20} textAnchor={anchor}>
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
