import { useState, type FormEvent } from 'react'
import {
  addDays,
  calorieTarget,
  computePlan,
  intakeTotal,
  toDayNum,
  weightAsOf,
  type Plan,
} from '../../shared/calc'
import { formatDate, formatKcal, type Feedback } from '../lib'
import { useStore } from '../store'

interface Props {
  date: string
  setDate: (date: string) => void
  today: string
  feedback: Feedback
}

export function Home({ date, setDate, today, feedback }: Props) {
  const { data } = useStore()
  const { profile, goal, weights, intakes } = data!
  const weight = weightAsOf(weights, date, goal!.startWeight)
  const target = calorieTarget(profile!, weight, date)
  const plan = computePlan(goal!, weights, today)

  return (
    <>
      <header className="date-nav">
        <button className="icon-button" onClick={() => setDate(addDays(date, -1))} aria-label="前の日">
          ‹
        </button>
        <h1>{date === today ? `今日 ${formatDate(date)}` : formatDate(date)}</h1>
        <button
          className="icon-button"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= today}
          aria-label="次の日"
        >
          ›
        </button>
      </header>

      {date === today && <FeedbackCard feedback={feedback} />}

      <CalorieCard date={date} border={target.border} maintenance={target.maintenance} total={intakeTotal(intakes, date)} />
      <WeightCard key={date} date={date} saved={weights.find((w) => w.date === date)?.weight} />
      <WeekCard plan={plan} weight={weightAsOf(weights, today, goal!.startWeight)} />
    </>
  )
}

function FeedbackCard({ feedback }: { feedback: Feedback }) {
  if (feedback.status === 'idle' || feedback.status === 'unavailable') return null
  return (
    <section className="card feedback">
      <div className="card-title">今日のひとこと</div>
      {feedback.status === 'loading' && <p className="muted">AIがフィードバックを書いています…</p>}
      {feedback.status === 'done' && <p className="feedback-text">{feedback.content}</p>}
      {feedback.status === 'error' && (
        <p className="muted">
          フィードバックを取得できませんでした。
          <button className="link-button" onClick={feedback.retry}>
            もう一度
          </button>
        </p>
      )}
    </section>
  )
}

const MEAL_LABELS = ['朝食', '昼食', '夕食', '間食']

function defaultLabel(): string {
  const h = new Date().getHours()
  if (h < 10) return '朝食'
  if (h < 15) return '昼食'
  if (h < 17) return '間食'
  return '夕食'
}

function CalorieCard({ date, border, maintenance, total }: { date: string; border: number; maintenance: number; total: number }) {
  const { data, addIntake, deleteIntake } = useStore()
  const entries = data!.intakes.filter((i) => i.date === date)
  const [label, setLabel] = useState(defaultLabel)
  const [kcal, setKcal] = useState('')
  const [busy, setBusy] = useState(false)
  const remaining = border - total
  const over = remaining < 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = Number(kcal)
    if (!Number.isFinite(value) || value <= 0) return
    setBusy(true)
    try {
      await addIntake(date, value, label)
      setKcal('')
    } catch {
      alert('保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-title">摂取カロリー</div>
      <div className={over ? 'big over' : 'big ok'}>
        {over ? (
          <>
            <small>ボーダーを</small> {formatKcal(-remaining)}
            <small> kcal オーバー</small>
          </>
        ) : (
          <>
            <small>あと</small> {formatKcal(remaining)}
            <small> kcal</small>
          </>
        )}
      </div>
      <div className="meter" aria-hidden="true">
        <div className={over ? 'meter-fill over' : 'meter-fill'} style={{ width: `${Math.min(total / border, 1) * 100}%` }} />
      </div>
      <p className="muted small">
        摂取 {formatKcal(total)} / ボーダー {formatKcal(border)} kcal（維持 {formatKcal(maintenance)} kcal の75%）
      </p>

      {entries.length > 0 && (
        <ul className="entries">
          {entries.map((i) => (
            <li key={i.id}>
              <span>{i.label || '食事'}</span>
              <span className="num">{formatKcal(i.kcal)} kcal</span>
              <button
                className="icon-button small"
                aria-label={`${i.label} ${i.kcal}kcal を削除`}
                onClick={() => {
                  if (confirm(`${i.label || '食事'} ${i.kcal} kcal を削除しますか？`)) void deleteIntake(i.id)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="intake-form" onSubmit={submit}>
        <div className="chips">
          {MEAL_LABELS.map((l) => (
            <button type="button" key={l} className={l === label ? 'chip active' : 'chip'} onClick={() => setLabel(l)}>
              {l}
            </button>
          ))}
        </div>
        <div className="input-row">
          <input
            type="number"
            inputMode="numeric"
            placeholder="kcal"
            min={1}
            max={10000}
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
            aria-label="摂取カロリー"
          />
          <button className="button" disabled={busy || !kcal}>
            追加
          </button>
        </div>
      </form>
    </section>
  )
}

function WeightCard({ date, saved }: { date: string; saved: number | undefined }) {
  const { saveWeight, deleteWeight } = useStore()
  const [value, setValue] = useState(saved?.toFixed(1) ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = value !== (saved?.toFixed(1) ?? '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const w = Number(value)
    if (!Number.isFinite(w) || w < 20 || w > 300) return
    setBusy(true)
    try {
      await saveWeight(date, Math.round(w * 10) / 10)
      setValue((Math.round(w * 10) / 10).toFixed(1))
    } catch {
      alert('保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-title">体重</div>
      <form className="input-row" onSubmit={submit}>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="例: 62.4"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="体重(kg)"
        />
        <span className="unit">kg</span>
        <button className="button" disabled={busy || !value || !dirty}>
          {saved === undefined ? '記録' : '更新'}
        </button>
      </form>
      {saved !== undefined && !dirty && (
        <p className="muted small">
          記録済み
          <button
            className="link-button"
            onClick={() => {
              if (confirm('この日の体重を削除しますか？')) {
                void deleteWeight(date)
                setValue('')
              }
            }}
          >
            削除
          </button>
        </p>
      )}
    </section>
  )
}

function WeekCard({ plan, weight }: { plan: Plan; weight: number }) {
  if (plan.phase === 'before') {
    return (
      <section className="card">
        <div className="card-title">今週の目標</div>
        <p className="muted">目標期間はまだ始まっていません。</p>
      </section>
    )
  }
  if (plan.phase === 'finished' || !plan.current) {
    return (
      <section className="card">
        <div className="card-title">今週の目標</div>
        <p className="muted">目標期間が終わりました。おつかれさまでした！ 設定から新しい目標を作れます。</p>
      </section>
    )
  }

  const w = plan.current
  const days = toDayNum(w.endDate) - toDayNum(w.startDate) + 1
  // 1週間あたり体重の1%を超える減量ペースは速すぎるとされる
  const fast = (w.targetLoss * 7) / days > weight * 0.01

  return (
    <section className="card">
      <div className="card-title">
        今週の目標 <span className="muted small">第{w.index + 1}週 / 全{Math.ceil(plan.totalWeeks)}週</span>
      </div>
      {w.targetLoss === 0 ? (
        <p className="big ok">
          <small>目標体重に到達！ キープしましょう</small>
        </p>
      ) : (
        <p className="big">
          −{w.targetLoss.toFixed(2)}
          <small> kg</small>
        </p>
      )}
      <p className="muted small">
        {formatDate(w.startDate)}〜{formatDate(w.endDate)}・週末の目標 {w.targetWeight.toFixed(1)} kg
        <br />
        当初の計画では週 −{plan.initialWeeklyLoss.toFixed(2)} kg。毎週の体重から残りを割り直しています。
      </p>
      {fast && <p className="warning small">ペースが速めです。無理をせず、期間の延長も検討してください。</p>}
    </section>
  )
}
