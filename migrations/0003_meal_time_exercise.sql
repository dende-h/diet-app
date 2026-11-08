-- 食事は「朝食・昼食…」の区分をやめて時刻で記録する。label は写真から推定した料理名などのメモに使う
ALTER TABLE intakes ADD COLUMN time TEXT NOT NULL DEFAULT '';

-- その日の運動（自由記述）。AIフィードバックの材料にするだけで、消費カロリーは計算しない
CREATE TABLE exercises (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);

-- 写真からのカロリー推定の回数。使いすぎ（不具合での連続呼び出しなど）を防ぐ上限に使う
CREATE TABLE estimate_usage (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);
