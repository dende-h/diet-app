import type {
  ExerciseEntry,
  Goal,
  IntakeEntry,
  Profile,
  Sex,
  StoredFeedback,
  UserData,
  WeightRecord,
} from '../shared/calc'

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
  const [profile, goal, weights, intakes, exercises] = await db.batch([
    db.prepare('SELECT sex, birth_year, height_cm, activity FROM profiles WHERE user_id = ?').bind(userId),
    db
      .prepare('SELECT start_date, end_date, start_weight, loss_kg FROM goals WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .bind(userId),
    db.prepare('SELECT date, seq, time, weight FROM weights WHERE user_id = ? ORDER BY date, time, seq').bind(userId),
    db
      .prepare('SELECT id, date, time, kcal, label FROM intakes WHERE user_id = ? ORDER BY date, time, id')
      .bind(userId),
    db.prepare('SELECT date, text FROM exercises WHERE user_id = ? ORDER BY date').bind(userId),
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
    exercises: exercises.results as unknown as ExerciseEntry[],
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

/**
 * 体重を記録する。その日の記録がすでに2回あれば何もせず null を返す（記録後は変更しない）。
 * 何回目かは記録時に数え、同時に送られても主キーの重複で弾かれる。
 */
export async function insertWeight(
  db: D1Database,
  userId: string,
  r: { date: string; time: string; weight: number },
): Promise<WeightRecord | null> {
  try {
    return await db
      .prepare(
        `INSERT INTO weights (user_id, date, seq, time, weight)
         SELECT ?1, ?2, COUNT(*) + 1, ?3, ?4 FROM weights WHERE user_id = ?1 AND date = ?2
         HAVING COUNT(*) < 2
         RETURNING date, seq, time, weight`,
      )
      .bind(userId, r.date, r.time, r.weight)
      .first<WeightRecord>()
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) return null
    throw err
  }
}

export async function hasWeight(db: D1Database, userId: string, date: string, seq: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM weights WHERE user_id = ? AND date = ? AND seq = ?')
    .bind(userId, date, seq)
    .first()
  return row !== null
}

export async function addIntake(db: D1Database, userId: string, entry: Omit<IntakeEntry, 'id'>) {
  return db
    .prepare(
      'INSERT INTO intakes (user_id, date, time, kcal, label) VALUES (?, ?, ?, ?, ?) RETURNING id, date, time, kcal, label',
    )
    .bind(userId, entry.date, entry.time, entry.kcal, entry.label)
    .first<IntakeEntry>()
}

/** その日の運動を保存する。空なら削除する */
export async function saveExercise(db: D1Database, userId: string, date: string, text: string) {
  if (!text) {
    await db.prepare('DELETE FROM exercises WHERE user_id = ? AND date = ?').bind(userId, date).run()
    return
  }
  await db
    .prepare(
      `INSERT INTO exercises (user_id, date, text) VALUES (?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`,
    )
    .bind(userId, date, text)
    .run()
}

/** 写真からのカロリー推定の回数を1増やし、その日の合計を返す */
export async function countEstimate(db: D1Database, userId: string, date: string): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO estimate_usage (user_id, date, count) VALUES (?, ?, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(userId, date)
    .first<{ count: number }>()
  return row?.count ?? 1
}

export async function deleteIntake(db: D1Database, userId: string, id: number) {
  await db.prepare('DELETE FROM intakes WHERE user_id = ? AND id = ?').bind(userId, id).run()
}

// ---- AIフィードバック（体重の記録ごとに1件） ----

export async function listFeedbacks(db: D1Database, userId: string, date: string): Promise<StoredFeedback[]> {
  const { results } = await db
    .prepare('SELECT seq, status, content FROM feedbacks WHERE user_id = ? AND date = ?')
    .bind(userId, date)
    .all<StoredFeedback>()
  return results
}

export async function getFeedback(db: D1Database, userId: string, date: string, seq: number) {
  return db
    .prepare('SELECT seq, status, content FROM feedbacks WHERE user_id = ? AND date = ? AND seq = ?')
    .bind(userId, date, seq)
    .first<StoredFeedback>()
}

/**
 * その記録へのフィードバック生成権を取る。true なら呼び出し側がAIを呼ぶ。
 * 生成途中で落ちた pending が2分以上残っていれば取り直す。
 */
export async function claimFeedback(db: D1Database, userId: string, date: string, seq: number): Promise<boolean> {
  const inserted = await db
    .prepare(
      "INSERT INTO feedbacks (user_id, date, seq, status) VALUES (?, ?, ?, 'pending') ON CONFLICT (user_id, date, seq) DO NOTHING",
    )
    .bind(userId, date, seq)
    .run()
  if (inserted.meta.changes === 1) return true
  const stale = await db
    .prepare(
      `UPDATE feedbacks SET created_at = datetime('now')
       WHERE user_id = ? AND date = ? AND seq = ? AND status = 'pending' AND created_at < datetime('now', '-2 minutes')`,
    )
    .bind(userId, date, seq)
    .run()
  return stale.meta.changes === 1
}

export async function completeFeedback(db: D1Database, userId: string, date: string, seq: number, content: string) {
  await db
    .prepare("UPDATE feedbacks SET content = ?, status = 'done' WHERE user_id = ? AND date = ? AND seq = ?")
    .bind(content, userId, date, seq)
    .run()
}

export async function releaseFeedback(db: D1Database, userId: string, date: string, seq: number) {
  await db
    .prepare("DELETE FROM feedbacks WHERE user_id = ? AND date = ? AND seq = ? AND status = 'pending'")
    .bind(userId, date, seq)
    .run()
}
