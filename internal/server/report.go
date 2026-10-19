package server

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/abjelosevic88/pocket-homelab-collaborator/internal/report"
	"github.com/abjelosevic88/pocket-homelab-collaborator/internal/store"
)

func (s *Server) handleReviewEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ev, err := s.store.ListEvents(r.Context(), store.EventFilter{ReviewID: reviewFrom(r.Context()).ID, UserID: actorID(r.Context()),
		ActorID: queryInt(r, "user"), Kind: q.Get("kind"), Before: queryInt(r, "before"), Limit: int(queryInt(r, "limit"))})
	if err != nil {
		s.fail(w, err, "events")
		return
	}
	writeJSON(w, http.StatusOK, ev)
}

func (s *Server) buildReport(r *http.Request) (*report.Report, error) {
	ctx := r.Context()
	rv := reviewFrom(ctx)
	threads, err := s.store.ListThreads(ctx, rv.ID)
	if err != nil {
		return nil, err
	}
	tasks, err := s.store.ListTasks(ctx, rv.ID)
	if err != nil {
		return nil, err
	}
	events, err := s.store.ListEvents(ctx, store.EventFilter{ReviewID: rv.ID, UserID: actorID(ctx), Limit: 5000})
	if err != nil {
		return nil, err
	}
	sessions, err := s.store.ListSessions(ctx, rv.ID)
	if err != nil {
		return nil, err
	}
	pt, err := s.store.ListPageTime(ctx, rv.ID)
	if err != nil {
		return nil, err
	}
	revID := queryInt(r, "revision")
	if revID != 0 {
		if _, err := s.store.GetRevision(ctx, rv.ID, revID); err != nil {
			return nil, err
		}
	}
	return report.Build(report.Input{Review: rv, Threads: threads, Tasks: tasks, Events: events, Sessions: sessions, PageTime: pt,
		RevisionID: revID, GeneratedBy: displayName(userFrom(ctx)), Now: time.Now()}), nil
}

func (s *Server) handleReport(w http.ResponseWriter, r *http.Request) {
	rep, err := s.buildReport(r)
	if err != nil {
		s.fail(w, err, "report")
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

func (s *Server) handleReportPDF(w http.ResponseWriter, r *http.Request) {
	rep, err := s.buildReport(r)
	if err != nil {
		s.fail(w, err, "report")
		return
	}
	st, _ := s.store.GetSettings(r.Context())
	b, err := report.PDF(rep, st.Title)
	if err != nil {
		s.fail(w, err, "render report")
		return
	}
	s.store.LogEvent(r.Context(), store.Event{ReviewID: rep.Review.ID, UserID: actorID(r.Context()), Kind: "report.downloaded", Summary: fmt.Sprintf("Downloaded the report (v%d)", rep.Revision.Number)})
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-report.pdf"`, safeName(rep.Review.Title)))
	_, _ = w.Write(b)
}

func safeName(n string) string {
	n = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		if r == ' ' {
			return '-'
		}
		return -1
	}, n)
	if n == "" {
		n = "review"
	}
	if len(n) > 60 {
		n = n[:60]
	}
	return strings.ToLower(n)
}

func csvHeaders(w http.ResponseWriter, name string) *csv.Writer {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, name))
	return csv.NewWriter(w)
}

// handleEventsCSV writes the whole log, oldest first.
func (s *Server) handleEventsCSV(w http.ResponseWriter, r *http.Request) {
	rv := reviewFrom(r.Context())
	ev, err := s.store.ListEvents(r.Context(), store.EventFilter{ReviewID: rv.ID, UserID: actorID(r.Context()), Limit: 5000})
	if err != nil {
		s.fail(w, err, "events")
		return
	}
	cw := csvHeaders(w, safeName(rv.Title)+"-log")
	_ = cw.Write([]string{"id", "time", "who", "kind", "comment", "task", "page", "details"})
	for i := len(ev) - 1; i >= 0; i-- {
		e := ev[i]
		_ = cw.Write([]string{fmt.Sprint(e.ID), e.CreatedAt, e.UserName, e.Kind, idOrEmpty(e.CommentID), idOrEmpty(e.TaskID), idOrEmpty(int64(e.Page)), e.Summary})
	}
	cw.Flush()
}

// handleCommentsCSV writes one row per comment (threads and replies).
func (s *Server) handleCommentsCSV(w http.ResponseWriter, r *http.Request) {
	rv := reviewFrom(r.Context())
	threads, err := s.store.ListThreads(r.Context(), rv.ID)
	if err != nil {
		s.fail(w, err, "comments")
		return
	}
	num := map[int64]int{}
	for _, v := range rv.Revisions {
		num[v.ID] = v.Number
	}
	cw := csvHeaders(w, safeName(rv.Title)+"-comments")
	_ = cw.Write([]string{"id", "thread", "revision", "page", "kind", "severity", "category", "status", "author", "created", "text", "quote", "status_note"})
	for _, t := range threads {
		quote := ""
		if t.Anchor != nil {
			quote = t.Anchor.Quote
		}
		_ = cw.Write([]string{fmt.Sprint(t.ID), fmt.Sprint(t.ID), fmt.Sprint(num[t.RevisionID]), fmt.Sprint(t.Page), t.Kind, t.Severity, t.Category, t.Status,
			t.AuthorName, t.CreatedAt, t.Body, quote, t.StatusNote})
		for _, rp := range t.Replies {
			_ = cw.Write([]string{fmt.Sprint(rp.ID), fmt.Sprint(t.ID), fmt.Sprint(num[t.RevisionID]), fmt.Sprint(t.Page), "reply", "", "", "", rp.AuthorName, rp.CreatedAt, rp.Body, "", ""})
		}
	}
	cw.Flush()
}

func idOrEmpty(n int64) string {
	if n == 0 {
		return ""
	}
	return fmt.Sprint(n)
}
