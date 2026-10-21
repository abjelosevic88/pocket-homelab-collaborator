package server

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/abjelosevic88/pocket-homelab-collaborator/internal/store"
	core "github.com/abjelosevic88/pocket-homelab-core/sdk"
)

// Pocket Core app links: another Pocket app (Office, Documents) may act here
// for a person with a pcx_ token, only within these scopes. Every route not
// listed in linkRoutes stays closed to it.

var linkOffers = []core.Offer{
	{Scope: "reviews:read", Name: "See your reviews", Description: "List your reviews and look up whether a file sent from another app is in review (the badge Pocket Office and Pocket Documents show)."},
	{Scope: "reviews:write", Name: "Send documents for review", Description: "Start a review from a document in another app, add a new revision to one, and keep the link back to the original up to date."},
}

type linkRoute struct {
	methods string
	path    *regexp.Regexp
	scope   string
}

var linkRoutes = []linkRoute{
	{"GET", regexp.MustCompile(`^/api/v1/auth/me$`), ""},
	{"GET", regexp.MustCompile(`^/api/v1/(reviews|reviews/lookup|dashboard)$`), "reviews:read"},
	{"GET", regexp.MustCompile(`^/api/v1/reviews/\d+/?$`), "reviews:read"},
	{"POST", regexp.MustCompile(`^/api/v1/reviews/import$`), "reviews:write"},
	{"POST", regexp.MustCompile(`^/api/v1/reviews/\d+/revisions$`), "reviews:write"},
	{"PUT", regexp.MustCompile(`^/api/v1/reviews/\d+/?$`), "reviews:write"},
	{"POST", regexp.MustCompile(`^/api/v1/reviews/\d+/status$`), "reviews:write"},
}

var errLinkScope = errors.New("outside the link's scope")

func linkAllows(scopes []string, r *http.Request) bool {
	for _, lr := range linkRoutes {
		if !strings.Contains(" "+lr.methods+" ", " "+r.Method+" ") || !lr.path.MatchString(r.URL.Path) {
			continue
		}
		if lr.scope == "" {
			return true
		}
		for _, sc := range scopes {
			if sc == lr.scope {
				return true
			}
		}
	}
	return false
}

// linkUser validates a pcx_ token and maps it to the person it acts for.
func (s *Server) linkUser(ctx context.Context, tok string, r *http.Request) (*store.User, error) {
	in, err := s.core.Introspect(ctx, tok)
	if err != nil {
		return nil, err
	}
	if !in.Active || !in.Delegated() || in.User == nil || in.User.Email == "" {
		return nil, http.ErrNoCookie
	}
	if !linkAllows(strings.Fields(in.Scope), r) {
		return nil, errLinkScope
	}
	return s.coreIdentityUser(ctx, in)
}
