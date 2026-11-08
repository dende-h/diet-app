import Anthropic from '@anthropic-ai/sdk'
import type { CalorieEstimate } from '../shared/calc'

// 写真からカロリーの数字だけを出す。フィードバックは書かせず、出力をJSONに絞ってコストを抑える。
// 料理の見分けと量の見積もりには Sonnet で十分なので、Opus の半額で済むこちらを使う
const MODEL = 'claude-sonnet-5-5'

const SYSTEM = `あなたは食事の写真からカロリーを見積もる栄養計算のアシスタントです。
- 写真に写っている料理・飲み物ごとに、写っている量でのカロリー(kcal)を見積もる。
- 量が分かりにくいときは、日本の一般的な1人前を基準にする。
- 料理名は短い日本語にする（例: 親子丼、味噌汁）。
- 食べ物や飲み物が写っていなければ items を空にする。`

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kcal: { type: 'integer' },
        },
        required: ['name', 'kcal'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

/** 写真のカロリーを見積もる。食べ物が写っていなければ items が空で kcal が 0 */
export async function estimateCalories(apiKey: string, data: string, mediaType: ImageType): Promise<CalorieEstimate> {
  const client = new Anthropic({ apiKey })
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: 'この写真の食事のカロリーを見積もってください。' },
        ],
      },
    ],
  })
  if (response.stop_reason === 'refusal') {
    throw new Error(`estimate refused: ${response.stop_details?.category ?? 'unknown'}`)
  }
  if (response.stop_reason === 'max_tokens') throw new Error('estimate was cut off (max_tokens)')

  const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
  const parsed = JSON.parse(text) as { items: { name: string; kcal: number }[] }
  const items = parsed.items
    .map((i) => ({ name: i.name.trim(), kcal: Math.round(i.kcal) }))
    .filter((i) => i.name && i.kcal > 0 && i.kcal < 10000)
  const kcal = items.reduce((sum, i) => sum + i.kcal, 0)
  return { kcal, label: items.map((i) => i.name).join('・').slice(0, 40), items }
}
