-- 体重を1日「朝」「夜」の2枠にする。各枠は1回だけ記録でき、記録後は変更しない。
-- これまでの記録（1日1件）は朝の記録として移す。
CREATE TABLE weights_v2 (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning', 'evening')),
  weight REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date, slot)
);
INSERT INTO weights_v2 (user_id, date, slot, weight) SELECT user_id, date, 'morning', weight FROM weights;
DROP TABLE weights;
ALTER TABLE weights_v2 RENAME TO weights;

-- AIフィードバックは「その日最初に開いたとき」から「体重を記録したとき」に変える。
-- 体重の枠ごとに1件なので1日最大2件。これまでのフィードバックは枠に対応しないので移さない。
DROP TABLE feedbacks;
CREATE TABLE feedbacks (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning', 'evening')),
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date, slot)
);
