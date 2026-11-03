package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestRelayAllowed(t *testing.T) {
	cases := []struct {
		method, url string
		want        bool
	}{
		{"POST", "https://u.y.qq.com/cgi-bin/musicu.fcg", true},
		{"POST", "https://u.y.qq.com/cgi-bin/musics.fcg?sign=zzcabc", true},
		{"GET", "https://music.163.com/api/song/lyric?id=1", true},
		{"GET", "https://music.163.com:8443/api/song/lyric", false},
		{"GET", "http://music.163.com/api/song/lyric", false},
		{"GET", "https://evil.example/api/search/get/web", false},
		{"GET", "https://music.163.com/weapi/user/account", false},
		{"DELETE", "https://music.163.com/api/song/lyric?id=1", false},
		{"GET", "https://user@music.163.com/api/song/lyric", false},
		/* comments plugin endpoints */
		{"GET", "https://music.163.com/api/v1/resource/comments/R_SO_4_347230?limit=20&offset=0", true},
		{"POST", "https://music.163.com/api/login/qrcode/unikey", true},
		{"POST", "https://music.163.com/api/login/qrcode/client/login", true},
		{"POST", "https://music.163.com/api/v1/comment/like", true},
		{"POST", "https://music.163.com/weapi/login/cellphone", true},
		{"POST", "https://music.163.com/weapi/captcha/sent", true},
		{"POST", "https://music.163.com/weapi/v1/resource/comments/add", true},
		{"POST", "https://music.163.com/weapi/w/nuser/account/get", true},
		{"GET", "https://u.y.qq.com/api/v1/resource/comments/x", false},
		{"GET", "https://music.163.com/api/v2/other", false},
	}
	for _, c := range cases {
		if got := relayAllowed(c.method, c.url); got != c.want {
			t.Errorf("relayAllowed(%s %s) = %v, want %v", c.method, c.url, got, c.want)
		}
	}
}

func TestEncodeKey(t *testing.T) {
	if got := encodeKey("lyrics/a b!'()*~.json"); got != "lyrics/a%20b%21%27%28%29%2A~.json" {
		t.Errorf("encodeKey = %q", got)
	}
}

func TestRelayThroughApp(t *testing.T) {
	cfg := loadConfig(func(k string) (string, bool) { return "", false })
	cfg.DataDir = t.TempDir()
	fake := func(_ context.Context, r UpstreamRequest) (*UpstreamResponse, error) {
		return &UpstreamResponse{Status: 200, Body: `{"code":200,"url":"` + r.URL + `"}`}, nil
	}
	app := NewApp(cfg, &DirBucket{dir: cfg.DataDir}, fake)
	srv := httptest.NewServer(app)
	defer srv.Close()

	post := func(body string) (int, map[string]any) {
		resp, err := http.Post(srv.URL+"/api/relay", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		var out map[string]any
		_ = json.Unmarshal(data, &out)
		return resp.StatusCode, out
	}
	if code, out := post(`{"method":"GET","url":"https://music.163.com/api/song/lyric?id=7"}`); code != 200 || out["status"] != float64(200) {
		t.Errorf("allowed relay: %d %v", code, out)
	}
	if code, _ := post(`{"method":"GET","url":"https://evil.example/api/song/lyric"}`); code != 400 {
		t.Errorf("evil host: %d", code)
	}
}

func TestPlatformFromUA(t *testing.T) {
	cases := []struct{ ua, want string }{
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Spotify/1.2.40", "windows"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 Spotify/1.2.40", "macos"},
		{"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Spotify/1.2.40", "linux"},
		{"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36", "android"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/537.36", "ios"},
		{"Go-http-client/2.0", "service"},
		{"curl/8.4.0", "service"},
		{"", "other"},
		{"Mozilla/5.0 (PlayStation 5)", "other"},
	}
	for _, c := range cases {
		if got := platformFromUA(c.ua); got != c.want {
			t.Errorf("platformFromUA(%q) = %q, want %q", c.ua, got, c.want)
		}
	}
}

func TestStatsEndpoint(t *testing.T) {
	cfg := loadConfig(func(k string) (string, bool) { return "", false })
	cfg.DataDir = t.TempDir()
	fake := func(_ context.Context, r UpstreamRequest) (*UpstreamResponse, error) {
		return &UpstreamResponse{Status: 200, Body: "{}"}, nil
	}
	app := NewApp(cfg, &DirBucket{dir: cfg.DataDir}, fake)
	srv := httptest.NewServer(app)
	defer srv.Close()

	hit := func(ip, ua string) {
		req, _ := http.NewRequest("GET", srv.URL+"/api/bindings/AAAAAAAAAAAAAAAAAAAAAA", nil)
		req.Header.Set("X-Forwarded-For", ip) /* TrustProxy defaults to on */
		req.Header.Set("User-Agent", ua)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}
	hit("1.1.1.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Spotify/1.2.40")
	hit("2.2.2.2", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Spotify/1.2.40")
	hit("2.2.2.2", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Spotify/1.2.40")
	/* dashboard page */
	resp, err := http.Get(srv.URL + "/dashboard")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("dashboard: %v %v", resp.StatusCode, err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(resp.Header.Get("Content-Type"), "text/html") || !strings.Contains(string(body), "服务器状态") {
		t.Error("dashboard did not serve the html page")
	}
	/* stats json: two distinct users (the second one counted once despite two calls) */
	resp, err = http.Get(srv.URL + "/api/stats")
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if out["active_users"] != float64(2) {
		t.Errorf("active_users = %v, want 2", out["active_users"])
	}
	if out["unique_users"] != float64(2) || out["requests"] != float64(3) {
		t.Errorf("unique_users/requests = %v/%v, want 2/3", out["unique_users"], out["requests"])
	}
	platforms, _ := out["platforms"].(map[string]any)
	if platforms["windows"] != float64(1) || platforms["macos"] != float64(1) {
		t.Errorf("platforms = %v", platforms)
	}
	series, _ := out["series"].([]any)
	if len(series) != 1 {
		t.Fatalf("series has %d points, want 1", len(series))
	}
	if p, _ := series[0].(map[string]any); p["users"] != float64(2) || p["requests"] != float64(3) {
		t.Errorf("series[0] = %v", p)
	}
}

func TestStatsDisabled(t *testing.T) {
	env := map[string]string{"STATS": "0"}
	cfg := loadConfig(func(k string) (string, bool) { v, ok := env[k]; return v, ok })
	cfg.DataDir = t.TempDir()
	app := NewApp(cfg, &DirBucket{dir: cfg.DataDir}, nil)
	srv := httptest.NewServer(app)
	defer srv.Close()
	for _, path := range []string{"/dashboard", "/api/stats"} {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 404 {
			t.Errorf("%s = %d, want 404 when STATS=0", path, resp.StatusCode)
		}
	}
}

func TestUploadsIndexAndList(t *testing.T) {
	env := map[string]string{"STATS": "1"}
	cfg := loadConfig(func(k string) (string, bool) { v, ok := env[k]; return v, ok })
	cfg.DataDir = t.TempDir()
	app := NewApp(cfg, &DirBucket{dir: filepath.Join(cfg.DataDir, "objects")}, nil)
	defer app.Close()
	srv := httptest.NewServer(app)
	defer srv.Close()

	bind := func(id, title, artist string) int {
		body := fmt.Sprintf(`{"track":{"uri":"spotify:track:%s","title":%q,"artists":[%q],"album":"Alb","duration_ms":200000},`+
			`"lyrics":{"source":"local","lines":[{"text":"x","start_time_ms":1}]}}`, id, title, artist)
		resp, err := http.Post(srv.URL+"/api/bind", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	get := func(path string) (int, map[string]any) {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	if code := bind("AAAAAAAAAAAAAAAAAAAAAA", "Alpha", "Singer"); code != 200 {
		t.Fatalf("bind A = %d", code)
	}
	if code := bind("BBBBBBBBBBBBBBBBBBBBBB", "Beta", "Singer"); code != 200 {
		t.Fatalf("bind B = %d", code)
	}

	/* list: both rows, newest first */
	code, out := get("/api/uploads")
	if code != 200 {
		t.Fatalf("/api/uploads = %d", code)
	}
	if out["total"] != float64(2) {
		t.Fatalf("total = %v, want 2", out["total"])
	}
	uploads, _ := out["uploads"].([]any)
	if len(uploads) != 2 || uploads[0].(map[string]any)["id"] != "BBBBBBBBBBBBBBBBBBBBBB" {
		t.Fatalf("unexpected uploads order: %v", uploads)
	}
	/* search narrows to one row */
	_, out = get("/api/uploads?q=alpha")
	if out["total"] != float64(1) || out["uploads"].([]any)[0].(map[string]any)["title"] != "Alpha" {
		t.Errorf("search: %v", out)
	}
	/* sort by title ascending puts Alpha first */
	_, out = get("/api/uploads?sort=title&order=asc")
	if out["uploads"].([]any)[0].(map[string]any)["title"] != "Alpha" {
		t.Errorf("sort: %v", out["uploads"])
	}
	/* lyric document is readable without a token */
	code, out = get("/api/uploads/AAAAAAAAAAAAAAAAAAAAAA")
	if code != 200 {
		t.Fatalf("uploadDoc = %d", code)
	}
	if binding, _ := out["binding"].(map[string]any); binding["lrc"] == "" {
		t.Errorf("no lrc in binding: %v", binding)
	}
	/* unbind drops the row */
	resp, err := http.Post(srv.URL+"/api/unbind", "application/json", strings.NewReader(
		`{"track":{"uri":"spotify:track:BBBBBBBBBBBBBBBBBBBBBB","title":"Beta","artists":["Singer"],"duration_ms":200000}}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	_, out = get("/api/uploads")
	if out["total"] != float64(1) {
		t.Errorf("after unbind total = %v, want 1", out["total"])
	}

	/* An object written straight into the bucket gets indexed by the reconcile pass. */
	_, _ = app.bindings.Save(context.Background(), "CCCCCCCCCCCCCCCCCCCCCC", obj{
		"spotify_url": "https://open.spotify.com/track/CCCCCCCCCCCCCCCCCCCCCC",
		"spotify_uri": "spotify:track:CCCCCCCCCCCCCCCCCCCCCC",
		"track":       obj{"uri": "spotify:track:CCCCCCCCCCCCCCCCCCCCCC", "title": "Gamma", "artists": []string{"X"}, "album": "", "duration_ms": 1},
		"source":      "local", "sync_type": "line", "line_count": 1, "bind_count": 1,
		"created_at": "2026-01-01T00:00:00.000Z", "updated_at": "2026-01-01T00:00:00.000Z",
	}, nil)
	app.syncIndex(context.Background())
	_, out = get("/api/uploads?q=gamma")
	if out["total"] != float64(1) {
		t.Errorf("after reconcile total = %v, want 1", out["total"])
	}
	/* …and a row whose object vanished is dropped. */
	if err := app.bindings.Remove(context.Background(), "AAAAAAAAAAAAAAAAAAAAAA"); err != nil {
		t.Fatal(err)
	}
	app.syncIndex(context.Background())
	_, out = get("/api/uploads")
	if out["total"] != float64(1) || out["uploads"].([]any)[0].(map[string]any)["title"] != "Gamma" {
		t.Errorf("after remove+reconcile: %v", out)
	}
}

func TestSanitizeLyrics(t *testing.T) {
	var in any
	_ = json.Unmarshal([]byte(`{"source":"local","evil":1,"lines":[{"text":"b","start_time_ms":9},{"text":"a\u0000x","start_time_ms":1}]}`), &in)
	l := sanitizeLyrics(in)
	if l == nil || len(l.Lines) != 2 || l.Lines[0].Text != "ax" {
		t.Fatalf("unexpected: %+v", l)
	}
	if got := exportLRC(l); got != "[00:00.001]ax\n[00:00.009]b\n" {
		t.Errorf("lrc = %q", got)
	}
	_ = json.Unmarshal([]byte(`{"lines":[{"text":""}]}`), &in)
	if sanitizeLyrics(in) != nil {
		t.Error("empty lyrics must be rejected")
	}
}
