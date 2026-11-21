-- AETHER schema. SQLite (Cloudflare D1). All ids are text (prefix + random), all times are ISO-8601 UTC strings.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','lead','member','guest')),
  title TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#8a8a8a',
  skills TEXT NOT NULL DEFAULT '{}',            -- JSON { "Python": 4, "Rust": 2 }
  responsibilities TEXT NOT NULL DEFAULT '[]',  -- JSON ["Infra", "Reviews"]
  capacity INTEGER NOT NULL DEFAULT 20,         -- story points per week
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  github_login TEXT,
  github_token_enc TEXT,
  prefs TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- sha256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'invite' CHECK (kind IN ('invite','reset')),
  user_id TEXT,                  -- for reset links
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  email_status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'engineering' CHECK (kind IN ('engineering','research','competition','operations')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning','active','paused','done')),
  priority TEXT NOT NULL DEFAULT 'medium',
  color TEXT NOT NULL DEFAULT '#d4ff3a',
  lead_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  start_date TEXT,
  due_date TEXT,
  repo_full_name TEXT,
  webhook_id INTEGER,
  task_seq INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_deps (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, depends_on_id)
);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_milestones_project ON milestones(project_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog','todo','in_progress','review','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent','high','medium','low','none')),
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  labels TEXT NOT NULL DEFAULT '[]',
  estimate INTEGER NOT NULL DEFAULT 1,
  start_date TEXT,
  due_date TEXT,
  position REAL NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, number)
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_due ON tasks(due_date);

CREATE TABLE task_deps (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_by_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocked_by_id)
);

CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comments_task ON task_comments(task_id);

CREATE TABLE task_commits (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  message TEXT NOT NULL,
  author TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, sha)
);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting','deadline','event','review')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  attendees TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_start ON calendar_events(starts_at);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'paper' CHECK (kind IN ('paper','document','note','reference')),
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '',
  abstract TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  doi TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  year INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'to_read' CHECK (status IN ('to_read','reading','read','draft','published','archived')),
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  attachment_id TEXT,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE paper_progress (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (paper_id, user_id)
);

CREATE TABLE competitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organizer TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'discovered' CHECK (stage IN ('discovered','registered','building','submitted','finalist','result')),
  description TEXT NOT NULL DEFAULT '',
  registration_deadline TEXT,
  deadline TEXT,
  event_date TEXT,
  requirements TEXT NOT NULL DEFAULT '[]',     -- JSON [{ id, text, done }]
  submission_links TEXT NOT NULL DEFAULT '[]', -- JSON [{ label, url }]
  prize TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '' ,           -- '', 'won', 'placed', 'finalist', 'not_selected'
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE competition_members (
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (competition_id, user_id)
);

CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'electronics' CHECK (category IN ('computer','server','component','electronics','license','other')),
  tag TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  specs TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'operational' CHECK (condition IN ('operational','maintenance','broken','retired')),
  quantity INTEGER NOT NULL DEFAULT 1,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  bookable INTEGER NOT NULL DEFAULT 1,
  license_seats INTEGER,
  license_expiry TEXT,
  next_maintenance TEXT,
  purchase_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_bookings_eq ON bookings(equipment_id, starts_at);

CREATE TABLE maintenance_logs (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'channel' CHECK (kind IN ('channel','project','dm')),
  topic TEXT NOT NULL DEFAULT '',
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  is_private INTEGER NOT NULL DEFAULT 0,
  dm_key TEXT UNIQUE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  last_message_at TEXT
);

CREATE TABLE channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  attachment_id TEXT,
  reactions TEXT NOT NULL DEFAULT '{}',   -- JSON { "👍": ["usr_1"] }
  edited_at TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX idx_messages_parent ON messages(parent_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE attachment_chunks (
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (attachment_id, idx)
);

CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'award',
  date TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- The single event log. Dashboard timeline, notifications, audit log and member activity all read from here.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  verb TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  project_id TEXT,
  summary TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  audit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_created ON activity(created_at);
CREATE INDEX idx_activity_actor ON activity(actor_id, created_at);
CREATE INDEX idx_activity_entity ON activity(entity_type, entity_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  actor_id TEXT,
  dedupe_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);
CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE login_failures (
  email TEXT NOT NULL COLLATE NOCASE,
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_login_failures ON login_failures(email, created_at);
