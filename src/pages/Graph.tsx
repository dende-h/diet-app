import { useState } from 'react'
import { chartLines, movingAverage, toDayNum } from '../../shared/calc'
import { LineChart } from '../components/LineChart'
import { useStore } from '../store'

type Range = 'all' | 'recent'
/** change: スタートからの増減で表示（体重そのものは出さない） / weight: 体重で表示 */
type Mode = 'change' | 'weight'

const MODE_KEY = 'herulog:graph-mode'

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'weight' ? 'weight' : 'change'
  } catch {
    return 'change'
  }
}

function kg(n: number, signed: boolean): string {
  const text = Math.abs(n).toFixed(1)
  if (Number(text) === 0) return '0.0'
  if (n < 0) return `−${text}`
  return signed ? `+${text}` : text
}

export function Graph({ today }: { today: string }) {
  const { data, daily } = useStore()
  const goal = data!.goal!
  const [range, setRange] = useState<Range>('all')
  const [mode, setModeState] = useState<Mode>(readMode)
  const lines = chartLines(goal, daily, today)
  const average = movingAverage(lines.actual)
  const todayX = toDayNum(today)
  const start = goal.startWeight
  const goalWeight = lines.planned[1].y

  const setMode = (m: Mode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // 保存できなくても表示は切り替わる
    }
  }

  let xMin = lines.startX
  let xMax = lines.endX
  if (range === 'recent') {
    xMin = Math.max(lines.startX, todayX - 21)
    xMax = Math.min(lines.endX, Math.max(todayX + 7, xMin + 14))
  }

  const now = average.at(-1)?.y

  return (
    <div className="graph">
      <header className="graph-header">
        <h1>グラフ</h1>
        <div className="segmented" role="tablist" aria-label="期間">
          {(['all', 'recent'] as const).map((r) => (
            <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
              {r === 'all' ? '全期間' : '直近4週'}
            </button>
          ))}
        </div>
      </header>

      <div className="graph-summary">
        {now === undefined ? (
          <p className="muted small">体重を記録すると実績の線が表示されます</p>
        ) : (
          <div className="small">
            <div className="muted">今（7日平均）</div>
            {mode === 'change' ? (
              <div>
                <strong className="num">{kg(now - start, true)} kg</strong>
                <span className="muted"> ゴールまであと </span>
                <strong className="num">{kg(Math.max(now - goalWeight, 0), false)} kg</strong>
              </div>
            ) : (
              <div>
                <strong className="num">{kg(now, false)} kg</strong>
                <span className="muted"> ゴール </span>
                <strong className="num">{kg(goalWeight, false)} kg</strong>
              </div>
            )}
          </div>
        )}
        <div className="segmented" role="tablist" aria-label="縦軸">
          {(['change', 'weight'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'change' ? '増減' : '体重'}
            </button>
          ))}
        </div>
      </div>

      <LineChart
        xMin={xMin}
        xMax={xMax}
        xAnchor={lines.startX}
        today={todayX}
        baseline={mode === 'change' ? start : undefined}
        yTitle={mode === 'change' ? 'スタートからの増減（kg）' : '体重（kg）'}
        series={[
          { key: 'planned', points: lines.planned, className: 'line-planned' },
          { key: 'adjusted', points: lines.adjusted, className: 'line-adjusted' },
          { key: 'daily', points: lines.actual, className: 'line-daily' },
          { key: 'actual', points: average, className: 'line-actual', endDot: true },
        ]}
        markers={[
          { x: lines.startX, y: start, label: 'スタート', place: 'above' },
          { x: lines.endX, y: goalWeight, label: 'ゴール', place: 'below' },
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
