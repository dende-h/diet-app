-- 夜に自動で作る「今日のまとめ」（1人1日1件）と、スマホへの通知の送り先。
-- まとめの本文は暗号化して保存する。generations は作った回数（自動で1回＋作り直し1回の最大2回）
CREATE TABLE daily_reviews (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
  generations INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);

-- Web Push の購読（端末ごと）。endpoint は端末のブラウザーが発行する送り先URL
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
