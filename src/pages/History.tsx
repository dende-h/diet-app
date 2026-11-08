import { useState } from 'react'
import { addDays, calorieTarget, compareRecords, intakeTotal, weightAsOf } from '../../shared/calc'
import { formatDate, formatKcal } from '../lib'
import { useStore } from '../store'

const PAGE = 30

export function History({ today, onSelect }: { today: string; onSelect: (date: string) => void }) {
  const { data, daily } = useStore()
  const { profile, goal, weights, intakes } = data!
  const [count, setCount] = useState(PAGE)

  // 記録または目標の開始日のうち、最も古い日まで遡れる
  const earliest = [goal!.startDate, ...weights.map((w) => w.date), ...intakes.map((i) => i.date)].sort()[0]
  const dates: string[] = []
  for (let d = today; d >= earliest && dates.length < count; d = addDays(d, -1)) dates.push(d)
  const hasMore = dates.length === count && addDays(dates[dates.length - 1], -1) >= earliest

  return (
    <>
      <header className="page-header">
        <h1>履歴</h1>
        <p className="muted small">日付をタップすると、その日の記録を見たり追加したりできます</p>
      </header>
      <ul className="history">
        {dates.map((date) => {
          const dayWeights = weights.filter((w) => w.date === date).sort(compareRecords)
          const total = intakeTotal(intakes, date)
          const border = calorieTarget(profile!, weightAsOf(daily, date, goal!.startWeight), date).border
          const diff = total - border
          return (
            <li key={date}>
              <button onClick={() => onSelect(date)}>
                <span className="history-date">{formatDate(date)}</span>
                <span className="history-weight num">
                  {dayWeights.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    dayWeights.map((w) => (
                      <span key={w.seq}>
                        <span className="muted small">{w.time} </span>
                        {w.weight.toFixed(1)}
                      </span>
                    ))
                  )}
                </span>
                <span className="history-kcal num">
                  {total === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      {formatKcal(total)} kcal
                      <span className={diff > 0 ? 'badge over' : 'badge ok'}>
                        {diff > 0 ? '+' : '−'}
                        {formatKcal(Math.abs(diff))}
                      </span>
                    </>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {hasMore && (
        <button className="button secondary wide" onClick={() => setCount((c) => c + PAGE)}>
          もっと見る
        </button>
      )}
    </>
  )
}
