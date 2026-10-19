package store

import "context"

// DefaultTitle is the app title until someone changes it.
const DefaultTitle = "Pocket Collaborator"

// GetSettings loads all settings with defaults applied.
func (s *Store) GetSettings(ctx context.Context) (Settings, error) {
	st := Settings{Title: DefaultTitle, DateFormat: "auto", TimeFormat: "auto"}
	rows, err := s.DB.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return st, err
		}
		switch k {
		case "title":
			if v != "" {
				st.Title = v
			}
		case "date_format":
			if ValidDateFormat(v) {
				st.DateFormat = v
			}
		case "time_format":
			if ValidTimeFormat(v) {
				st.TimeFormat = v
			}
		case "setup_complete":
			st.SetupComplete = v == "1"
		}
	}
	return st, rows.Err()
}

// SaveSettings persists all settings.
func (s *Store) SaveSettings(ctx context.Context, st Settings) error {
	b := map[bool]string{true: "1", false: "0"}
	kv := map[string]string{
		"title":          st.Title,
		"date_format":    st.DateFormat,
		"time_format":    st.TimeFormat,
		"setup_complete": b[st.SetupComplete],
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for k, v := range kv {
		if _, err := tx.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, v); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// GetUserSettings is GetSettings with userID's own date and time format laid
// over the box-wide values.
func (s *Store) GetUserSettings(ctx context.Context, userID int64) (Settings, error) {
	st, err := s.GetSettings(ctx)
	if err != nil {
		return st, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT key, value FROM user_settings WHERE user_id = ?`, userID)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return st, err
		}
		switch k {
		case "date_format":
			if ValidDateFormat(v) {
				st.DateFormat = v
			}
		case "time_format":
			if ValidTimeFormat(v) {
				st.TimeFormat = v
			}
		}
	}
	return st, rows.Err()
}

// SaveUserSettings stores userID's own date and time format.
func (s *Store) SaveUserSettings(ctx context.Context, userID int64, st Settings) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for k, v := range map[string]string{"date_format": st.DateFormat, "time_format": st.TimeFormat} {
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, userID, k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// SaveTitle stores the box-wide title.
func (s *Store) SaveTitle(ctx context.Context, title string) error {
	cur, err := s.GetSettings(ctx)
	if err != nil {
		return err
	}
	cur.Title = title
	return s.SaveSettings(ctx, cur)
}
