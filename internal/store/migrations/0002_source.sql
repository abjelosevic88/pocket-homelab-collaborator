-- Where a review's document came from (Pocket Office, Pocket Documents…):
-- a stable reference the sending app can look up, and a link back.
ALTER TABLE reviews ADD COLUMN source_app   TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN source_ref   TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN source_url   TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN source_label TEXT NOT NULL DEFAULT '';
CREATE INDEX reviews_source_ref ON reviews(source_ref) WHERE source_ref <> '';
