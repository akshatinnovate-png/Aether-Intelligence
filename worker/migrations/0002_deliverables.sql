-- Deliverables: tasks can require a Google Drive submission that the requester reviews.
ALTER TABLE tasks ADD COLUMN deliverable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN deliverable_note TEXT NOT NULL DEFAULT '';

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','changes_requested')),
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX idx_submissions_task ON submissions(task_id, created_at);
CREATE INDEX idx_submissions_status ON submissions(status);
