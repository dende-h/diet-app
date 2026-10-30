-- user_id は Clerk のユーザーID。すべてのクエリで user_id を条件にしてユーザー間のデータを分離する。

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  birth_year INTEGER NOT NULL,
  height_cm REAL NOT NULL,
  activity REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 目標は作り直せるように履歴で持ち、最新の1件を有効とする
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_weight REAL NOT NULL,
  loss_kg REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX goals_user ON goals (user_id, id);

CREATE TABLE weights (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE intakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kcal INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX intakes_user_date ON intakes (user_id, date);

-- AIフィードバックは1ユーザー1日1件。生成中は status = 'pending'
CREATE TABLE feedbacks (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);
