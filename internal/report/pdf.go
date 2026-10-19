package report

import (
	"bytes"
	"embed"
	"fmt"
	"math"
	"strings"

	"github.com/go-pdf/fpdf"

	"github.com/abjelosevic88/pocket-homelab-collaborator/internal/store"
)

//go:embed fonts/DejaVuSans.ttf fonts/DejaVuSans-Bold.ttf
var fontFS embed.FS

var (
	ink    = [3]int{17, 24, 39}
	muted  = [3]int{107, 114, 128}
	line   = [3]int{227, 230, 235}
	soft   = [3]int{243, 244, 246}
	accent = [3]int{192, 38, 211}
	red    = [3]int{220, 38, 38}
	amber  = [3]int{217, 119, 6}
	green  = [3]int{22, 163, 74}
)

var verdictText = map[string]string{"approved": "Approved", "changes": "Changes requested", "rejected": "Rejected", "": "—"}
var statusText = map[string]string{"draft": "Draft", "in_review": "In review", "changes_requested": "Changes requested",
	"approved": "Approved", "rejected": "Rejected", "cancelled": "Cancelled"}

// When formats a stored timestamp in the server's time zone.
func When(iso string) string {
	if iso == "" {
		return "—"
	}
	t := store.ParseTime(iso)
	if t.IsZero() {
		return iso
	}
	return t.Local().Format("02 Jan 2006 15:04")
}

func whenPtr(p *string) string {
	if p == nil {
		return "—"
	}
	return When(*p)
}

func pct(f float64) string { return fmt.Sprintf("%d%%", int(math.Round(f*100))) }

// PDF renders the report.
func PDF(r *Report, appTitle string) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	reg, _ := fontFS.ReadFile("fonts/DejaVuSans.ttf")
	bold, _ := fontFS.ReadFile("fonts/DejaVuSans-Bold.ttf")
	pdf.AddUTF8FontFromBytes("dv", "", reg)
	pdf.AddUTF8FontFromBytes("dv", "B", bold)
	pdf.SetMargins(14, 16, 14)
	pdf.SetAutoPageBreak(true, 18)
	pdf.SetTitle(r.Review.Title+" — review report", true)
	pdf.SetCreator(appTitle, true)
	pdf.SetFooterFunc(func() {
		pdf.SetY(-12)
		pdf.SetFont("dv", "", 7.5)
		pdf.SetTextColor(130, 130, 130)
		pdf.CellFormat(0, 5, fmt.Sprintf("%s · %s · generated %s", appTitle, trunc(pdf, r.Review.Title, 90), When(r.GeneratedAt)), "", 0, "L", false, 0, "")
		pdf.CellFormat(0, 5, fmt.Sprintf("Page %d of {nb}", pdf.PageNo()), "", 0, "R", false, 0, "")
	})
	pdf.AliasNbPages("")
	pdf.AddPage()
	w, _ := pdf.GetPageSize()
	usable := w - 28
	color := func(c [3]int) { pdf.SetTextColor(c[0], c[1], c[2]) }
	fill := func(c [3]int) { pdf.SetFillColor(c[0], c[1], c[2]) }
	t := r.Totals

	// ---- title ----
	color(ink)
	pdf.SetFont("dv", "B", 18)
	pdf.MultiCell(0, 8.5, r.Review.Title, "", "L", false)
	pdf.SetFont("dv", "", 9.5)
	color(muted)
	sub := fmt.Sprintf("Review report · v%d of %d · %s · %d pages", r.Revision.Number, len(r.Revisions), r.Revision.Filename, t.Pages)
	pdf.CellFormat(0, 5.5, sub, "", 1, "L", false, 0, "")
	meta := fmt.Sprintf("Owner %s · created %s · started %s", r.Review.Owner, When(r.Review.CreatedAt), whenPtr(r.Review.StartedAt))
	if r.Review.DecidedAt != nil {
		meta += " · decided " + whenPtr(r.Review.DecidedAt)
	}
	if r.Review.DueDate != "" {
		meta += " · due " + r.Review.DueDate
	}
	pdf.CellFormat(0, 5, meta, "", 1, "L", false, 0, "")
	pdf.CellFormat(0, 5, fmt.Sprintf("Generated %s by %s.", When(r.GeneratedAt), r.GeneratedBy), "", 1, "L", false, 0, "")
	if r.Review.Description != "" {
		pdf.Ln(1)
		pdf.SetFont("dv", "", 9)
		color(ink)
		pdf.MultiCell(0, 4.5, r.Review.Description, "", "L", false)
	}
	pdf.Ln(3)

	// ---- status banner ----
	bc := map[string][3]int{"approved": green, "rejected": red, "changes_requested": amber, "cancelled": muted}[r.Review.Status]
	if bc == [3]int{} {
		bc = accent
	}
	y := pdf.GetY()
	fill(bc)
	pdf.Rect(14, y, 1.6, 11, "F")
	fill(soft)
	pdf.Rect(15.6, y, usable-1.6, 11, "F")
	pdf.SetXY(19, y+1.5)
	pdf.SetFont("dv", "B", 12)
	color(bc)
	banner := statusText[r.Review.Status]
	var who []string
	for _, d := range r.Decision {
		if d.Verdict != "" {
			who = append(who, fmt.Sprintf("%s: %s", d.Name, strings.ToLower(verdictText[d.Verdict])))
		}
	}
	pdf.CellFormat(45, 8, banner, "", 0, "L", false, 0, "")
	pdf.SetFont("dv", "", 9)
	color(ink)
	pdf.CellFormat(usable-52, 8, trunc(pdf, strings.Join(who, " · "), usable-54), "", 0, "L", false, 0, "")
	pdf.SetXY(14, y+15)

	// ---- tiles ----
	tiles := []struct{ l, v string }{
		{"Review time (everyone)", Duration(t.ActiveSeconds)},
		{"Elapsed", Duration(t.ElapsedSeconds)},
		{"Issues open / found", fmt.Sprintf("%d / %d", t.OpenIssues, t.Issues)},
		{"Threads open / total", fmt.Sprintf("%d / %d", t.OpenThreads, t.Threads)},
		{"Avg. coverage", pct(t.AvgCoverage)},
		{"Pages per hour", fmt.Sprintf("%.1f", t.PagesPerHour)},
		{"Issues per page", fmt.Sprintf("%.2f", t.IssuesPerPage)},
		{"Tasks open / total", fmt.Sprintf("%d / %d", t.OpenTasks, t.Tasks)},
	}
	tw := (usable - 3*4) / 4
	x0, y0 := pdf.GetX(), pdf.GetY()
	for i, tl := range tiles {
		x := x0 + float64(i%4)*(tw+4)
		yy := y0 + float64(i/4)*19
		fill(soft)
		pdf.Rect(x, yy, tw, 16, "F")
		pdf.SetXY(x+3, yy+2.5)
		pdf.SetFont("dv", "", 7.5)
		color(muted)
		pdf.CellFormat(tw-6, 4, tl.l, "", 2, "L", false, 0, "")
		pdf.SetFont("dv", "B", 11.5)
		color(ink)
		pdf.CellFormat(tw-6, 7, tl.v, "", 0, "L", false, 0, "")
	}
	pdf.SetXY(x0, y0+2*19+4)

	header := func(title, note string) {
		if pdf.GetY() > 250 {
			pdf.AddPage()
		}
		pdf.SetFont("dv", "B", 11)
		color(accent)
		pdf.CellFormat(0, 7, title, "", 1, "L", false, 0, "")
		if note != "" {
			pdf.SetFont("dv", "", 8)
			color(muted)
			pdf.MultiCell(0, 4, note, "", "L", false)
			pdf.Ln(1)
		}
		color(ink)
	}
	table := func(cols []string, widths []float64, align []string, rows [][]string) {
		th := func() {
			pdf.SetFont("dv", "B", 7.5)
			fill(soft)
			color(muted)
			for i, c := range cols {
				pdf.CellFormat(widths[i], 6, c, "", 0, align[i], true, 0, "")
			}
			pdf.Ln(-1)
			color(ink)
		}
		th()
		pdf.SetFont("dv", "", 8)
		pdf.SetDrawColor(line[0], line[1], line[2])
		for _, row := range rows {
			if pdf.GetY() > 270 {
				pdf.AddPage()
				th()
				pdf.SetFont("dv", "", 8)
			}
			for i, c := range row {
				pdf.CellFormat(widths[i], 6, trunc(pdf, c, widths[i]-1.5), "B", 0, align[i], false, 0, "")
			}
			pdf.Ln(-1)
		}
		pdf.Ln(4)
	}
	empty := func(msg string) {
		pdf.SetFont("dv", "", 9)
		color(muted)
		pdf.CellFormat(0, 6, msg, "", 1, "L", false, 0, "")
		color(ink)
		pdf.Ln(3)
	}

	// ---- decision ----
	header("Sign-off", map[bool]string{true: "Approval needs every issue resolved or rejected.", false: "Approval is allowed with issues still open."}[r.Review.RequireResolved])
	if len(r.Decision) == 0 {
		empty("No approver on this review; the owner completes it.")
	} else {
		var rows [][]string
		for _, d := range r.Decision {
			rows = append(rows, []string{d.Name, d.Role, verdictText[d.Verdict], whenPtr(d.At), d.Note})
		}
		table([]string{"Name", "Role", "Verdict", "When", "Note"}, []float64{38, 22, 32, 32, usable - 124}, []string{"L", "L", "L", "L", "L"}, rows)
	}

	// ---- people ----
	header("People", fmt.Sprintf("Time is measured while the document is open, visible and in use. Coverage counts pages each person had in front of them for at least %d seconds on v%d.", SeenSeconds, r.Revision.Number))
	var prow [][]string
	for _, p := range r.People {
		prow = append(prow, []string{p.Name, p.Role, verdictText[p.Verdict], Duration(p.ActiveSeconds), fmt.Sprint(p.Sessions),
			fmt.Sprintf("%s (%d/%d)", pct(p.Coverage), p.PagesRead, t.Pages), fmt.Sprintf("%d (%d/%d/%d)", p.Issues, p.Critical, p.Major, p.Minor),
			fmt.Sprint(p.Threads - p.Issues), fmt.Sprint(p.Replies), fmt.Sprint(p.Closed)})
	}
	table([]string{"Name", "Role", "Verdict", "Time", "Sess.", "Coverage", "Issues C/M/m", "Other", "Repl.", "Closed"},
		[]float64{32, 17, 24, 17, 10, 24, 24, 11, 11, usable - 170}, []string{"L", "L", "L", "R", "R", "R", "R", "R", "R", "R"}, prow)

	// ---- heatmap ----
	if t.Pages > 0 && len(r.Heatmap.Rows) > 0 {
		header("Where the time went", fmt.Sprintf("Seconds per person and page on v%d; darker is longer (longest: %s). Red marks under a page count its issues.", r.Revision.Number, Duration(r.Heatmap.Max)))
		nameW := 34.0
		per := 40
		cell := math.Min(8, (usable-nameW)/float64(min(per, t.Pages)))
		for start := 0; start < t.Pages; start += per {
			end := min(start+per, t.Pages)
			need := float64(len(r.Heatmap.Rows)+3) * cell
			if pdf.GetY()+need > 272 {
				pdf.AddPage()
			}
			y := pdf.GetY()
			pdf.SetFont("dv", "", 5.5)
			color(muted)
			for p := start; p < end; p++ {
				if (p+1)%5 == 0 || p == start || cell > 4 {
					pdf.SetXY(14+nameW+float64(p-start)*cell, y)
					pdf.CellFormat(cell, 3.5, fmt.Sprint(p+1), "", 0, "C", false, 0, "")
				}
			}
			y += 4
			for _, row := range r.Heatmap.Rows {
				pdf.SetXY(14, y)
				pdf.SetFont("dv", "", 7.5)
				color(ink)
				pdf.CellFormat(nameW-1, cell, trunc(pdf, row.Name, nameW-2), "", 0, "L", false, 0, "")
				for p := start; p < end; p++ {
					sec := row.Seconds[p]
					x := 14 + nameW + float64(p-start)*cell
					if sec <= 0 {
						fill(soft)
					} else {
						a := 0.18 + 0.82*math.Sqrt(float64(sec)/float64(max(r.Heatmap.Max, 1)))
						pdf.SetFillColor(int(255-a*float64(255-accent[0])), int(255-a*float64(255-accent[1])), int(255-a*float64(255-accent[2])))
					}
					pdf.Rect(x+0.25, y+0.25, cell-0.5, cell-0.5, "F")
				}
				y += cell
			}
			for p := start; p < end; p++ {
				if n := r.Heatmap.PageIssues[p]; n > 0 {
					x := 14 + nameW + float64(p-start)*cell
					fill(red)
					pdf.Rect(x+0.25, y+0.8, cell-0.5, 1.4, "F")
				}
			}
			pdf.SetXY(14, y+4)
		}
		if len(t.UnreadPages) > 0 {
			pdf.SetFont("dv", "", 8)
			color(amber)
			pdf.MultiCell(0, 4.2, fmt.Sprintf("Nobody has read %d page(s): %s.", len(t.UnreadPages), pageList(t.UnreadPages)), "", "L", false)
			color(ink)
		}
		pdf.Ln(3)
	}

	// ---- issues ----
	header("Issues by severity", "")
	var srows [][]string
	for _, s := range r.Severity {
		srows = append(srows, []string{strings.ToUpper(s.Severity[:1]) + s.Severity[1:], fmt.Sprint(s.Open), fmt.Sprint(s.Resolved), fmt.Sprint(s.Rejected), fmt.Sprint(s.Open + s.Resolved + s.Rejected)})
	}
	table([]string{"Severity", "Open", "Resolved", "Rejected", "Total"}, []float64{40, 25, 25, 25, 25}, []string{"L", "R", "R", "R", "R"}, srows)

	header(fmt.Sprintf("Open issues (%d)", len(r.OpenIssues)), "")
	if len(r.OpenIssues) == 0 {
		empty("None — every issue is resolved or rejected.")
	} else {
		var rows [][]string
		for _, th := range r.OpenIssues {
			rows = append(rows, []string{fmt.Sprintf("#%d", th.ID), fmt.Sprintf("v%d p.%d", th.Revision, th.Page), th.Severity, th.Author, oneLine(th.Body)})
		}
		table([]string{"#", "Where", "Severity", "Raised by", "Issue"}, []float64{12, 20, 18, 30, usable - 80}, []string{"L", "L", "L", "L", "L"}, rows)
	}

	// ---- tasks ----
	header(fmt.Sprintf("Tasks (%d open of %d)", t.OpenTasks, t.Tasks), "")
	if len(r.Tasks) == 0 {
		empty("No tasks.")
	} else {
		var rows [][]string
		for _, tk := range r.Tasks {
			st := "Open"
			if tk.Status == "done" {
				st = "Done " + whenPtr(tk.DoneAt)
			}
			rows = append(rows, []string{fmt.Sprintf("#%d", tk.ID), tk.Title, firstNonEmpty(tk.AssigneeName, "—"), firstNonEmpty(tk.DueDate, "—"), st})
		}
		table([]string{"#", "Task", "Assignee", "Due", "Status"}, []float64{12, usable - 112, 32, 22, 46}, []string{"L", "L", "L", "L", "L"}, rows)
	}

	// ---- every thread ----
	header(fmt.Sprintf("Comments (%d threads, %d messages)", t.Threads, t.Comments), "")
	if len(r.Threads) == 0 {
		empty("No comments.")
	}
	for _, th := range r.Threads {
		if pdf.GetY() > 255 {
			pdf.AddPage()
		}
		y := pdf.GetY()
		sc := map[string][3]int{"open": accent, "resolved": green, "rejected": muted}[th.Status]
		fill(sc)
		pdf.Rect(14, y, 1, 5, "F")
		pdf.SetX(17)
		pdf.SetFont("dv", "B", 8.5)
		kind := th.Kind
		if th.Kind == "issue" {
			kind = th.Severity + " issue"
		}
		head := fmt.Sprintf("#%d · %s · v%d p.%d · %s · %s", th.ID, kind, th.Revision, th.Page, th.Author, When(th.CreatedAt))
		pdf.CellFormat(usable-30, 5, trunc(pdf, head, usable-32), "", 0, "L", false, 0, "")
		color(sc)
		pdf.CellFormat(27, 5, strings.ToUpper(th.Status), "", 1, "R", false, 0, "")
		color(ink)
		pdf.SetFont("dv", "", 8.5)
		if th.Quote != "" {
			pdf.SetX(17)
			color(muted)
			pdf.MultiCell(usable-3, 4.2, "“"+oneLine(th.Quote)+"”", "", "L", false)
			color(ink)
		}
		pdf.SetX(17)
		pdf.MultiCell(usable-3, 4.2, th.Body, "", "L", false)
		for _, rp := range th.Replies {
			pdf.SetX(22)
			pdf.SetFont("dv", "B", 7.5)
			color(muted)
			pdf.CellFormat(0, 4, fmt.Sprintf("%s · %s", rp.Author, When(rp.CreatedAt)), "", 1, "L", false, 0, "")
			color(ink)
			pdf.SetFont("dv", "", 8.5)
			pdf.SetX(22)
			pdf.MultiCell(usable-8, 4.2, rp.Body, "", "L", false)
		}
		if th.Status != "open" {
			pdf.SetX(17)
			pdf.SetFont("dv", "", 7.5)
			color(sc)
			msg := fmt.Sprintf("%s by %s %s", strings.ToUpper(th.Status[:1])+th.Status[1:], firstNonEmpty(th.StatusBy, "someone"), whenPtr(th.StatusAt))
			if th.StatusNote != "" {
				msg += " — " + th.StatusNote
			}
			pdf.MultiCell(usable-3, 4, msg, "", "L", false)
			color(ink)
		}
		pdf.Ln(2.5)
	}
	pdf.Ln(2)

	// ---- sessions ----
	header(fmt.Sprintf("Reading sessions (%d)", len(r.Sessions)), "A session is one sitting; a pause of more than a few minutes starts the next one.")
	if len(r.Sessions) == 0 {
		empty("Nobody has opened the document yet.")
	} else {
		var rows [][]string
		for _, s := range r.Sessions {
			rows = append(rows, []string{s.Name, fmt.Sprintf("v%d", s.Revision), When(s.StartedAt), When(s.LastAt), Duration(s.ActiveSeconds)})
		}
		table([]string{"Who", "Rev.", "From", "To", "Active"}, []float64{45, 14, 40, 40, usable - 139}, []string{"L", "L", "L", "L", "R"}, rows)
	}

	// ---- log ----
	header(fmt.Sprintf("Activity log (%d entries)", len(r.Timeline)), "Everything that happened on the review, oldest first.")
	var lrows [][]string
	for _, e := range r.Timeline {
		lrows = append(lrows, []string{When(e.CreatedAt), firstNonEmpty(e.UserName, "—"), e.Kind, oneLine(e.Summary)})
	}
	table([]string{"When", "Who", "What", "Details"}, []float64{29, 30, 30, usable - 89}, []string{"L", "L", "L", "L"}, lrows)

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// pageList: 1,2,3,7,9,10 → "1–3, 7, 9–10".
func pageList(p []int) string {
	var parts []string
	for i := 0; i < len(p); {
		j := i
		for j+1 < len(p) && p[j+1] == p[j]+1 {
			j++
		}
		if j > i {
			parts = append(parts, fmt.Sprintf("%d–%d", p[i], p[j]))
		} else {
			parts = append(parts, fmt.Sprint(p[i]))
		}
		i = j + 1
	}
	return strings.Join(parts, ", ")
}

func trunc(pdf *fpdf.Fpdf, s string, width float64) string {
	if pdf.GetStringWidth(s) <= width {
		return s
	}
	r := []rune(s)
	for len(r) > 0 && pdf.GetStringWidth(string(r)+"…") > width {
		r = r[:len(r)-1]
	}
	return string(r) + "…"
}
