-- 体重を「朝」「夜」の枠から、時刻つきで1日2回までの記録に変える。記録後は変更しない。
-- seq はその日の何回目の記録か（1 か 2）。計算の基準には、その日いちばん早い時刻の記録を使う。
-- これまでの記録は、記録した時刻（created_at を日本時間にしたもの）を付けて移す。
CREATE TABLE weights_v3 (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq IN (1, 2)),
  time TEXT NOT NULL,
  weight REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date, seq)
);

CREATE TABLE weight_seq_map AS
SELECT
  user_id,
  date,
  slot,
  ROW_NUMBER() OVER (PARTITION BY user_id, date ORDER BY created_at, slot DESC) AS seq
FROM weights;

INSERT INTO weights_v3 (user_id, date, seq, time, weight, created_at)
SELECT w.user_id, w.date, m.seq, strftime('%H:%M', w.created_at, '+9 hours'), w.weight, w.created_at
FROM weights w
JOIN weight_seq_map m ON m.user_id = w.user_id AND m.date = w.date AND m.slot = w.slot;

-- AIフィードバックも体重の記録ごと（seq）に持つ。生成済みのものだけ移す
CREATE TABLE feedbacks_v3 (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq IN (1, 2)),
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date, seq)
);

INSERT INTO feedbacks_v3 (user_id, date, seq, content, status, created_at)
SELECT f.user_id, f.date, m.seq, f.content, f.status, f.created_at
FROM feedbacks f
JOIN weight_seq_map m ON m.user_id = f.user_id AND m.date = f.date AND m.slot = f.slot
WHERE f.status = 'done';

DROP TABLE weight_seq_map;
DROP TABLE weights;
ALTER TABLE weights_v3 RENAME TO weights;
DROP TABLE feedbacks;
ALTER TABLE feedbacks_v3 RENAME TO feedbacks;
