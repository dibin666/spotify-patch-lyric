package server

/*
 * Live usage statistics: GET /api/stats (JSON) and the /dashboard page.
 *
 * A "user" is a distinct client address seen calling one of the client API
 * endpoints (/api/bindings, /api/bind, /api/unbind, /api/relay) within the
 * active window (STATS_WINDOW_MINUTES, default 15); the platform comes from
 * the request's User-Agent. Addresses are kept in memory only as salted
 * hashes, and one bucket per minute is retained for STATS_RETENTION_HOURS
 * (default 24) plus the window, so the dashboard can chart active users over
 * the last day. Everything is in memory: a restart resets the statistics.
 * STATS=0 turns tracking and both endpoints off.
 */

import (
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

//go:embed dashboard.html
var dashboardHTML []byte

/* One minute of traffic: distinct client keys (with their platform) + request count. */
type statsBucket struct {
	users    map[string]string
	requests int
}

type Stats struct {
	mu      sync.Mutex
	salt    []byte
	window  int64 /* active window, minutes */
	keep    int64 /* minutes of chart history (the window on top is kept for warm-up) */
	since   int64 /* first minute with data, in unix minutes; 0 = none yet */
	lastMin int64 /* minute the buckets were last pruned for */
	buckets map[int64]*statsBucket

	cached   obj
	cachedAt time.Time
}

func NewStats(windowMin, retentionMin int) *Stats {
	if windowMin < 1 {
		windowMin = 15
	}
	if retentionMin < 1 {
		retentionMin = 24 * 60
	}
	s := &Stats{
		salt: make([]byte, 16), window: int64(windowMin), keep: int64(retentionMin),
		buckets: map[int64]*statsBucket{},
	}
	_, _ = rand.Read(s.salt)
	return s
}

/* API paths that indicate a real client; other /api/* noise never becomes a "user". */
func clientPath(path string) bool {
	switch path {
	case "/api/bind", "/api/unbind", "/api/relay":
		return true
	}
	return retired[path] || bindingPathRe.MatchString(path)
}

/* platformFromUA buckets the request's User-Agent into the platform names the dashboard shows. */
func platformFromUA(ua string) string {
	l := strings.ToLower(ua)
	switch {
	case strings.Contains(l, "windows"):
		return "windows"
	case strings.Contains(l, "android"):
		return "android" /* Android UAs also contain "linux" */
	case strings.Contains(l, "iphone"), strings.Contains(l, "ipad"):
		return "ios" /* iOS UAs also contain "Mac OS X" */
	case strings.Contains(l, "mac os"), strings.Contains(l, "macintosh"):
		return "macos"
	case strings.Contains(l, "linux"), strings.Contains(l, "x11"), strings.Contains(l, "cros"):
		return "linux"
	}
	for _, tool := range []string{
		"go-http-client", "curl", "wget", "libfetch", "python", "powershell", "aria2", "okhttp", "node", "undici", "deno",
	} {
		if strings.Contains(l, tool) {
			return "service"
		}
	}
	return "other"
}

/* key is the privacy-preserving client id: a hash of the address under a
 * per-boot random salt, so nothing on disk or in the API can be traced back. */
func (s *Stats) key(addr string) string {
	h := sha256.New()
	_, _ = h.Write(s.salt)
	_, _ = h.Write([]byte(addr))
	return hex.EncodeToString(h.Sum(nil))[:16]
}

/* see records one client API call: the client key joins this minute's bucket. */
func (s *Stats) see(addr, userAgent string, now time.Time) {
	minute := now.Unix() / 60
	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.buckets[minute]
	if b == nil {
		b = &statsBucket{users: map[string]string{}}
		s.buckets[minute] = b
		if s.since == 0 {
			s.since = minute
		}
	}
	b.requests++
	b.users[s.key(addr)] = platformFromUA(userAgent)
	if minute != s.lastMin {
		s.lastMin = minute
		s.cached = nil
		cutoff := minute - s.window - s.keep
		for m := range s.buckets {
			if m < cutoff {
				delete(s.buckets, m)
			}
		}
	}
}

/* snapshot builds the /api/stats answer: per-minute counts of users active in
 * the trailing window (the chart), the current active count, and unique-user /
 * request totals over the retention. Cached a few seconds; dashboards poll. */
func (s *Stats) snapshot(now time.Time) obj {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cached != nil && now.Sub(s.cachedAt) < 5*time.Second {
		return s.cached
	}
	minute := now.Unix() / 60
	start := minute + 1
	if s.since != 0 {
		if start = minute - s.keep + 1; s.since > start {
			start = s.since
		}
	}
	type ref struct {
		platform string
		n        int
	}
	active := map[string]*ref{}
	platforms := map[string]int{}
	add := func(b *statsBucket) {
		for k, p := range b.users {
			if r := active[k]; r != nil {
				r.n++
				if r.platform != p {
					platforms[r.platform]--
					r.platform = p
					platforms[p]++
				}
			} else {
				active[k] = &ref{p, 1}
				platforms[p]++
			}
		}
	}
	remove := func(b *statsBucket) {
		for k := range b.users {
			if r := active[k]; r != nil {
				if r.n--; r.n == 0 {
					platforms[r.platform]--
					delete(active, k)
				}
			}
		}
	}
	/* At minute m the window covers buckets (m-window, m]: slide it over the
	 * kept range, pre-warmed by the extra window of buckets retained. */
	series := []obj{}
	added, removed := start-s.window, start-s.window
	var requests int64
	all := map[string]bool{}
	platformsCopy := func() map[string]int {
		p := make(map[string]int, len(platforms))
		for name, n := range platforms {
			if n > 0 {
				p[name] = n
			}
		}
		return p
	}
	for m := start; m <= minute; m++ {
		for added < m {
			added++
			if b := s.buckets[added]; b != nil {
				add(b)
			}
		}
		for removed < m-s.window {
			removed++
			if b := s.buckets[removed]; b != nil {
				remove(b)
			}
		}
		req := 0
		if b := s.buckets[m]; b != nil {
			req = b.requests
			requests += int64(b.requests)
			for k := range b.users {
				all[k] = true
			}
		}
		series = append(series, obj{"t": m * 60, "users": len(active), "requests": req, "platforms": platformsCopy()})
	}
	var since int64
	if s.since != 0 {
		since = s.since * 60
	}
	result := obj{
		"now": now.Unix(), "since": since,
		"window_minutes": s.window, "retention_minutes": s.keep,
		"active_users": len(active), "platforms": platformsCopy(),
		"unique_users": len(all), "requests": requests,
		"series": series,
	}
	s.cached, s.cachedAt = result, now
	return result
}
