CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE api_tokens (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL DEFAULT '',
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, key)
);

-- A review is one document going through review. Only the people on it see it
-- (admins included). kind says what is being reviewed: 'pdf' today; 'url',
-- 'image' and office documents later, each revision carrying its own kind.
--   status: draft | in_review | changes_requested | approved | rejected | cancelled
--   require_resolved = 1: an approval is refused while issues are still open.
CREATE TABLE reviews (
  id                  INTEGER PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  kind                TEXT NOT NULL DEFAULT 'pdf',
  owner_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'draft',
  due_date            TEXT NOT NULL DEFAULT '',
  require_resolved    INTEGER NOT NULL DEFAULT 1,
  current_revision_id INTEGER,
  started_at          TEXT,
  decided_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One version of the document. Comments belong to the revision they were made
-- on; open ones carry over to later revisions. The file sits in FILES_DIR under
-- storage_path; source_url is for kinds that are not uploaded files.
CREATE TABLE revisions (
  id           INTEGER PRIMARY KEY,
  review_id    INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'pdf',
  filename     TEXT NOT NULL DEFAULT '',
  mime         TEXT NOT NULL DEFAULT '',
  size         INTEGER NOT NULL DEFAULT 0,
  sha256       TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL DEFAULT '',
  source_url   TEXT NOT NULL DEFAULT '',
  page_count   INTEGER NOT NULL DEFAULT 0,
  note         TEXT NOT NULL DEFAULT '',
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (review_id, number)
);

-- Who takes part and as what.
--   role:    owner | approver | reviewer | observer
--   state:   invited | reviewing | done   (done = finished with a verdict)
--   verdict: '' | approved | changes | rejected
CREATE TABLE participants (
  review_id       INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'invited',
  verdict         TEXT NOT NULL DEFAULT '',
  verdict_note    TEXT NOT NULL DEFAULT '',
  verdict_at      TEXT,
  added_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  first_opened_at TEXT,
  last_seen_at    TEXT,
  PRIMARY KEY (review_id, user_id)
);
CREATE INDEX participants_user ON participants(user_id);

-- A thread is a root comment (parent_id NULL) with its replies. Only roots carry
-- kind, severity, the anchor on the page and the open/resolved/rejected state.
--   kind:     comment | question | issue
--   severity: '' | minor | major | critical   (issues only)
--   anchor:   JSON {"rects":[{"x","y","w","h"}], "quote": "..."} in 0..1 page units
CREATE TABLE comments (
  id           INTEGER PRIMARY KEY,
  review_id    INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  revision_id  INTEGER REFERENCES revisions(id) ON DELETE SET NULL,
  parent_id    INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'comment',
  severity     TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  page         INTEGER NOT NULL DEFAULT 0,
  anchor       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',
  status_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_at    TEXT,
  status_note  TEXT NOT NULL DEFAULT '',
  deleted      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  edited_at    TEXT
);
CREATE INDEX comments_review ON comments(review_id, id);
CREATE INDEX comments_parent ON comments(parent_id);

-- Work that comes out of a review, on its own or from a comment.
CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY,
  review_id   INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  comment_id  INTEGER REFERENCES comments(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',      -- open | done
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at     TEXT
);
CREATE INDEX tasks_review ON tasks(review_id);
CREATE INDEX tasks_assignee ON tasks(assignee_id, status);

-- The review's log: everything anyone did, append-only.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  review_id   INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  comment_id  INTEGER,
  task_id     INTEGER,
  revision_id INTEGER,
  page        INTEGER NOT NULL DEFAULT 0,
  summary     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX events_review ON events(review_id, id DESC);

-- Review time, measured by the server while the document is open, visible and
-- in use. A reading session is one sitting; page_time is where the time went.
CREATE TABLE reading_sessions (
  id             INTEGER PRIMARY KEY,
  review_id      INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision_id    INTEGER,
  started_at     TEXT NOT NULL,
  last_at        TEXT NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX reading_sessions_review ON reading_sessions(review_id, user_id, id DESC);

CREATE TABLE page_time (
  review_id   INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  revision_id INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  seconds     INTEGER NOT NULL DEFAULT 0,
  first_at    TEXT NOT NULL,
  last_at     TEXT NOT NULL,
  PRIMARY KEY (review_id, revision_id, user_id, page)
);
