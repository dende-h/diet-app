import { useState } from 'react'
import { chartLines, movingAverage, toDayNum } from '../../shared/calc'
import { LineChart } from '../components/LineChart'
import { useStore } from '../store'

type Range = 'all' | 'recent'

export function Graph({ today }: { today: string }) {
  const { data } = useStore()
  const { goal, weights } = data!
  const [range, setRange] = useState<Range>('all')
  const lines = chartLines(goal!, weights, today)
  const todayX = toDayNum(today)

  let xMin = lines.startX
  let xMax = lines.endX
  if (range === 'recent') {
    xMin = Math.max(lines.startX, todayX - 21)
    xMax = Math.min(lines.endX, Math.max(todayX + 7, xMin + 14))
  }

  return (
    <div className="graph">
      <header className="graph-header">
        <h1>グラフ</h1>
        <div className="segmented" role="tablist">
          {(['all', 'recent'] as const).map((r) => (
            <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
              {r === 'all' ? '全期間' : '直近4週'}
            </button>
          ))}
        </div>
      </header>
      <LineChart
        xMin={xMin}
        xMax={xMax}
        today={todayX}
        series={[
          { key: 'planned', points: lines.planned, className: 'line-planned' },
          { key: 'adjusted', points: lines.adjusted, className: 'line-adjusted' },
          { key: 'daily', points: lines.actual, className: 'line-daily' },
          { key: 'actual', points: movingAverage(lines.actual), className: 'line-actual', endDot: true },
        ]}
        markers={[
          { x: lines.startX, y: lines.planned[0].y, label: 'スタート' },
          { x: lines.endX, y: lines.planned[1].y, label: 'ゴール' },
        ]}
      />
      <ul className="legend">
        <li>
          <span className="swatch line-actual" />
          実績（7日平均）
        </li>
        <li>
          <span className="swatch line-daily" />
          毎日の記録
        </li>
        <li>
          <span className="swatch line-adjusted" />
          目標（毎週調整）
        </li>
        <li>
          <span className="swatch line-planned" />
          当初の計画
        </li>
      </ul>
    </div>
  )
}
