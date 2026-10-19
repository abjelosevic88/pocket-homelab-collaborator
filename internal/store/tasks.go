package store

import (
	"context"
	"database/sql"
)

const taskCols = `t.id, t.review_id, r.title, COALESCE(t.comment_id, 0), t.title, t.notes, COALESCE(t.assignee_id, 0), COALESCE(NULLIF(a.name, ''), a.email, ''),
	t.due_date, t.status, COALESCE(t.created_by, 0), t.created_at, COALESCE(t.done_by, 0), t.done_at`

const taskFrom = ` FROM tasks t JOIN reviews r ON r.id = t.review_id LEFT JOIN users a ON a.id = t.assignee_id`

func scanTask(row interface{ Scan(...any) error }) (*Task, error) {
	var t Task
	if err := row.Scan(&t.ID, &t.ReviewID, &t.ReviewTitle, &t.CommentID, &t.Title, &t.Notes, &t.AssigneeID, &t.AssigneeName,
		&t.DueDate, &t.Status, &t.CreatedBy, &t.CreatedAt, &t.DoneBy, &t.DoneAt); err != nil {
		return nil, notFound(err)
	}
	return &t, nil
}

func (s *Store) queryTasks(ctx context.Context, where string, args ...any) ([]Task, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT `+taskCols+taskFrom+` WHERE `+where+
		` ORDER BY t.status = 'done', CASE WHEN t.due_date = '' THEN '9999' ELSE t.due_date END, t.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// ListTasks returns a review's tasks, open first.
func (s *Store) ListTasks(ctx context.Context, reviewID int64) ([]Task, error) {
	return s.queryTasks(ctx, `t.review_id = ?`, reviewID)
}

// MyTasks returns the tasks assigned to a person, plus unassigned ones they
// created, on reviews they are still on.
func (s *Store) MyTasks(ctx context.Context, userID int64, openOnly bool) ([]Task, error) {
	w := `(t.assignee_id = ? OR (t.assignee_id IS NULL AND t.created_by = ?)) AND EXISTS (SELECT 1 FROM participants p WHERE p.review_id = t.review_id AND p.user_id = ?)`
	if openOnly {
		w += ` AND t.status = 'open'`
	}
	return s.queryTasks(ctx, w, userID, userID, userID)
}

// GetTask returns one task of a review.
func (s *Store) GetTask(ctx context.Context, reviewID, id int64) (*Task, error) {
	return scanTask(s.DB.QueryRowContext(ctx, `SELECT `+taskCols+taskFrom+` WHERE t.review_id = ? AND t.id = ?`, reviewID, id))
}

// CreateTask inserts a task.
func (s *Store) CreateTask(ctx context.Context, t *Task) error {
	t.CreatedAt, t.Status = Now(), "open"
	res, err := s.DB.ExecContext(ctx, `INSERT INTO tasks (review_id, comment_id, title, notes, assignee_id, due_date, status, created_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`, t.ReviewID, nullID(t.CommentID), t.Title, t.Notes, nullID(t.AssigneeID), t.DueDate, t.CreatedBy, t.CreatedAt)
	if err != nil {
		return err
	}
	t.ID, _ = res.LastInsertId()
	return nil
}

// UpdateTask saves a task's fields and status.
func (s *Store) UpdateTask(ctx context.Context, t *Task, by int64) error {
	var doneBy sql.NullInt64
	var doneAt sql.NullString
	if t.Status == "done" {
		doneBy = nullID(by)
		if t.DoneAt != nil {
			doneAt = sql.NullString{String: *t.DoneAt, Valid: true}
		} else {
			doneAt = sql.NullString{String: Now(), Valid: true}
		}
	}
	_, err := s.DB.ExecContext(ctx, `UPDATE tasks SET title = ?, notes = ?, assignee_id = ?, due_date = ?, status = ?, done_by = ?, done_at = ? WHERE id = ? AND review_id = ?`,
		t.Title, t.Notes, nullID(t.AssigneeID), t.DueDate, t.Status, doneBy, doneAt, t.ID, t.ReviewID)
	return err
}

// DeleteTask removes a task.
func (s *Store) DeleteTask(ctx context.Context, reviewID, id int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM tasks WHERE id = ? AND review_id = ?`, id, reviewID)
	return err
}
