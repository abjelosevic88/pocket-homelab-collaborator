package server

import (
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/abjelosevic88/pocket-homelab-collaborator/internal/store"
)

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.GetUserSettings(r.Context(), userFrom(r.Context()).ID)
	if err != nil {
		s.fail(w, err, "settings")
		return
	}
	writeJSON(w, http.StatusOK, s.publicSettings(st))
}

// publicSettings adds what the UI needs to know about the environment.
func (s *Server) publicSettings(st store.Settings) map[string]any {
	return map[string]any{
		"title": st.Title, "date_format": st.DateFormat, "time_format": st.TimeFormat, "setup_complete": st.SetupComplete,
		"max_upload_mb": s.cfg.MaxUploadMB, "idle_after_seconds": int(s.cfg.IdleAfter.Seconds()),
		"tick_seconds": int(s.cfg.TickInterval.Seconds()),
	}
}

// handlePutSettings saves the caller's own date and time format; an admin's
// save also sets the box-wide title.
func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	cur, err := s.store.GetUserSettings(r.Context(), u.ID)
	if err != nil {
		s.fail(w, err, "settings")
		return
	}
	var in store.Settings
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		in.Title = store.DefaultTitle
	}
	if !store.ValidDateFormat(in.DateFormat) {
		in.DateFormat = "auto"
	}
	if !store.ValidTimeFormat(in.TimeFormat) {
		in.TimeFormat = "auto"
	}
	in.SetupComplete = cur.SetupComplete
	if u.Role != "admin" {
		in.Title = cur.Title
	} else if err := s.store.SaveTitle(r.Context(), in.Title); err != nil {
		s.fail(w, err, "save settings")
		return
	}
	if err := s.store.SaveUserSettings(r.Context(), u.ID, in); err != nil {
		s.fail(w, err, "save settings")
		return
	}
	writeJSON(w, http.StatusOK, s.publicSettings(in))
}

func (s *Server) handleSystemInfo(w http.ResponseWriter, r *http.Request) {
	var size int64
	if fi, err := os.Stat(s.cfg.DBPath); err == nil {
		size = fi.Size()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version": Version, "go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH,
		"core":      s.coreStatus(),
		"auth_mode": s.cfg.AuthMode, "data_dir": s.cfg.DataDir, "db_path": s.cfg.DBPath, "db_bytes": size,
		"files_dir": s.cfg.FilesDir, "max_upload_mb": s.cfg.MaxUploadMB,
		"idle_after": s.cfg.IdleAfter.String(), "session_gap": s.cfg.SessionGap.String(), "tick": s.cfg.TickInterval.String(),
		"live_connections": s.hub.connCount(),
		"uptime":           time.Since(s.started).Round(time.Second).String(), "timezone": time.Now().Location().String(),
		"counts": s.store.UserCounts(r.Context(), userFrom(r.Context()).ID),
	})
}
