import Anthropic from '@anthropic-ai/sdk'
import {
  ACTIVITY_LEVELS,
  addDays,
  calorieTarget,
  computePlan,
  compareRecords,
  dailyWeights,
  hasRecords,
  intakeTotal,
  weightAsOf,
  type UserData,
  type WeightRecord,
} from '../shared/calc'

// 1日数回・百数十字の文章なので、Opus の半額の Sonnet で十分
const MODEL = 'claude-sonnet-5-5'

// ひとことと振り返りの両方に入れる書き方。スマホでさっと読めるよう、短く・要点を絞る
const STYLE = `- 見出しや箇条書き記号、Markdownは使わず、平文で書く。1文を短くし、前置き・あいさつ・まとめの繰り返し・一般論は書かない。
- データの項目をすべて取り上げようとしない。今回いちばん伝えたいこと（ほめる点か、気をつける点）を1〜2つだけ選び、具体的な数字か記録の中身を添えて書く。
- 提案は1つだけ。すぐできる具体的な行動にする。`

const ENCOURAGE = `- 記録の継続・開始時からの変化・今週の目標への進み具合で目立つことがあれば、数字でほめる（節目のときほどしっかり）。
- 停滞・増加やボーダー超えが続くとき、記録が途切れたあとは、責めずにひとこと励ます。`

const CAUTIONS = `- 体重は水分などで日々上下するので、1回の増減ではなく数日〜1週間の流れで見る。量った時刻が日によって違うときは考慮する。
- 運動の消費カロリーは計算せず、運動した分だけ多く食べてよいという助言もしない。
- 記録されていない食事があるかもしれないので、合計がとても少なくても食べなさすぎと決めつけない。
- 責めたり不安をあおったりしない。極端な食事制限や無理なペースは勧めない。体調不良や医療的な判断が必要そうなら医師への相談を勧める。`

const NO_REPEAT = `- 「これまでにあなたが書いた文章」が渡されたら、同じ書き出し・言い回し・着眼点・提案を繰り返さない。前に説明したこと（体重は水分で上下する など）は省く。前に提案したことを本人が実行していたら、それに触れる。`

const SYSTEM = `あなたは減量に取り組む人に寄り添うパーソナルコーチです。
ユーザーは体重を時刻つきで1日2回まで記録し、記録するたびにあなたから短いひとことを受け取ります。
目標やボーダーの計算には、その日いちばん早い時刻の体重を使っています。

書き方:
- 日本語で80〜130字。2〜3文で書く。
${STYLE}
- 朝など食事前の記録なら、体重の流れか前日の食事のどちらかに触れ、今日の行動を1つ。昼以降や夜の記録なら、今日ここまでの摂取カロリーとボーダーの差に触れ、明日に向けた行動を1つ。体重は1日のうちに重くなっていくのが普通なので、同じ日の早い時刻との差を失敗のように扱わない。
- 食事の内容や運動の記録があれば、名前を挙げて具体的に触れる（栄養の偏りに気づいたら、責めずに次の食事の工夫として）。
${ENCOURAGE}
${CAUTIONS}
${NO_REPEAT}`

const REVIEW_SYSTEM = `あなたは減量に取り組む人に寄り添うパーソナルコーチです。
ユーザーは体重（時刻つきで1日2回まで）・食事（時刻・内容・kcal）・運動（自由記述）を記録しています。
毎朝、前の日を振り返る「昨日の振り返り」をあなたが書きます。ふつうは朝いちばんの体重を記録した直後に書き、その日の1回目の体重へのひとことの代わりになります。

書き方:
- 日本語で150〜220字。短い段落を2〜3つ。
${STYLE}
- 1つ目の段落: 振り返る日の摂取カロリーの合計とボーダーとの差を一言で伝え、食事・運動でよかった点（または気をつけたい点）を1つ、料理名や内容を挙げて書く。今朝の体重があれば、前の日とのつながりを一言で（流れで見る）。
${ENCOURAGE}
- 最後の段落で、今日の提案を1文で書く。直近7日の運動とのバランスで選んだ運動（歩く・走るが続いていれば軽い筋トレやストレッチ、強めの運動が続いていれば休養や散歩、記録がなければ短い散歩 など）か、食事の工夫のどちらか1つにする。「〜もよさそうです」くらいの押しつけない言い方にする。
${CAUTIONS}
${NO_REPEAT}`

/** 前にAIが書いた文章（同じことを繰り返さないために渡す） */
export interface PastText {
  kind: 'feedback' | 'review'
  /** ひとことは書いた日、振り返りは振り返った日 */
  date: string
  content: string
}

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

/** プロフィール・目標・今週の目標・ボーダー */
function goalLines(data: UserData, today: string): string[] {
  const { profile, goal } = data
  if (!profile || !goal) throw new Error('profile and goal are required')
  const weights = dailyWeights(data.weights)
  const plan = computePlan(goal, weights, today)
  const target = calorieTarget(profile, weightAsOf(weights, today, goal.startWeight), today)
  const activity = ACTIVITY_LEVELS.find((a) => a.value === profile.activity)?.label ?? String(profile.activity)
  const lines: string[] = []
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
  return lines
}

function recentWeightLines(records: WeightRecord[], today: string): string[] {
  const lines = ['直近14日の体重（記録なしの日は省略）:']
  const from = addDays(today, -13)
  const recentDates = [...new Set(records.filter((r) => r.date >= from && r.date <= today).map((r) => r.date))].sort()
  if (recentDates.length === 0) lines.push('記録なし')
  for (const d of recentDates) lines.push(`${md(d)} ${dayWeights(records, d)}`)
  return lines
}

/** 前の7日の摂取カロリーと、today の合計（todayLabel は「今日ここまで」など） */
function intakeLines(data: UserData, today: string, todayLabel: string): string[] {
  const { profile, goal, intakes } = data
  const weights = dailyWeights(data.weights)
  const border = (date: string) => calorieTarget(profile!, weightAsOf(weights, date, goal!.startWeight), date).border
  const lines = ['直近7日の摂取カロリー（その日の体重から計算したボーダーとの差）:']
  for (let i = 7; i >= 1; i--) {
    const date = addDays(today, -i)
    const total = intakeTotal(intakes, date)
    const label = i === 1 ? `${md(date)}（昨日）` : md(date)
    lines.push(total === 0 ? `${label}: 記録なし` : `${label}: ${kcal(total)}（ボーダー比 ${signed(total - border(date), 0)}）`)
  }
  const todayTotal = intakeTotal(intakes, today)
  lines.push(
    todayTotal > 0
      ? `${todayLabel}: ${kcal(todayTotal)}（ボーダー比 ${signed(todayTotal - border(today), 0)}）`
      : `${todayLabel}: 記録なし`,
  )
  return lines
}

function mealLines(data: UserData, days: (readonly [string, string])[]): string[] {
  const lines: string[] = []
  for (const [label, d] of days) {
    const meals = data.intakes.filter((i) => i.date === d).sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id)
    if (meals.length === 0) continue
    lines.push('', `${label}の食事:`)
    for (const m of meals) lines.push(`${m.time || '時刻不明'} ${m.label || '（内容の記録なし）'} ${kcal(m.kcal)}`)
  }
  return lines
}

function exerciseLines(data: UserData, today: string, todayLabel: string): string[] {
  const lines = ['直近7日の運動（本人の自由記述。記録がある日だけ）:']
  const recent = (data.exercises ?? []).filter((e) => e.date >= addDays(today, -6) && e.date <= today)
  if (recent.length === 0) lines.push('記録なし')
  for (const e of recent) lines.push(`${e.date === today ? `${md(e.date)}（${todayLabel}）` : md(e.date)}: ${e.text}`)
  return lines
}

/** 記録が何日続いているかと、開始時からの体重の変化（ほめる・励ます材料） */
function progressLines(data: UserData, date: string, weightDate: string): string[] {
  let streak = 0
  while (streak < 365 && hasRecords(data, addDays(date, -streak))) streak++
  let recent = 0
  for (let i = 0; i < 7; i++) if (hasRecords(data, addDays(date, -i))) recent++
  const lines = [
    `記録の継続（体重・食事・運動のどれかを記録した日）: ${md(date)}まで${streak}日連続、直近7日のうち${recent}日`,
  ]
  const goal = data.goal!
  const weights = dailyWeights(data.weights).filter((w) => w.date >= goal.startDate && w.date <= weightDate)
  const latest = weights.at(-1)
  if (latest) {
    lines.push(
      `開始時からの変化: ${signed(latest.weight - goal.startWeight, 1)}kg（${md(latest.date)}の体重。目標は -${goal.lossKg.toFixed(1)}kg）`,
    )
  }
  return lines
}

/** 前に書いた文章。新しい順に渡す */
function pastLines(past: PastText[]): string[] {
  if (past.length === 0) return []
  const lines = ['', 'これまでにあなたが書いた文章（新しい順。同じ内容や言い回しを繰り返さないための参考）:']
  for (const p of past) {
    lines.push(`[${md(p.date)}${p.kind === 'review' ? 'の振り返り' : 'の体重の記録へのひとこと'}]`, p.content)
  }
  return lines
}

/** AIに渡す、今回の記録時点のデータの要約。seq はその日の何回目の記録か */
export function buildReport(data: UserData, today: string, seq: number, past: PastText[] = []): string {
  const records = data.weights
  const current = records.find((r) => r.date === today && r.seq === seq)
  return [
    `今日: ${today}`,
    current
      ? `今回の記録: 今日${seq}回目の体重 ${current.weight.toFixed(1)}kg（${current.time}に計測）`
      : `今回の記録: 今日${seq}回目の体重（記録なし）`,
    `今日の体重: ${dayWeights(records, today) || '記録なし'}`,
    ...goalLines(data, today),
    ...progressLines(data, today, today),
    '',
    ...recentWeightLines(records, today),
    '',
    ...intakeLines(data, today, '今日ここまで'),
    ...mealLines(data, [
      ['昨日', addDays(today, -1)],
      ['今日', today],
    ]),
    '',
    ...exerciseLines(data, today, '今日'),
    ...pastLines(past),
  ].join('\n')
}

/** 朝の振り返り用に、date（ふつうは昨日）1日分の記録と、翌朝（今日）の体重を要約する */
export function buildDailyReport(data: UserData, date: string, past: PastText[] = []): string {
  const records = data.weights
  const next = addDays(date, 1)
  return [
    `振り返る日: ${date}`,
    `この日の体重: ${dayWeights(records, date) || '記録なし'}`,
    `翌日（${md(next)}、今日）の体重: ${dayWeights(records, next) || 'まだ記録なし'}`,
    // 今週の目標やボーダーは、振り返りを読む今日の時点で出す
    ...goalLines(data, next),
    ...progressLines(data, date, next),
    '',
    ...recentWeightLines(records, next),
    '',
    ...intakeLines(data, date, 'この日の合計'),
    ...mealLines(data, [['この日', date]]),
    '',
    ...exerciseLines(data, date, 'この日'),
    ...pastLines(past),
  ].join('\n')
}

async function write(apiKey: string, system: string, prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey })
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: prompt }],
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

export function generateFeedback(
  apiKey: string,
  data: UserData,
  today: string,
  seq: number,
  past: PastText[] = [],
): Promise<string> {
  return write(
    apiKey,
    SYSTEM,
    `${buildReport(data, today, seq, past)}\n\n上のデータをもとに、今回の体重の記録へのフィードバックを書いてください。`,
  )
}

/** date（ふつうは昨日）1日分の記録を振り返る「昨日の振り返り」 */
export function generateDailyReview(
  apiKey: string,
  data: UserData,
  date: string,
  past: PastText[] = [],
): Promise<string> {
  return write(
    apiKey,
    REVIEW_SYSTEM,
    `${buildDailyReport(data, date, past)}\n\n上のデータをもとに、${md(date)}の1日の振り返りを書いてください。`,
  )
}
