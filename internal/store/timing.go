package store

import (
	"context"
	"time"
)

// CreditTime adds seconds of review time for one person on one page: to the
// page's tally and to their current reading session, which is extended when
// it was last credited within gap and replaced by a new one otherwise. It
// returns true when a new session started.
func (s *Store) CreditTime(ctx context.Context, reviewID, revisionID, userID int64, page, seconds int, now time.Time, gap time.Duration) (bool, error) {
	if seconds <= 0 {
		return false, nil
	}
	ts := now.UTC().Format(time.RFC3339Nano)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if page > 0 && revisionID > 0 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO page_time (review_id, revision_id, user_id, page, seconds, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(review_id, revision_id, user_id, page) DO UPDATE SET seconds = seconds + excluded.seconds, last_at = excluded.last_at`,
			reviewID, revisionID, userID, page, seconds, ts, ts); err != nil {
			return false, err
		}
	}
	var id int64
	var last string
	err = tx.QueryRowContext(ctx, `SELECT id, last_at FROM reading_sessions WHERE review_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`, reviewID, userID).Scan(&id, &last)
	fresh := err != nil || now.Sub(ParseTime(last)) > gap
	if fresh {
		start := now.Add(-time.Duration(seconds) * time.Second).UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(ctx, `INSERT INTO reading_sessions (review_id, user_id, revision_id, started_at, last_at, active_seconds) VALUES (?, ?, ?, ?, ?, ?)`,
			reviewID, userID, nullID(revisionID), start, ts, seconds); err != nil {
			return false, err
		}
	} else if _, err := tx.ExecContext(ctx, `UPDATE reading_sessions SET last_at = ?, active_seconds = active_seconds + ? WHERE id = ?`, ts, seconds, id); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE participants SET last_seen_at = ? WHERE review_id = ? AND user_id = ?`, ts, reviewID, userID); err != nil {
		return false, err
	}
	return fresh, tx.Commit()
}

// ListSessions returns a review's reading sessions, oldest first.
func (s *Store) ListSessions(ctx context.Context, reviewID int64) ([]ReadingSession, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, review_id, user_id, COALESCE(revision_id, 0), started_at, last_at, active_seconds
		FROM reading_sessions WHERE review_id = ? ORDER BY started_at`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReadingSession{}
	for rows.Next() {
		var r ReadingSession
		if err := rows.Scan(&r.ID, &r.ReviewID, &r.UserID, &r.RevisionID, &r.StartedAt, &r.LastAt, &r.ActiveSeconds); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListPageTime returns every page tally of a review.
func (s *Store) ListPageTime(ctx context.Context, reviewID int64) ([]PageTime, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT revision_id, user_id, page, seconds, first_at, last_at FROM page_time WHERE review_id = ? ORDER BY revision_id, user_id, page`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PageTime{}
	for rows.Next() {
		var p PageTime
		if err := rows.Scan(&p.RevisionID, &p.UserID, &p.Page, &p.Seconds, &p.FirstAt, &p.LastAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// MyReviewSeconds returns a person's review time per review, for the home page.
func (s *Store) MyReviewSeconds(ctx context.Context, userID int64, since string) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(SUM(active_seconds), 0) FROM reading_sessions WHERE user_id = ? AND started_at >= ?`, userID, since).Scan(&n)
	return n, err
}
