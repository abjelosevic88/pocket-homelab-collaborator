// Package report builds the end-of-review report (what the Report page shows)
// and renders the same thing as a PDF: who took part and how, how long each
// person spent and on which pages, what was found, what is still open, the
// decision, and the full log.
package report

import (
	"sort"
	"strconv"
	"time"

	"github.com/abjelosevic88/pocket-homelab-review/internal/store"
)

// SeenSeconds is how long a page must have been in front of someone to count
// as read by them.
const SeenSeconds = 5

// Input is everything the report is built from.
type Input struct {
	Review      *store.Review
	Threads     []store.Comment
	Tasks       []store.Task
	Events      []store.Event // newest first, as the store returns them
	Sessions    []store.ReadingSession
	PageTime    []store.PageTime
	RevisionID  int64 // the revision the heatmap and coverage are about (0 = current)
	GeneratedBy string
	Now         time.Time
}

// Report is the result.
type Report struct {
	Review      ReviewInfo     `json:"review"`
	Revision    RevisionInfo   `json:"revision"`
	GeneratedAt string         `json:"generated_at"`
	GeneratedBy string         `json:"generated_by"`
	Totals      Totals         `json:"totals"`
	Severity    []SeverityRow  `json:"severity"`
	People      []PersonRow    `json:"people"`
	Heatmap     Heatmap        `json:"heatmap"`
	Sessions    []SessionRow   `json:"sessions"`
	Decision    []DecisionRow  `json:"decision"`
	OpenIssues  []ThreadRow    `json:"open_issues"`
	Threads     []ThreadRow    `json:"threads"`
	Tasks       []store.Task   `json:"tasks"`
	Timeline    []store.Event  `json:"timeline"` // oldest first
	Revisions   []RevisionInfo `json:"revisions"`
}

// ReviewInfo is the bit of the review the report needs.
type ReviewInfo struct {
	ID              int64   `json:"id"`
	Title           string  `json:"title"`
	Description     string  `json:"description"`
	Status          string  `json:"status"`
	Owner           string  `json:"owner"`
	DueDate         string  `json:"due_date"`
	RequireResolved bool    `json:"require_resolved"`
	CreatedAt       string  `json:"created_at"`
	StartedAt       *string `json:"started_at"`
	DecidedAt       *string `json:"decided_at"`
}

// RevisionInfo describes one revision.
type RevisionInfo struct {
	ID        int64  `json:"id"`
	Number    int    `json:"number"`
	Filename  string `json:"filename"`
	PageCount int    `json:"page_count"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"created_at"`
	Threads   int    `json:"threads"`
	Issues    int    `json:"issues"`
}

// Totals are the headline numbers.
type Totals struct {
	People          int     `json:"people"`
	ActiveSeconds   int     `json:"active_seconds"`  // everyone, every revision
	ElapsedSeconds  int     `json:"elapsed_seconds"` // started → decided (or now)
	Sessions        int     `json:"sessions"`
	Threads         int     `json:"threads"`
	OpenThreads     int     `json:"open_threads"`
	Comments        int     `json:"comments"` // threads + replies
	Questions       int     `json:"questions"`
	Issues          int     `json:"issues"`
	OpenIssues      int     `json:"open_issues"`
	ResolvedIssues  int     `json:"resolved_issues"`
	RejectedIssues  int     `json:"rejected_issues"`
	Tasks           int     `json:"tasks"`
	OpenTasks       int     `json:"open_tasks"`
	Pages           int     `json:"pages"`
	IssuesPerPage   float64 `json:"issues_per_page"`
	PagesPerHour    float64 `json:"pages_per_hour"`   // pages read per active hour, all readers
	IssuesPerHour   float64 `json:"issues_per_hour"`  // issues raised per active hour
	AvgCoverage     float64 `json:"avg_coverage"`     // mean coverage of approvers and reviewers, 0..1
	FullyCovered    int     `json:"fully_covered"`    // pages someone read
	UnreadPages     []int   `json:"unread_pages"`     // pages nobody read
	MedianPageSecs  int     `json:"median_page_secs"` // per read page, all readers
	FirstActivityAt string  `json:"first_activity_at"`
	LastActivityAt  string  `json:"last_activity_at"`
}

// SeverityRow counts issues of one severity by state.
type SeverityRow struct {
	Severity string `json:"severity"`
	Open     int    `json:"open"`
	Resolved int    `json:"resolved"`
	Rejected int    `json:"rejected"`
}

// PersonRow is one participant's part.
type PersonRow struct {
	UserID         int64   `json:"user_id"`
	Name           string  `json:"name"`
	Email          string  `json:"email"`
	Role           string  `json:"role"`
	State          string  `json:"state"`
	Verdict        string  `json:"verdict"`
	VerdictNote    string  `json:"verdict_note"`
	VerdictAt      *string `json:"verdict_at"`
	ActiveSeconds  int     `json:"active_seconds"`
	RevisionSecs   int     `json:"revision_seconds"` // on the report's revision
	Sessions       int     `json:"sessions"`
	FirstOpenedAt  *string `json:"first_opened_at"`
	LastSeenAt     *string `json:"last_seen_at"`
	PagesRead      int     `json:"pages_read"`
	Coverage       float64 `json:"coverage"` // 0..1 of the report's revision
	Threads        int     `json:"threads"`
	Issues         int     `json:"issues"`
	Critical       int     `json:"critical"`
	Major          int     `json:"major"`
	Minor          int     `json:"minor"`
	Questions      int     `json:"questions"`
	Replies        int     `json:"replies"`
	Closed         int     `json:"closed"` // threads they resolved or rejected
	TasksAssigned  int     `json:"tasks_assigned"`
	TasksDone      int     `json:"tasks_done"`
	PagesPerHour   float64 `json:"pages_per_hour"`
	SecondsPerPage int     `json:"seconds_per_page"`
}

// Heatmap is seconds per person and page on the report's revision.
type Heatmap struct {
	Pages      int          `json:"pages"`
	Rows       []HeatmapRow `json:"rows"`
	PageTotals []int        `json:"page_totals"`
	PageIssues []int        `json:"page_issues"` // threads of kind issue anchored on each page
	Max        int          `json:"max"`
}

// HeatmapRow is one person.
type HeatmapRow struct {
	UserID  int64  `json:"user_id"`
	Name    string `json:"name"`
	Role    string `json:"role"`
	Seconds []int  `json:"seconds"`
}

// SessionRow is one sitting.
type SessionRow struct {
	UserID        int64  `json:"user_id"`
	Name          string `json:"name"`
	RevisionID    int64  `json:"revision_id"`
	Revision      int    `json:"revision"`
	StartedAt     string `json:"started_at"`
	LastAt        string `json:"last_at"`
	ActiveSeconds int    `json:"active_seconds"`
}

// DecisionRow is one sign-off.
type DecisionRow struct {
	Name    string  `json:"name"`
	Role    string  `json:"role"`
	Verdict string  `json:"verdict"`
	Note    string  `json:"note"`
	At      *string `json:"at"`
}

// ThreadRow is a thread in the report.
type ThreadRow struct {
	ID         int64   `json:"id"`
	Revision   int     `json:"revision"`
	Page       int     `json:"page"`
	Kind       string  `json:"kind"`
	Severity   string  `json:"severity"`
	Category   string  `json:"category"`
	Status     string  `json:"status"`
	Author     string  `json:"author"`
	Body       string  `json:"body"`
	Quote      string  `json:"quote"`
	CreatedAt  string  `json:"created_at"`
	StatusAt   *string `json:"status_at"`
	StatusBy   string  `json:"status_by"`
	StatusNote string  `json:"status_note"`
	Replies    []Reply `json:"replies"`
}

// Reply is a reply in a thread.
type Reply struct {
	Author    string `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
}

// Build computes the report.
func Build(in Input) *Report {
	rv := in.Review
	if in.Now.IsZero() {
		in.Now = time.Now()
	}
	rep := &Report{GeneratedAt: in.Now.UTC().Format(time.RFC3339), GeneratedBy: in.GeneratedBy, Tasks: in.Tasks}
	if rep.Tasks == nil {
		rep.Tasks = []store.Task{}
	}
	names := map[int64]string{}
	for _, p := range rv.Participants {
		names[p.UserID] = firstNonEmpty(p.Name, p.Email)
	}
	revNum := map[int64]int{}
	revID := in.RevisionID
	if revID == 0 {
		revID = rv.CurrentRevisionID
	}
	for _, v := range rv.Revisions {
		revNum[v.ID] = v.Number
		info := RevisionInfo{ID: v.ID, Number: v.Number, Filename: v.Filename, PageCount: v.PageCount, Size: v.Size, CreatedAt: v.CreatedAt}
		for _, t := range in.Threads {
			if t.RevisionID == v.ID && !t.Deleted {
				info.Threads++
				if t.Kind == "issue" {
					info.Issues++
				}
			}
		}
		rep.Revisions = append(rep.Revisions, info)
		if v.ID == revID {
			rep.Revision = info
		}
	}
	rep.Review = ReviewInfo{ID: rv.ID, Title: rv.Title, Description: rv.Description, Status: rv.Status, Owner: names[rv.OwnerID], DueDate: rv.DueDate,
		RequireResolved: rv.RequireResolved, CreatedAt: rv.CreatedAt, StartedAt: rv.StartedAt, DecidedAt: rv.DecidedAt}
	pages := rep.Revision.PageCount
	// page time seen beyond the recorded page count (count not measured yet) still shows
	for _, pt := range in.PageTime {
		if pt.RevisionID == revID && pt.Page > pages {
			pages = pt.Page
		}
	}

	t := &rep.Totals
	t.People, t.Pages = len(rv.Participants), pages
	sev := map[string]*SeverityRow{"critical": {Severity: "critical"}, "major": {Severity: "major"}, "minor": {Severity: "minor"}}
	person := map[int64]*PersonRow{}
	for _, p := range rv.Participants {
		person[p.UserID] = &PersonRow{UserID: p.UserID, Name: firstNonEmpty(p.Name, p.Email), Email: p.Email, Role: p.Role, State: p.State, Verdict: p.Verdict,
			VerdictNote: p.VerdictNote, VerdictAt: p.VerdictAt, FirstOpenedAt: p.FirstOpenedAt, LastSeenAt: p.LastSeenAt}
		if p.Role == store.RoleApprover || (p.Role == store.RoleOwner && p.Verdict != "") {
			rep.Decision = append(rep.Decision, DecisionRow{Name: firstNonEmpty(p.Name, p.Email), Role: p.Role, Verdict: p.Verdict, Note: p.VerdictNote, At: p.VerdictAt})
		}
	}
	pageIssues := make([]int, pages)

	for _, th := range in.Threads {
		row := ThreadRow{ID: th.ID, Revision: revNum[th.RevisionID], Page: th.Page, Kind: th.Kind, Severity: th.Severity, Category: th.Category, Status: th.Status,
			Author: firstNonEmpty(names[th.AuthorID], th.AuthorName), Body: th.Body, CreatedAt: th.CreatedAt, StatusAt: th.StatusAt,
			StatusBy: names[th.StatusBy], StatusNote: th.StatusNote, Replies: []Reply{}}
		row.Body = withPictures(row.Body, len(th.Images))
		if th.Deleted {
			row.Body = "(deleted)"
		}
		if th.Anchor != nil {
			row.Quote = th.Anchor.Quote
		}
		for _, r := range th.Replies {
			if r.Deleted {
				continue
			}
			row.Replies = append(row.Replies, Reply{Author: firstNonEmpty(names[r.AuthorID], r.AuthorName), Body: withPictures(r.Body, len(r.Images)), CreatedAt: r.CreatedAt})
			t.Comments++
			if p := person[r.AuthorID]; p != nil {
				p.Replies++
			}
		}
		rep.Threads = append(rep.Threads, row)
		if th.Deleted {
			continue
		}
		t.Threads++
		t.Comments++
		if th.Status == "open" {
			t.OpenThreads++
		}
		p := person[th.AuthorID]
		if p != nil {
			p.Threads++
		}
		if th.Status != "open" {
			if c := person[th.StatusBy]; c != nil {
				c.Closed++
			}
		}
		switch th.Kind {
		case "question":
			t.Questions++
			if p != nil {
				p.Questions++
			}
		case "issue":
			t.Issues++
			if p != nil {
				p.Issues++
				switch th.Severity {
				case "critical":
					p.Critical++
				case "major":
					p.Major++
				case "minor":
					p.Minor++
				}
			}
			if s := sev[th.Severity]; s != nil {
				switch th.Status {
				case "open":
					s.Open++
				case "resolved":
					s.Resolved++
				case "rejected":
					s.Rejected++
				}
			}
			switch th.Status {
			case "open":
				t.OpenIssues++
				rep.OpenIssues = append(rep.OpenIssues, row)
			case "resolved":
				t.ResolvedIssues++
			case "rejected":
				t.RejectedIssues++
			}
			if th.RevisionID == revID && th.Page >= 1 && th.Page <= pages {
				pageIssues[th.Page-1]++
			}
		}
	}
	sevOrder := map[string]int{"critical": 0, "major": 1, "minor": 2}
	sort.SliceStable(rep.OpenIssues, func(i, j int) bool {
		return sevOrder[rep.OpenIssues[i].Severity] < sevOrder[rep.OpenIssues[j].Severity]
	})
	rep.Severity = []SeverityRow{*sev["critical"], *sev["major"], *sev["minor"]}

	for _, tk := range in.Tasks {
		t.Tasks++
		if tk.Status == "open" {
			t.OpenTasks++
		}
		if p := person[tk.AssigneeID]; p != nil {
			p.TasksAssigned++
			if tk.Status == "done" {
				p.TasksDone++
			}
		}
	}

	// time
	for _, s := range in.Sessions {
		t.ActiveSeconds += s.ActiveSeconds
		t.Sessions++
		if p := person[s.UserID]; p != nil {
			p.ActiveSeconds += s.ActiveSeconds
			p.Sessions++
		}
		rep.Sessions = append(rep.Sessions, SessionRow{UserID: s.UserID, Name: names[s.UserID], RevisionID: s.RevisionID, Revision: revNum[s.RevisionID],
			StartedAt: s.StartedAt, LastAt: s.LastAt, ActiveSeconds: s.ActiveSeconds})
	}
	hm := Heatmap{Pages: pages, PageTotals: make([]int, pages), PageIssues: pageIssues}
	rowOf := map[int64]*HeatmapRow{}
	for _, p := range rv.Participants {
		row := &HeatmapRow{UserID: p.UserID, Name: firstNonEmpty(p.Name, p.Email), Role: p.Role, Seconds: make([]int, pages)}
		rowOf[p.UserID] = row
	}
	var readPageSecs []int
	totalPagesRead := 0
	for _, pt := range in.PageTime {
		if pt.RevisionID != revID || pt.Page < 1 || pt.Page > pages {
			continue
		}
		row := rowOf[pt.UserID]
		if row == nil {
			continue // no longer on the review
		}
		row.Seconds[pt.Page-1] += pt.Seconds
		hm.PageTotals[pt.Page-1] += pt.Seconds
		if p := person[pt.UserID]; p != nil {
			p.RevisionSecs += pt.Seconds
		}
	}
	for _, p := range rv.Participants {
		row := rowOf[p.UserID]
		pr := person[p.UserID]
		for _, sec := range row.Seconds {
			if sec > hm.Max {
				hm.Max = sec
			}
			if sec >= SeenSeconds {
				pr.PagesRead++
				readPageSecs = append(readPageSecs, sec)
			}
		}
		totalPagesRead += pr.PagesRead
		if pages > 0 {
			pr.Coverage = float64(pr.PagesRead) / float64(pages)
		}
		if pr.RevisionSecs > 0 {
			pr.PagesPerHour = round1(float64(pr.PagesRead) / (float64(pr.RevisionSecs) / 3600))
		}
		if pr.PagesRead > 0 {
			pr.SecondsPerPage = pr.RevisionSecs / pr.PagesRead
		}
		hm.Rows = append(hm.Rows, *row)
	}
	rep.Heatmap = hm
	for i, sec := range hm.PageTotals {
		if sec >= SeenSeconds {
			t.FullyCovered++
		} else {
			t.UnreadPages = append(t.UnreadPages, i+1)
		}
	}
	if t.UnreadPages == nil {
		t.UnreadPages = []int{}
	}
	if len(readPageSecs) > 0 {
		sort.Ints(readPageSecs)
		t.MedianPageSecs = readPageSecs[len(readPageSecs)/2]
	}
	var covSum float64
	covN := 0
	for _, p := range rv.Participants {
		if p.Role == store.RoleApprover || p.Role == store.RoleReviewer {
			covSum += person[p.UserID].Coverage
			covN++
		}
	}
	if covN > 0 {
		t.AvgCoverage = round2(covSum / float64(covN))
	}
	var revSecs int
	for _, p := range person {
		revSecs += p.RevisionSecs
	}
	if revSecs > 0 {
		t.PagesPerHour = round1(float64(totalPagesRead) / (float64(revSecs) / 3600))
	}
	if t.ActiveSeconds > 0 {
		t.IssuesPerHour = round1(float64(t.Issues) / (float64(t.ActiveSeconds) / 3600))
	}
	if pages > 0 {
		t.IssuesPerPage = round2(float64(t.Issues) / float64(pages))
	}
	if rv.StartedAt != nil {
		end := in.Now
		if rv.DecidedAt != nil {
			end = store.ParseTime(*rv.DecidedAt)
		}
		if d := end.Sub(store.ParseTime(*rv.StartedAt)); d > 0 {
			t.ElapsedSeconds = int(d.Seconds())
		}
	}

	for _, p := range rv.Participants {
		rep.People = append(rep.People, *person[p.UserID])
	}
	// oldest first reads like a story
	for i := len(in.Events) - 1; i >= 0; i-- {
		rep.Timeline = append(rep.Timeline, in.Events[i])
	}
	if n := len(rep.Timeline); n > 0 {
		t.FirstActivityAt, t.LastActivityAt = rep.Timeline[0].CreatedAt, rep.Timeline[n-1].CreatedAt
	}
	for _, s := range []*[]ThreadRow{&rep.OpenIssues, &rep.Threads} {
		if *s == nil {
			*s = []ThreadRow{}
		}
	}
	if rep.Sessions == nil {
		rep.Sessions = []SessionRow{}
	}
	if rep.Decision == nil {
		rep.Decision = []DecisionRow{}
	}
	if rep.Timeline == nil {
		rep.Timeline = []store.Event{}
	}
	return rep
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func round1(f float64) float64 { return float64(int(f*10+0.5)) / 10 }
func round2(f float64) float64 { return float64(int(f*100+0.5)) / 100 }

// Duration: 0 → "0 min", 45 → "45 s", 3720 → "1 h 2 min", 4 days → "4 d 0 h".
func Duration(sec int) string {
	if sec > 0 && sec < 60 {
		return strconv.Itoa(sec) + " s"
	}
	m := (sec + 30) / 60
	if m < 60 {
		return strconv.Itoa(m) + " min"
	}
	if h := m / 60; h >= 48 {
		return strconv.Itoa(h/24) + " d " + strconv.Itoa(h%24) + " h"
	}
	if m%60 == 0 {
		return strconv.Itoa(m/60) + " h"
	}
	return strconv.Itoa(m/60) + " h " + strconv.Itoa(m%60) + " min"
}

// withPictures notes the pictures a comment carries, which the report cannot show.
func withPictures(body string, n int) string {
	if n == 0 {
		return body
	}
	note := "[picture]"
	if n > 1 {
		note = "[" + strconv.Itoa(n) + " pictures]"
	}
	if body == "" {
		return note
	}
	return body + " " + note
}
