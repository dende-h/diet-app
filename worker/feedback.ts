import Anthropic from '@anthropic-ai/sdk'
import {
  ACTIVITY_LEVELS,
  addDays,
  calorieTarget,
  computePlan,
  compareRecords,
  dailyWeights,
  intakeTotal,
  weightAsOf,
  type UserData,
  type WeightRecord,
} from '../shared/calc'

// 1日2回・150〜250字の励ましなので、Opus の半額の Sonnet で十分
const MODEL = 'claude-sonnet-5-5'

const SYSTEM = `あなたは減量に取り組む人に寄り添うパーソナルコーチです。
ユーザーは体重を時刻つきで1日2回まで記録します。記録するたびに、あなたからのフィードバックを1つ受け取ります（1日最大2回）。
目標やボーダーの計算には、その日いちばん早い時刻の体重を使っています。

書き方:
- 日本語で150〜250字程度。見出しや箇条書き記号、Markdownは使わず、短い段落の平文で書く。
- 記録の時刻とその日の何回目かを見て、内容を変える。
- 朝など、その日の食事前の記録: 体重と数日〜1週間の流れ、今週の目標への進み具合、前日の摂取カロリーの振り返り、今日の食事で意識すると良い具体的な行動を1つ。
- 昼以降や夜の記録: 今日ここまでの摂取カロリーとボーダーの差、同じ日の先の記録からの変化、明日に向けてできる具体的な行動を1つ。体重は食事や水分で1日のうちに重くなっていくのが普通なので、同じ日の早い時刻との差を失敗のように扱わない。
- 体重は日々の水分などで上下するので、1回の増減より数日〜1週間の流れを見る。日によって量った時刻が違うときは、その違いも考慮する。
- 運動の記録（自由記述）があれば、内容に具体的に触れる。運動の消費カロリーは計算せず、摂取ボーダーを運動の分だけ増やすような助言もしない。
- 食事の時刻が分かるときは、遅い時間の食事や間隔なども必要に応じて考慮する。
- 食事の内容（本人が書いたもの、または写真から推定した料理名）があれば、具体的に触れる。量や栄養の偏り（たんぱく質・野菜が少ない、揚げ物が続く など）に気づいたら、責めずに次の食事で取り入れやすい工夫として伝える。
- 責めたり不安をあおったりしない。うまくいった点は具体的に褒める。
- 記録がない日は、記録すると振り返りやすくなる、と軽く促す程度にする。
- 極端な食事制限や無理なペースは勧めない。体調不良や医療的な判断が必要そうなら医師への相談を勧める。`

function md(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
}

function kcal(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')}kcal`
}

function signed(n: number, digits: number): string {
  const s = n.toFixed(digits)
  return n > 0 ? `+${s}` : s
}

/** '07:10 60.2kg / 21:30 60.9kg' のように、その日の記録を時刻順に並べる */
function dayWeights(records: WeightRecord[], date: string): string {
  return records
    .filter((r) => r.date === date)
    .sort(compareRecords)
    .map((r) => `${r.time} ${r.weight.toFixed(1)}kg`)
    .join(' / ')
}

/** AIに渡す、今回の記録時点のデータの要約。seq はその日の何回目の記録か */
export function buildReport(data: UserData, today: string, seq: number): string {
  const { profile, goal, weights: records, intakes } = data
  if (!profile || !goal) throw new Error('profile and goal are required')

  const weights = dailyWeights(records)
  const plan = computePlan(goal, weights, today)
  const latest = weightAsOf(weights, today, goal.startWeight)
  const target = calorieTarget(profile, latest, today)
  const activity = ACTIVITY_LEVELS.find((a) => a.value === profile.activity)?.label ?? String(profile.activity)
  const current = records.find((r) => r.date === today && r.seq === seq)
  const lines: string[] = []

  lines.push(`今日: ${today}`)
  lines.push(
    current
      ? `今回の記録: 今日${seq}回目の体重 ${current.weight.toFixed(1)}kg（${current.time}に計測）`
      : `今回の記録: 今日${seq}回目の体重（記録なし）`,
  )
  lines.push(`今日の体重: ${dayWeights(records, today) || '記録なし'}`)
  lines.push(
    `プロフィール: ${profile.sex === 'male' ? '男性' : '女性'} / ${Number(today.slice(0, 4)) - profile.birthYear}歳 / 身長${profile.heightCm}cm / 活動レベル: ${activity}`,
  )
  lines.push(
    `目標: ${goal.startDate} 開始時 ${goal.startWeight.toFixed(1)}kg → ${goal.endDate} に ${plan.targetWeight.toFixed(1)}kg（-${goal.lossKg.toFixed(1)}kg、全${plan.totalWeeks.toFixed(1)}週）`,
  )
  lines.push(`当初の週あたり目標: -${plan.initialWeeklyLoss.toFixed(2)}kg`)
  if (plan.phase === 'before') {
    lines.push('まだ目標期間の開始前です。')
  } else if (plan.phase === 'finished') {
    lines.push('目標期間は終了しています。')
  } else if (plan.current) {
    const w = plan.current
    lines.push(
      `今週（第${w.index + 1}週 ${md(w.startDate)}〜${md(w.endDate)}）: 週初めの基準体重 ${w.refWeight.toFixed(1)}kg、今週の目標 -${w.targetLoss.toFixed(2)}kg（週末に ${w.targetWeight.toFixed(1)}kg）`,
    )
  }
  lines.push(
    `摂取ボーダー（維持カロリーの75%）: ${kcal(target.border)}（維持カロリー ${kcal(target.maintenance)}、基礎代謝 ${kcal(target.bmr)}）`,
  )
  lines.push('目標やボーダーの計算には、その日いちばん早い時刻の体重を使っています。')

  lines.push('', '直近14日の体重（記録なしの日は省略）:')
  const from = addDays(today, -13)
  const recentDates = [...new Set(records.filter((r) => r.date >= from && r.date <= today).map((r) => r.date))].sort()
  if (recentDates.length === 0) lines.push('記録なし')
  for (const d of recentDates) lines.push(`${md(d)} ${dayWeights(records, d)}`)

  lines.push('', '直近7日の摂取カロリー（その日の体重から計算したボーダーとの差）:')
  for (let i = 7; i >= 1; i--) {
    const date = addDays(today, -i)
    const total = intakeTotal(intakes, date)
    const label = i === 1 ? `${md(date)}（昨日）` : md(date)
    if (total === 0) {
      lines.push(`${label}: 記録なし`)
      continue
    }
    const border = calorieTarget(profile, weightAsOf(weights, date, goal.startWeight), date).border
    lines.push(`${label}: ${kcal(total)}（ボーダー比 ${signed(total - border, 0)}）`)
  }
  const todayTotal = intakeTotal(intakes, today)
  lines.push(
    todayTotal > 0
      ? `今日ここまで: ${kcal(todayTotal)}（ボーダー比 ${signed(todayTotal - target.border, 0)}）`
      : '今日ここまで: 記録なし',
  )

  for (const [label, d] of [
    ['昨日', addDays(today, -1)],
    ['今日', today],
  ] as const) {
    const meals = intakes.filter((i) => i.date === d).sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id)
    if (meals.length === 0) continue
    lines.push('', `${label}の食事:`)
    for (const m of meals) lines.push(`${m.time || '時刻不明'} ${m.label || '（内容の記録なし）'} ${kcal(m.kcal)}`)
  }

  lines.push('', '直近7日の運動（本人の自由記述。記録がある日だけ）:')
  const recentExercises = (data.exercises ?? []).filter((e) => e.date >= addDays(today, -6) && e.date <= today)
  if (recentExercises.length === 0) lines.push('記録なし')
  for (const e of recentExercises) lines.push(`${e.date === today ? `${md(e.date)}（今日）` : md(e.date)}: ${e.text}`)

  return lines.join('\n')
}

export async function generateFeedback(apiKey: string, data: UserData, today: string, seq: number): Promise<string> {
  const client = new Anthropic({ apiKey })
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${buildReport(data, today, seq)}\n\n上のデータをもとに、今回の体重の記録へのフィードバックを書いてください。`,
      },
    ],
  })
  if (response.stop_reason === 'refusal') {
    throw new Error(`feedback refused: ${response.stop_details?.category ?? 'unknown'}`)
  }
  const text = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim()
  if (!text) throw new Error(`empty feedback (stop_reason: ${response.stop_reason})`)
  return text
}
