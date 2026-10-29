-- Pictures pasted or dropped into a thread or a reply (screenshots, photos).
-- Files live at FILES_DIR/<review>/img/<sha256>.<ext>; a comment lists the
-- ids of its pictures as a JSON array.
CREATE TABLE images (
  id           INTEGER PRIMARY KEY,
  review_id    INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX images_review ON images(review_id, sha256);
ALTER TABLE comments ADD COLUMN images TEXT NOT NULL DEFAULT '';
