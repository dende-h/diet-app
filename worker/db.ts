import type { Goal, IntakeEntry, Profile, Sex, StoredFeedback, UserData, WeightRecord, WeightSlot } from '../shared/calc'

interface ProfileRow {
  sex: Sex
  birth_year: number
  height_cm: number
  activity: number
}

interface GoalRow {
  start_date: string
  end_date: string
  start_weight: number
  loss_kg: number
}

export async function loadUserData(db: D1Database, userId: string): Promise<UserData> {
  const [profile, goal, weights, intakes] = await db.batch([
    db.prepare('SELECT sex, birth_year, height_cm, activity FROM profiles WHERE user_id = ?').bind(userId),
    db
      .prepare('SELECT start_date, end_date, start_weight, loss_kg FROM goals WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .bind(userId),
    db.prepare('SELECT date, slot, weight FROM weights WHERE user_id = ? ORDER BY date, slot DESC').bind(userId),
    db.prepare('SELECT id, date, kcal, label FROM intakes WHERE user_id = ? ORDER BY date, id').bind(userId),
  ])
  const p = (profile.results as ProfileRow[])[0]
  const g = (goal.results as GoalRow[])[0]
  return {
    profile: p ? { sex: p.sex, birthYear: p.birth_year, heightCm: p.height_cm, activity: p.activity } : null,
    goal: g
      ? { startDate: g.start_date, endDate: g.end_date, startWeight: g.start_weight, lossKg: g.loss_kg }
      : null,
    weights: weights.results as unknown as WeightRecord[],
    intakes: intakes.results as unknown as IntakeEntry[],
  }
}

export async function saveProfile(db: D1Database, userId: string, p: Profile) {
  await db
    .prepare(
      `INSERT INTO profiles (user_id, sex, birth_year, height_cm, activity) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET sex = excluded.sex, birth_year = excluded.birth_year,
         height_cm = excluded.height_cm, activity = excluded.activity, updated_at = datetime('now')`,
    )
    .bind(userId, p.sex, p.birthYear, p.heightCm, p.activity)
    .run()
}

export async function saveGoal(db: D1Database, userId: string, g: Goal) {
  await db
    .prepare('INSERT INTO goals (user_id, start_date, end_date, start_weight, loss_kg) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, g.startDate, g.endDate, g.startWeight, g.lossKg)
    .run()
}

/** 体重を記録する。その枠がすでに記録済みなら何もせず false を返す（記録後は変更しない） */
export async function insertWeight(db: D1Database, userId: string, r: WeightRecord): Promise<boolean> {
  const result = await db
    .prepare(
      'INSERT INTO weights (user_id, date, slot, weight) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, date, slot) DO NOTHING',
    )
    .bind(userId, r.date, r.slot, r.weight)
    .run()
  return result.meta.changes === 1
}

export async function hasWeight(db: D1Database, userId: string, date: string, slot: WeightSlot): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM weights WHERE user_id = ? AND date = ? AND slot = ?')
    .bind(userId, date, slot)
    .first()
  return row !== null
}

export async function addIntake(db: D1Database, userId: string, date: string, kcal: number, label: string) {
  return db
    .prepare('INSERT INTO intakes (user_id, date, kcal, label) VALUES (?, ?, ?, ?) RETURNING id, date, kcal, label')
    .bind(userId, date, kcal, label)
    .first<IntakeEntry>()
}

export async function deleteIntake(db: D1Database, userId: string, id: number) {
  await db.prepare('DELETE FROM intakes WHERE user_id = ? AND id = ?').bind(userId, id).run()
}

// ---- AIフィードバック（体重を記録した枠ごとに1件） ----

export async function listFeedbacks(db: D1Database, userId: string, date: string): Promise<StoredFeedback[]> {
  const { results } = await db
    .prepare('SELECT slot, status, content FROM feedbacks WHERE user_id = ? AND date = ?')
    .bind(userId, date)
    .all<StoredFeedback>()
  return results
}

export async function getFeedback(db: D1Database, userId: string, date: string, slot: WeightSlot) {
  return db
    .prepare('SELECT slot, status, content FROM feedbacks WHERE user_id = ? AND date = ? AND slot = ?')
    .bind(userId, date, slot)
    .first<StoredFeedback>()
}

/**
 * その枠のフィードバック生成権を取る。true なら呼び出し側がAIを呼ぶ。
 * 生成途中で落ちた pending が2分以上残っていれば取り直す。
 */
export async function claimFeedback(db: D1Database, userId: string, date: string, slot: WeightSlot): Promise<boolean> {
  const inserted = await db
    .prepare(
      "INSERT INTO feedbacks (user_id, date, slot, status) VALUES (?, ?, ?, 'pending') ON CONFLICT (user_id, date, slot) DO NOTHING",
    )
    .bind(userId, date, slot)
    .run()
  if (inserted.meta.changes === 1) return true
  const stale = await db
    .prepare(
      `UPDATE feedbacks SET created_at = datetime('now')
       WHERE user_id = ? AND date = ? AND slot = ? AND status = 'pending' AND created_at < datetime('now', '-2 minutes')`,
    )
    .bind(userId, date, slot)
    .run()
  return stale.meta.changes === 1
}

export async function completeFeedback(db: D1Database, userId: string, date: string, slot: WeightSlot, content: string) {
  await db
    .prepare("UPDATE feedbacks SET content = ?, status = 'done' WHERE user_id = ? AND date = ? AND slot = ?")
    .bind(content, userId, date, slot)
    .run()
}

export async function releaseFeedback(db: D1Database, userId: string, date: string, slot: WeightSlot) {
  await db
    .prepare("DELETE FROM feedbacks WHERE user_id = ? AND date = ? AND slot = ? AND status = 'pending'")
    .bind(userId, date, slot)
    .run()
}
