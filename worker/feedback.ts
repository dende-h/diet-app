import Anthropic from '@anthropic-ai/sdk'
import {
  ACTIVITY_LEVELS,
  addDays,
  calorieTarget,
  computePlan,
  intakeTotal,
  weightAsOf,
  type UserData,
} from '../shared/calc'

const MODEL = 'claude-opus-5-5'

const SYSTEM = `あなたは減量に取り組む人を毎日励ますパーソナルコーチです。
ユーザーは毎日アプリを開いたときに、あなたからのフィードバックを1つ受け取ります。

書き方:
- 日本語で200〜300字程度。見出しや箇条書き記号、Markdownは使わず、短い段落の平文で書く。
- 前日の摂取カロリーの振り返り → 体重の流れと今週の目標への進み具合 → 今日やると良い具体的な行動を1つ、の順に。
- 体重は日々の水分などで上下するので、1日の増減より数日〜1週間の流れを見る。
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

/** AIに渡すその日時点のデータの要約 */
export function buildReport(data: UserData, today: string): string {
  const { profile, goal, weights, intakes } = data
  if (!profile || !goal) throw new Error('profile and goal are required')

  const plan = computePlan(goal, weights, today)
  const latest = weightAsOf(weights, today, goal.startWeight)
  const target = calorieTarget(profile, latest, today)
  const activity = ACTIVITY_LEVELS.find((a) => a.value === profile.activity)?.label ?? String(profile.activity)
  const lines: string[] = []

  lines.push(`今日: ${today}`)
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
  const latestEntry = weights.filter((w) => w.date <= today).at(-1)
  lines.push(latestEntry ? `最新体重: ${latestEntry.weight.toFixed(1)}kg（${md(latestEntry.date)}）` : '体重の記録はまだありません。')
  lines.push(
    `摂取ボーダー（維持カロリーの75%）: ${kcal(target.border)}（維持カロリー ${kcal(target.maintenance)}、基礎代謝 ${kcal(target.bmr)}）`,
  )

  lines.push('', '直近14日の体重（記録なしの日は省略）:')
  const from = addDays(today, -13)
  const recentWeights = weights.filter((w) => w.date >= from && w.date <= today)
  if (recentWeights.length === 0) lines.push('記録なし')
  for (const w of recentWeights) lines.push(`${md(w.date)} ${w.weight.toFixed(1)}kg`)

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
  if (todayTotal > 0) lines.push(`今日ここまで: ${kcal(todayTotal)}`)

  return lines.join('\n')
}

export async function generateFeedback(apiKey: string, data: UserData, today: string): Promise<string> {
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
        content: `${buildReport(data, today)}\n\n上のデータをもとに、今日のフィードバックを書いてください。`,
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
