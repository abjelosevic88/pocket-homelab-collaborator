package store

import (
	"context"
	"database/sql"
	"encoding/json"
	core "github.com/abjelosevic88/pocket-homelab-core/sdk"
)

const commentCols = `c.id, c.review_id, COALESCE(c.revision_id, 0), COALESCE(c.parent_id, 0), COALESCE(c.author_id, 0), COALESCE(NULLIF(u.name, ''), u.email, ''),
	c.kind, c.severity, c.category, c.body, c.page, c.anchor, c.status, COALESCE(c.status_by, 0), c.status_at, c.status_note, c.deleted, c.created_at, c.edited_at`

func scanComment(row interface{ Scan(...any) error }) (*Comment, error) {
	var c Comment
	var anchor string
	var deleted int
	if err := row.Scan(&c.ID, &c.ReviewID, &c.RevisionID, &c.ParentID, &c.AuthorID, &c.AuthorName, &c.Kind, &c.Severity, &c.Category, &c.Body,
		&c.Page, &anchor, &c.Status, &c.StatusBy, &c.StatusAt, &c.StatusNote, &deleted, &c.CreatedAt, &c.EditedAt); err != nil {
		return nil, notFound(err)
	}
	c.Deleted = deleted == 1
	if anchor != "" {
		var a Anchor
		if json.Unmarshal([]byte(anchor), &a) == nil {
			c.Anchor = &a
		}
	}
	return &c, nil
}

func nullID(id int64) sql.NullInt64 { return sql.NullInt64{Int64: id, Valid: id != 0} }

// CreateComment inserts a thread root or a reply.
func (s *Store) CreateComment(ctx context.Context, c *Comment, after ...core.CommitHook) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	anchor := ""
	if c.Anchor != nil && (len(c.Anchor.Rects) > 0 || c.Anchor.Quote != "") {
		b, _ := json.Marshal(c.Anchor)
		anchor = string(b)
	}
	c.CreatedAt = Now()
	c.Status = "open"
	res, err := tx.ExecContext(ctx, `INSERT INTO comments (review_id, revision_id, parent_id, author_id, kind, severity, category, body, page, anchor, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`, c.ReviewID, nullID(c.RevisionID), nullID(c.ParentID), c.AuthorID, c.Kind, c.Severity, c.Category,
		c.Body, c.Page, anchor, c.CreatedAt)
	if err != nil {
		return err
	}
	c.ID, _ = res.LastInsertId()
	return core.Commit(tx, after...)
}

// GetComment returns one comment of a review.
func (s *Store) GetComment(ctx context.Context, reviewID, id int64) (*Comment, error) {
	return scanComment(s.DB.QueryRowContext(ctx, `SELECT `+commentCols+` FROM comments c LEFT JOIN users u ON u.id = c.author_id
		WHERE c.review_id = ? AND c.id = ?`, reviewID, id))
}

// ListThreads returns a review's threads with their replies, in page order.
func (s *Store) ListThreads(ctx context.Context, reviewID int64) ([]Comment, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT `+commentCols+` FROM comments c LEFT JOIN users u ON u.id = c.author_id
		WHERE c.review_id = ? ORDER BY c.id`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roots []Comment
	replies := map[int64][]Comment{}
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		if c.ParentID == 0 {
			roots = append(roots, *c)
		} else {
			replies[c.ParentID] = append(replies[c.ParentID], *c)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []Comment{}
	for _, r := range roots {
		r.Replies = replies[r.ID]
		// a deleted root stays while it has replies, so the conversation keeps its context
		if r.Deleted && len(r.Replies) == 0 {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

// EditComment changes a comment's text (and a root's kind/severity/category).
func (s *Store) EditComment(ctx context.Context, c *Comment) error {
	now := Now()
	c.EditedAt = &now
	_, err := s.DB.ExecContext(ctx, `UPDATE comments SET body = ?, kind = ?, severity = ?, category = ?, edited_at = ? WHERE id = ? AND review_id = ?`,
		c.Body, c.Kind, c.Severity, c.Category, now, c.ID, c.ReviewID)
	return err
}

// SetCommentStatus resolves, rejects or reopens a thread.
func (s *Store) SetCommentStatus(ctx context.Context, reviewID, id int64, status, note string, by int64) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE comments SET status = ?, status_note = ?, status_by = ?, status_at = ? WHERE id = ? AND review_id = ? AND parent_id IS NULL`,
		status, note, by, Now(), id, reviewID)
	return err
}

// DeleteComment removes a comment; one with replies is blanked instead so the thread survives.
func (s *Store) DeleteComment(ctx context.Context, reviewID, id int64) error {
	var n int
	_ = s.DB.QueryRowContext(ctx, `SELECT COUNT(1) FROM comments WHERE parent_id = ? AND deleted = 0`, id).Scan(&n)
	if n > 0 {
		_, err := s.DB.ExecContext(ctx, `UPDATE comments SET deleted = 1, body = '', edited_at = ? WHERE id = ? AND review_id = ?`, Now(), id, reviewID)
		return err
	}
	_, err := s.DB.ExecContext(ctx, `DELETE FROM comments WHERE id = ? AND review_id = ?`, id, reviewID)
	return err
}
