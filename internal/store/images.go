package store

import (
	"context"
	"database/sql"
	"errors"
)

// Image is a picture pasted into a comment.
type Image struct {
	ID          int64  `json:"id"`
	ReviewID    int64  `json:"review_id"`
	Mime        string `json:"mime"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	StoragePath string `json:"-"`
	UploadedBy  int64  `json:"uploaded_by"`
	CreatedAt   string `json:"created_at"`
}

// AddImage stores a picture's record; the same picture pasted twice in one
// review is kept once.
func (s *Store) AddImage(ctx context.Context, im *Image) error {
	err := s.DB.QueryRowContext(ctx, `SELECT id, created_at FROM images WHERE review_id = ? AND sha256 = ?`, im.ReviewID, im.SHA256).Scan(&im.ID, &im.CreatedAt)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	im.CreatedAt = Now()
	res, err := s.DB.ExecContext(ctx, `INSERT INTO images (review_id, mime, size, sha256, storage_path, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		im.ReviewID, im.Mime, im.Size, im.SHA256, im.StoragePath, nullID(im.UploadedBy), im.CreatedAt)
	if err != nil {
		return err
	}
	im.ID, _ = res.LastInsertId()
	return nil
}

// GetImage returns one picture of a review.
func (s *Store) GetImage(ctx context.Context, reviewID, id int64) (*Image, error) {
	var im Image
	err := s.DB.QueryRowContext(ctx, `SELECT id, review_id, mime, size, sha256, storage_path, COALESCE(uploaded_by, 0), created_at FROM images WHERE review_id = ? AND id = ?`,
		reviewID, id).Scan(&im.ID, &im.ReviewID, &im.Mime, &im.Size, &im.SHA256, &im.StoragePath, &im.UploadedBy, &im.CreatedAt)
	if err != nil {
		return nil, notFound(err)
	}
	return &im, nil
}

// ImagesBelong reports whether every id is a picture of this review.
func (s *Store) ImagesBelong(ctx context.Context, reviewID int64, ids []int64) (bool, error) {
	for _, id := range ids {
		var n int
		if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(1) FROM images WHERE review_id = ? AND id = ?`, reviewID, id).Scan(&n); err != nil {
			return false, err
		}
		if n == 0 {
			return false, nil
		}
	}
	return true, nil
}
