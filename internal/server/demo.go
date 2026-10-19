package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-pdf/fpdf"

	"github.com/abjelosevic88/pocket-homelab-collaborator/internal/store"
)

// seedDemo fills an empty database with a contract under review, a draft and
// a finished review, so screenshots and first impressions work. The PDFs are
// generated here; comments point at real clauses; review time is made up but
// shaped like the real thing.
func (s *Server) seedDemo(ctx context.Context) error {
	var n int
	_ = s.store.DB.QueryRowContext(ctx, `SELECT COUNT(1) FROM reviews`).Scan(&n)
	if n > 0 {
		return nil
	}
	users, _ := s.store.ListUsers(ctx)
	if len(users) == 0 {
		u := &store.User{Email: "admin@localhost", Name: "Ana", Role: "admin"}
		if err := s.store.CreateUser(ctx, u); err != nil {
			return err
		}
		users = []store.User{*u}
	}
	ana := &users[0]
	person := func(email, name string) (*store.User, error) {
		if u, err := s.store.GetUserByEmail(ctx, email); err == nil {
			return u, nil
		}
		u := &store.User{Email: email, Name: name, Role: "member"}
		return u, s.store.CreateUser(ctx, u)
	}
	ben, err := person("ben@example.com", "Ben Hadžić")
	if err != nil {
		return err
	}
	marko, _ := person("marko@example.com", "Marko Petrović")
	jelena, _ := person("jelena@example.com", "Jelena Kovač")
	sara, _ := person("sara@example.com", "Sara Lind")

	now := time.Now()
	at := func(d time.Duration) string { return now.Add(-d).UTC().Format(time.RFC3339Nano) }
	exec := func(q string, args ...any) {
		if _, err := s.store.DB.ExecContext(ctx, q, args...); err != nil {
			s.log.Warn("demo", "err", err, "q", q)
		}
	}
	logAt := func(rid, uid int64, kind, summary string, ago time.Duration, extra ...int64) {
		var cid, tid, vid, page int64
		if len(extra) > 0 {
			cid = extra[0]
		}
		if len(extra) > 1 {
			tid = extra[1]
		}
		if len(extra) > 2 {
			vid = extra[2]
		}
		if len(extra) > 3 {
			page = extra[3]
		}
		exec(`INSERT INTO events (review_id, user_id, kind, comment_id, task_id, revision_id, page, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			rid, uid, kind, nid(cid), nid(tid), nid(vid), page, summary, at(ago))
	}
	addRev := func(rv *store.Review, b []byte, name, note string, pages int, uid int64, ago time.Duration) (*store.Revision, error) {
		sum := sha256.Sum256(b)
		hexsum := hex.EncodeToString(sum[:])
		rel := filepath.Join(strconv.FormatInt(rv.ID, 10), hexsum+".pdf")
		if err := os.MkdirAll(filepath.Join(s.cfg.FilesDir, strconv.FormatInt(rv.ID, 10)), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(filepath.Join(s.cfg.FilesDir, rel), b, 0o644); err != nil {
			return nil, err
		}
		rev := &store.Revision{ReviewID: rv.ID, Kind: "pdf", Filename: name, Mime: "application/pdf", Size: int64(len(b)), SHA256: hexsum,
			StoragePath: rel, PageCount: pages, Note: note, UploadedBy: uid}
		if err := s.store.AddRevision(ctx, rev); err != nil {
			return nil, err
		}
		exec(`UPDATE revisions SET created_at = ? WHERE id = ?`, at(ago), rev.ID)
		logAt(rv.ID, uid, "revision.uploaded", fmt.Sprintf("Uploaded v%d: %s%s", rev.Number, name, map[bool]string{true: " — " + note, false: ""}[note != ""]), ago, 0, 0, rev.ID)
		return rev, nil
	}
	newReview := func(title, desc string, owner int64, ago time.Duration) (*store.Review, error) {
		rv := &store.Review{Title: title, Description: desc, Kind: "pdf", OwnerID: owner, RequireResolved: true}
		if err := s.store.CreateReview(ctx, rv); err != nil {
			return nil, err
		}
		exec(`UPDATE reviews SET created_at = ? WHERE id = ?`, at(ago), rv.ID)
		exec(`UPDATE participants SET added_at = ? WHERE review_id = ?`, at(ago), rv.ID)
		logAt(rv.ID, owner, "review.created", title, ago)
		return rv, nil
	}
	addPeople := func(rv *store.Review, ago time.Duration, ps ...struct {
		u    *store.User
		role string
	}) {
		for _, p := range ps {
			_ = s.store.AddParticipant(ctx, rv.ID, p.u.ID, p.role, rv.OwnerID)
			exec(`UPDATE participants SET added_at = ? WHERE review_id = ? AND user_id = ?`, at(ago), rv.ID, p.u.ID)
			logAt(rv.ID, rv.OwnerID, "participant.added", fmt.Sprintf("Added %s as %s", p.u.Name, p.role), ago)
		}
	}
	type pr = struct {
		u    *store.User
		role string
	}
	comment := func(rv *store.Review, rev *store.Revision, u *store.User, kind, sev, body string, a anchorAt, ago time.Duration) *store.Comment {
		c := &store.Comment{ReviewID: rv.ID, RevisionID: rev.ID, AuthorID: u.ID, Kind: kind, Severity: sev, Body: body, Page: a.page,
			Anchor: &store.Anchor{Rects: []store.Rect{a.rect}, Quote: a.quote}}
		_ = s.store.CreateComment(ctx, c)
		exec(`UPDATE comments SET created_at = ? WHERE id = ?`, at(ago), c.ID)
		ek, verb := "comment.added", "Commented"
		switch kind {
		case "issue":
			ek, verb = "issue.raised", "Raised a "+sev+" issue"
		case "question":
			ek, verb = "question.asked", "Asked"
		}
		logAt(rv.ID, u.ID, ek, fmt.Sprintf("%s #%d: %s", verb, c.ID, snippet(body, 120)), ago, c.ID, 0, rev.ID, int64(a.page))
		return c
	}
	reply := func(rv *store.Review, root *store.Comment, u *store.User, body string, ago time.Duration) {
		c := &store.Comment{ReviewID: rv.ID, RevisionID: root.RevisionID, ParentID: root.ID, AuthorID: u.ID, Kind: "comment", Body: body, Page: root.Page}
		_ = s.store.CreateComment(ctx, c)
		exec(`UPDATE comments SET created_at = ? WHERE id = ?`, at(ago), c.ID)
		logAt(rv.ID, u.ID, "comment.replied", fmt.Sprintf("Replied to #%d: %s", root.ID, snippet(body, 120)), ago, c.ID, 0, root.RevisionID, int64(root.Page))
	}
	closeThread := func(rv *store.Review, c *store.Comment, u *store.User, status, note string, ago time.Duration) {
		exec(`UPDATE comments SET status = ?, status_note = ?, status_by = ?, status_at = ? WHERE id = ?`, status, note, u.ID, at(ago), c.ID)
		verb := map[string]string{"resolved": "Resolved", "rejected": "Rejected"}[status]
		logAt(rv.ID, u.ID, "comment."+status, fmt.Sprintf("%s #%d — %s", verb, c.ID, note), ago, c.ID, 0, c.RevisionID, int64(c.Page))
	}
	rng := rand.New(rand.NewSource(7))
	// reading: per person, sessions over the revision's pages with weights
	read := func(rv *store.Review, rev *store.Revision, u *store.User, startAgo time.Duration, perPage []int) {
		t := now.Add(-startAgo)
		total := 0
		sessStart := t
		for p, base := range perPage {
			if base <= 0 || p >= rev.PageCount {
				continue
			}
			sec := base + rng.Intn(base/3+1)
			exec(`INSERT INTO page_time (review_id, revision_id, user_id, page, seconds, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(review_id, revision_id, user_id, page) DO UPDATE SET seconds = seconds + excluded.seconds`,
				rv.ID, rev.ID, u.ID, p+1, sec, t.UTC().Format(time.RFC3339Nano), t.Add(time.Duration(sec)*time.Second).UTC().Format(time.RFC3339Nano))
			t = t.Add(time.Duration(sec) * time.Second)
			total += sec
		}
		exec(`INSERT INTO reading_sessions (review_id, user_id, revision_id, started_at, last_at, active_seconds) VALUES (?, ?, ?, ?, ?, ?)`,
			rv.ID, u.ID, rev.ID, sessStart.UTC().Format(time.RFC3339Nano), t.UTC().Format(time.RFC3339Nano), total)
		exec(`UPDATE participants SET first_opened_at = COALESCE(first_opened_at, ?), last_seen_at = ?, state = CASE WHEN state = 'invited' THEN 'reviewing' ELSE state END
			WHERE review_id = ? AND user_id = ?`, sessStart.UTC().Format(time.RFC3339Nano), t.UTC().Format(time.RFC3339Nano), rv.ID, u.ID)
		exec(`INSERT INTO events (review_id, user_id, kind, revision_id, page, summary, created_at) VALUES (?, ?, 'session.started', ?, 1, ?, ?)`,
			rv.ID, u.ID, rev.ID, fmt.Sprintf("Started a reading session on v%d, page 1", rev.Number), sessStart.UTC().Format(time.RFC3339Nano))
	}
	verdict := func(rv *store.Review, u *store.User, v, note, summary string, ago time.Duration) {
		exec(`UPDATE participants SET verdict = ?, verdict_note = ?, verdict_at = ?, state = 'done' WHERE review_id = ? AND user_id = ?`, v, note, at(ago), rv.ID, u.ID)
		logAt(rv.ID, u.ID, "verdict."+v, summary, ago)
	}

	// ---- 1. A contract in its second round ----
	day := 24 * time.Hour
	rv, err := newReview("Master Services Agreement — Northwind × Pocket Labs",
		"Second round after legal's first pass. Focus on payment terms, liability cap and the data-protection annex. Ben signs off.", ana.ID, 6*day)
	if err != nil {
		return err
	}
	v1pdf, _ := demoContract(1)
	rev1, err := addRev(rv, v1pdf.pdf, "msa-northwind-v1.pdf", "", v1pdf.pages, ana.ID, 6*day-time.Hour)
	if err != nil {
		return err
	}
	addPeople(rv, 6*day-50*time.Minute, pr{ben, store.RoleApprover}, pr{marko, store.RoleReviewer}, pr{jelena, store.RoleReviewer}, pr{sara, store.RoleObserver})
	exec(`UPDATE reviews SET status = 'in_review', started_at = ? WHERE id = ?`, at(6*day-40*time.Minute), rv.ID)
	logAt(rv.ID, ana.ID, "review.started", "Started the review", 6*day-40*time.Minute, 0, 0, rev1.ID)

	a1 := v1pdf.anchors
	read(rv, rev1, marko, 5*day+3*time.Hour, []int{60, 140, 300, 90, 260, 70})
	read(rv, rev1, jelena, 5*day+time.Hour, []int{40, 90, 200, 40, 120, 30})
	read(rv, rev1, ben, 4*day+5*time.Hour, []int{30, 60, 150, 50, 160, 40})
	c1 := comment(rv, rev1, marko, "issue", "major", "Net 30 is shorter than our standard. Finance asked for net 45 on all new vendor agreements.", a1["payment"], 5*day+2*time.Hour)
	c2 := comment(rv, rev1, marko, "issue", "critical", "The liability cap excludes data breaches entirely — that leaves us uncapped on the one risk that actually matters here.", a1["liability"], 5*day+time.Hour+40*time.Minute)
	c3 := comment(rv, rev1, jelena, "question", "", "Does \"Business Day\" follow Bosnian or Irish holidays? Both offices sign.", a1["definitions"], 5*day+30*time.Minute)
	reply(rv, c3, ana, "Irish — the governing law is Ireland. I'll make it explicit.", 5*day)
	c4 := comment(rv, rev1, jelena, "issue", "minor", "Typo: \"recieve\".", a1["notices"], 5*day+20*time.Minute)
	reply(rv, c1, ana, "Agreed, changed to net 45 in v2.", 3*day+2*time.Hour)
	closeThread(rv, c1, marko, "resolved", "Net 45 in v2.", 2*day+20*time.Hour)
	closeThread(rv, c3, jelena, "resolved", "Clarified in the definition.", 2*day+19*time.Hour)
	closeThread(rv, c4, ana, "resolved", "Fixed.", 3*day+2*time.Hour)
	reply(rv, c2, ben, "Agree this is the main point. Legal suggests a separate super-cap for data incidents at 3× annual fees.", 4*day+4*time.Hour)

	exec(`UPDATE reviews SET status = 'changes_requested' WHERE id = ?`, rv.ID)
	verdict(rv, ben, "changes", "Liability for data incidents needs a cap before I can approve.", "Requested changes — Liability for data incidents needs a cap before I can approve.", 4*day+3*time.Hour)
	logAt(rv.ID, ben.ID, "review.changes_requested", "The review is now waiting for changes", 4*day+3*time.Hour)

	v2pdf, _ := demoContract(2)
	rev2, err := addRev(rv, v2pdf.pdf, "msa-northwind-v2.pdf", "Net 45, data-incident super-cap, holiday calendar", v2pdf.pages, ana.ID, 3*day+time.Hour)
	if err != nil {
		return err
	}
	exec(`UPDATE participants SET verdict = '', verdict_note = '', verdict_at = NULL, state = 'reviewing' WHERE review_id = ? AND role <> 'owner'`, rv.ID)
	exec(`UPDATE reviews SET status = 'in_review' WHERE id = ?`, rv.ID)
	logAt(rv.ID, ana.ID, "review.resumed", "Back in review with v2", 3*day+time.Hour, 0, 0, rev2.ID)
	a2 := v2pdf.anchors
	read(rv, rev2, marko, 2*day+22*time.Hour, []int{20, 50, 240, 40, 280, 60})
	read(rv, rev2, jelena, 2*day+20*time.Hour, []int{25, 30, 120, 20, 90, 0})
	read(rv, rev2, ben, 26*time.Hour, []int{20, 40, 180, 30, 210, 50})
	read(rv, rev2, sara, 30*time.Hour, []int{40, 0, 60, 0, 0, 0})
	c5 := comment(rv, rev2, marko, "issue", "major", "3× annual fees is fine, but the super-cap should also cover regulatory fines, not only third-party claims.", a2["liability"], 2*day+21*time.Hour)
	reply(rv, c5, ana, "Fines are usually uninsurable — let me check with our broker before we commit.", 2*day+5*time.Hour)
	reply(rv, c2, marko, "v2 adds the super-cap — see my follow-up below for the remaining gap.", 2*day+21*time.Hour)
	closeThread(rv, c2, ben, "resolved", "Super-cap added in v2.", 25*time.Hour)
	c6 := comment(rv, rev2, jelena, "comment", "", "The sub-processor list should be an annex we can update by notice, not part of the main body.", a2["data"], 2*day+19*time.Hour)
	closeThread(rv, c6, ana, "rejected", "Northwind insists on it being in the body; notice-based updates are covered in 6.4.", 2*day+3*time.Hour)
	c7 := comment(rv, rev2, ben, "issue", "minor", "Termination for convenience: 60 days' notice here, 90 in the order form. Pick one.", a2["termination"], 25*time.Hour)
	_ = comment(rv, rev2, ben, "question", "", "Is the governing-law clause still Ireland after the entity change?", a2["law"], 24*time.Hour)
	verdict(rv, marko, "approved", "", "Finished reviewing: looks good", 2*day+20*time.Hour)

	t1 := &store.Task{ReviewID: rv.ID, CommentID: c5.ID, Title: "Ask the broker whether regulatory fines are insurable", AssigneeID: ana.ID, DueDate: now.AddDate(0, 0, 2).Format("2006-01-02"), CreatedBy: ana.ID}
	_ = s.store.CreateTask(ctx, t1)
	logAt(rv.ID, ana.ID, "task.added", fmt.Sprintf("Added task #%d: %s → Ana (from #%d)", t1.ID, t1.Title, c5.ID), 2*day+5*time.Hour, c5.ID, t1.ID)
	t2 := &store.Task{ReviewID: rv.ID, CommentID: c7.ID, Title: "Align termination notice with the order form", AssigneeID: ana.ID, DueDate: now.AddDate(0, 0, 3).Format("2006-01-02"), CreatedBy: ben.ID}
	_ = s.store.CreateTask(ctx, t2)
	logAt(rv.ID, ben.ID, "task.added", fmt.Sprintf("Added task #%d: %s → Ana (from #%d)", t2.ID, t2.Title, c7.ID), 24*time.Hour, c7.ID, t2.ID)
	t3 := &store.Task{ReviewID: rv.ID, Title: "Send v2 redline to Northwind legal", AssigneeID: jelena.ID, CreatedBy: ana.ID}
	_ = s.store.CreateTask(ctx, t3)
	exec(`UPDATE tasks SET status = 'done', done_by = ?, done_at = ? WHERE id = ?`, jelena.ID, at(2*day), t3.ID)
	logAt(rv.ID, jelena.ID, "task.done", fmt.Sprintf("Completed task #%d: %s", t3.ID, t3.Title), 2*day, 0, t3.ID)
	exec(`UPDATE reviews SET updated_at = ? WHERE id = ?`, at(time.Hour), rv.ID)

	// ---- 2. A draft not started yet ----
	rd, err := newReview("Brand guidelines 2027", "Logo clear-space, the new accent colour, and tone of voice. Not ready yet.", ana.ID, 20*time.Hour)
	if err != nil {
		return err
	}
	brand, _ := demoBrand()
	if _, err := addRev(rd, brand.pdf, "brand-guidelines-2027-draft.pdf", "", brand.pages, ana.ID, 19*time.Hour); err != nil {
		return err
	}
	addPeople(rd, 19*time.Hour, pr{marko, store.RoleReviewer})

	// ---- 3. A finished review where Ana was a reviewer ----
	rf, err := newReview("Onboarding handbook", "Yearly refresh of the handbook for new starters.", ben.ID, 14*day)
	if err != nil {
		return err
	}
	hb, _ := demoHandbook()
	revh, err := addRev(rf, hb.pdf, "onboarding-handbook.pdf", "", hb.pages, ben.ID, 14*day-time.Hour)
	if err != nil {
		return err
	}
	addPeople(rf, 14*day-50*time.Minute, pr{ana, store.RoleReviewer}, pr{jelena, store.RoleApprover})
	exec(`UPDATE reviews SET status = 'in_review', started_at = ? WHERE id = ?`, at(14*day-45*time.Minute), rf.ID)
	logAt(rf.ID, ben.ID, "review.started", "Started the review", 14*day-45*time.Minute)
	read(rf, revh, ana, 13*day, []int{50, 70, 60, 80})
	read(rf, revh, jelena, 12*day, []int{30, 40, 40, 50})
	h1 := comment(rf, revh, ana, "issue", "minor", "The VPN section still links to the old wiki.", hb.anchors["vpn"], 13*day-10*time.Minute)
	closeThread(rf, h1, ben, "resolved", "Link updated.", 12*day+4*time.Hour)
	verdict(rf, ana, "approved", "", "Finished reviewing: looks good", 13*day-5*time.Minute)
	verdict(rf, jelena, "approved", "Good to publish.", "Approved — Good to publish.", 12*day)
	exec(`UPDATE reviews SET status = 'approved', decided_at = ?, updated_at = ? WHERE id = ?`, at(12*day), at(12*day), rf.ID)
	logAt(rf.ID, jelena.ID, "review.approved", "The review is now approved", 12*day)

	s.log.Info("demo data seeded", "reviews", 3)
	return nil
}

// ---- generated documents ----

type anchorAt struct {
	page  int
	rect  store.Rect
	quote string
}

type demoDoc struct {
	pdf     []byte
	pages   int
	anchors map[string]anchorAt
}

type section struct {
	key, title string
	paras      []string
	newPage    bool
}

// render lays sections out on A4 and records where each section's first
// paragraph landed, in 0..1 page units, so demo comments point at it.
func render(title, subtitle string, sections []section) (*demoDoc, error) {
	const pw, ph = 210.0, 297.0
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(22, 22, 22)
	pdf.SetAutoPageBreak(true, 22)
	pdf.SetFooterFunc(func() {
		pdf.SetY(-14)
		pdf.SetFont("Helvetica", "", 8)
		pdf.SetTextColor(140, 140, 140)
		pdf.CellFormat(0, 5, title, "", 0, "L", false, 0, "")
		pdf.CellFormat(0, 5, fmt.Sprintf("Page %d", pdf.PageNo()), "", 0, "R", false, 0, "")
	})
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 20)
	pdf.SetTextColor(20, 20, 30)
	pdf.MultiCell(0, 9, tr(title), "", "L", false)
	pdf.SetFont("Helvetica", "", 10)
	pdf.SetTextColor(110, 110, 120)
	pdf.MultiCell(0, 5, tr(subtitle), "", "L", false)
	pdf.Ln(6)
	doc := &demoDoc{anchors: map[string]anchorAt{}}
	for _, s := range sections {
		if s.newPage {
			pdf.AddPage()
		}
		if pdf.GetY() > 230 {
			pdf.AddPage()
		}
		pdf.SetFont("Helvetica", "B", 12)
		pdf.SetTextColor(20, 20, 30)
		pdf.MultiCell(0, 7, tr(s.title), "", "L", false)
		pdf.Ln(1)
		pdf.SetFont("Helvetica", "", 10)
		pdf.SetTextColor(40, 40, 50)
		for i, p := range s.paras {
			y0, page := pdf.GetY(), pdf.PageNo()
			pdf.MultiCell(0, 5.2, tr(p), "", "J", false)
			if i == 0 && s.key != "" && pdf.PageNo() == page {
				y1 := pdf.GetY()
				quote := p
				if len(quote) > 140 {
					quote = quote[:140] + "…"
				}
				doc.anchors[s.key] = anchorAt{page: page, rect: store.Rect{X: 22 / pw, Y: y0 / ph, W: (pw - 44) / pw, H: (y1 - y0) / ph}, quote: quote}
			}
			pdf.Ln(2.5)
		}
		pdf.Ln(3)
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	doc.pdf, doc.pages = buf.Bytes(), pdf.PageNo()
	return doc, nil
}

func demoContract(version int) (*demoDoc, error) {
	net, liab, notice, holidays := "thirty (30)", "The limitations in this Section do not apply to breaches of Section 6 (Data Protection), for which liability is unlimited.", "sixty (60)", ""
	if version > 1 {
		net = "forty-five (45)"
		liab = "For claims arising from a breach of Section 6 (Data Protection), each party's aggregate liability shall not exceed three times (3x) the Fees paid or payable in the twelve (12) months preceding the claim (the \"Data Incident Cap\")."
		holidays = " Business Days follow the public holidays of Ireland."
	}
	lorem := "Each party shall act in good faith and with reasonable skill and care, and shall keep records sufficient to demonstrate compliance with this Agreement for the duration of the Term and for two years thereafter."
	return render("Master Services Agreement", fmt.Sprintf("Northwind Traders Ltd. and Pocket Labs d.o.o. · Draft v%d · Confidential", version), []section{
		{key: "parties", title: "Parties", paras: []string{
			"This Master Services Agreement (the \"Agreement\") is entered into between Northwind Traders Ltd., a company incorporated in Ireland (\"Customer\"), and Pocket Labs d.o.o., a company incorporated in Bosnia and Herzegovina (\"Provider\").",
			lorem}},
		{key: "definitions", title: "1. Definitions", paras: []string{
			"\"Business Day\" means a day other than a Saturday, Sunday or public holiday on which banks are open for business." + holidays,
			"\"Confidential Information\" means any information disclosed by one party to the other that is marked confidential or that a reasonable person would understand to be confidential.",
			"\"Services\" means the services described in each Order Form, including any deliverables, documentation and support provided by Provider.",
			"\"Fees\" means the amounts payable by Customer for the Services as set out in an Order Form."}},
		{key: "services", title: "2. Services", paras: []string{
			"Provider shall provide the Services in accordance with this Agreement and each Order Form. Where an Order Form conflicts with this Agreement, this Agreement prevails unless the Order Form expressly states otherwise.",
			lorem, "Provider may use subcontractors to perform the Services, provided Provider remains responsible for their acts and omissions as if they were its own."}},
		{key: "payment", title: "3. Fees and Payment", newPage: true, paras: []string{
			"Customer shall pay all undisputed invoices within " + net + " days of receipt. Late payments bear interest at the rate of one percent (1%) per month or the maximum permitted by law, whichever is lower.",
			"All Fees are exclusive of VAT and other applicable taxes, which Customer shall pay in addition to the Fees.",
			"Provider may increase the Fees once per year on ninety (90) days' written notice, by no more than the change in the Euro area HICP over the preceding twelve months.", lorem}},
		{key: "termination", title: "4. Term and Termination", paras: []string{
			"Either party may terminate this Agreement for convenience on " + notice + " days' written notice to the other party.",
			"Either party may terminate this Agreement immediately by written notice if the other party commits a material breach that is not remedied within thirty (30) days of being notified of it.",
			"On termination, Customer shall pay all Fees for Services performed up to the effective date of termination."}},
		{key: "confidentiality", title: "5. Confidentiality", newPage: true, paras: []string{
			"Each party shall keep the other party's Confidential Information confidential and use it only to perform its obligations or exercise its rights under this Agreement.", lorem, lorem}},
		{key: "data", title: "6. Data Protection", paras: []string{
			"Provider shall process personal data only on Customer's documented instructions and in accordance with the Data Processing Addendum. The current list of sub-processors is: Hetzner Online GmbH (hosting), Postmark (transactional email), and Sentry (error monitoring).",
			"Provider shall notify Customer without undue delay, and in any event within forty-eight (48) hours, after becoming aware of a personal data breach.",
			"6.4 Provider may add or replace a sub-processor by giving Customer thirty (30) days' notice, during which Customer may object on reasonable grounds.", lorem}},
		{key: "warranties", title: "7. Warranties", newPage: true, paras: []string{
			"Provider warrants that the Services will be performed in a professional and workmanlike manner in accordance with generally accepted industry standards.", lorem}},
		{key: "liability", title: "8. Limitation of Liability", paras: []string{
			"Except for liability that cannot be limited by law, each party's aggregate liability arising out of or in connection with this Agreement shall not exceed the Fees paid or payable in the twelve (12) months preceding the event giving rise to the claim. " + liab,
			"Neither party shall be liable for any indirect, incidental, special or consequential damages, or for loss of profits, revenue or goodwill.", lorem}},
		{key: "law", title: "9. Governing Law and Jurisdiction", newPage: true, paras: []string{
			"This Agreement and any dispute arising from it shall be governed by the laws of Ireland, and the courts of Dublin shall have exclusive jurisdiction.", lorem}},
		{key: "notices", title: "10. Notices", paras: []string{
			"Notices under this Agreement shall be in writing and are deemed to have been recieved when delivered by hand, or two Business Days after being sent by email to the addresses in the Order Form.", lorem}},
		{key: "signatures", title: "Signatures", paras: []string{
			"Signed for and on behalf of Northwind Traders Ltd.:  ______________________   Date: ____________",
			"Signed for and on behalf of Pocket Labs d.o.o.:  ______________________   Date: ____________"}},
	})
}

func demoBrand() (*demoDoc, error) {
	return render("Brand guidelines 2027", "Draft for internal review", []section{
		{key: "logo", title: "1. Logo", paras: []string{"Keep a clear space around the logo equal to the height of the P. Never stretch, rotate or recolour it.", "On photographs, use the white logo on a 40% black scrim."}},
		{key: "colour", title: "2. Colour", paras: []string{"The new accent is a warm fuchsia (#C026D3). Use it for one thing per screen: the action we want people to take.", "Neutrals carry everything else."}},
		{key: "voice", title: "3. Tone of voice", newPage: true, paras: []string{"Plain words, short sentences, active voice. Write like a helpful colleague, not like a bank.", "Say what happens, not what the feature is called."}},
	})
}

func demoHandbook() (*demoDoc, error) {
	return render("Onboarding handbook", "For new starters", []section{
		{key: "welcome", title: "Welcome", paras: []string{"This handbook covers your first two weeks: accounts, equipment, who to ask, and how we work."}},
		{key: "vpn", title: "Accounts and VPN", paras: []string{"Request your accounts on day one. The VPN set-up guide is on the old wiki under IT > Remote access."}},
		{key: "people", title: "Who to ask", newPage: true, paras: []string{"Your buddy for the first month, your lead for priorities, and #help for everything else."}},
		{key: "work", title: "How we work", newPage: true, paras: []string{"Small changes, reviewed early. Write things down. Leave the campsite cleaner than you found it."}},
	})
}

// nid stores 0 as NULL.
func nid(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}
