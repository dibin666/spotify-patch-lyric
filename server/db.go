package server

/*
 * Permanent index of the shared lyric bindings, one row per Spotify track in a
 * local SQLite database (DATA_DIR/bindings.db): survives restarts, drives the
 * dashboard's searchable / sortable list of every stored binding.
 *
 * Writes happen together with the object-store write (bind / unbind), and a
 * background pass reconciles the index with the bucket so objects changed
 * outside this server (e.g. edited in the R2 console) show up too.
 *
 * modernc.org/sqlite is pure Go: the CGO_ENABLED=0 static binary keeps working.
 */

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

type IndexDB struct{ db *sql.DB }

/* Binding fields indexed for the list: everything except the lyric text itself. */
const indexColumns = `id, title, artists, album, duration_ms, spotify_url, source,
	provider, provider_name, provider_id, provider_url, sync_type, line_count,
	translated, offset_ms, bind_count, created_at, updated_at`

func OpenIndex(dir string) (*IndexDB, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "bindings.db"))
	if err != nil {
		return nil, err
	}
	/* SQLite allows one writer at a time; serializing here also keeps the WAL reader fast. */
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
	} {
		if _, err := db.Exec(pragma); err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS bindings (
		id            TEXT PRIMARY KEY,
		title         TEXT NOT NULL DEFAULT '',
		artists       TEXT NOT NULL DEFAULT '',
		album         TEXT NOT NULL DEFAULT '',
		duration_ms   INTEGER NOT NULL DEFAULT 0,
		spotify_url   TEXT NOT NULL DEFAULT '',
		source        TEXT NOT NULL DEFAULT '',
		provider      TEXT NOT NULL DEFAULT '',
		provider_name TEXT NOT NULL DEFAULT '',
		provider_id   TEXT NOT NULL DEFAULT '',
		provider_url  TEXT NOT NULL DEFAULT '',
		sync_type     TEXT NOT NULL DEFAULT '',
		line_count    INTEGER NOT NULL DEFAULT 0,
		translated    INTEGER NOT NULL DEFAULT 0,
		offset_ms     INTEGER NOT NULL DEFAULT 0,
		bind_count    INTEGER NOT NULL DEFAULT 1,
		created_at    TEXT NOT NULL DEFAULT '',
		updated_at    TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		_ = db.Close()
		return nil, err
	}
	for _, idx := range []string{
		`CREATE INDEX IF NOT EXISTS idx_bindings_updated ON bindings(updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_bindings_created ON bindings(created_at DESC)`,
	} {
		if _, err := db.Exec(idx); err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	return &IndexDB{db}, nil
}

func (d *IndexDB) Close() error { return d.db.Close() }

/* Upsert mirrors a stored binding document into the index after a save. */
func (d *IndexDB) Upsert(id string, doc *bindingDoc) error {
	title, artists, album := "", "", ""
	var duration int64
	if doc.Track != nil {
		title = doc.Track.Title
		artists = strings.Join(doc.Track.Artists, " / ")
		album = doc.Track.Album
		duration = doc.Track.DurationMS
	}
	provider, providerName, providerID, providerURL := "", "", "", ""
	if doc.Match != nil {
		provider = doc.Match.Provider
		providerName = doc.Match.ProviderName
		providerID = doc.Match.ID
		providerURL = doc.Match.URL
	}
	translated := 0
	if doc.Translated {
		translated = 1
	}
	_, err := d.db.Exec(`INSERT INTO bindings (`+indexColumns+`)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
		title=excluded.title, artists=excluded.artists, album=excluded.album,
		duration_ms=excluded.duration_ms, spotify_url=excluded.spotify_url, source=excluded.source,
		provider=excluded.provider, provider_name=excluded.provider_name, provider_id=excluded.provider_id,
		provider_url=excluded.provider_url, sync_type=excluded.sync_type, line_count=excluded.line_count,
		translated=excluded.translated, offset_ms=excluded.offset_ms, bind_count=excluded.bind_count,
		created_at=excluded.created_at, updated_at=excluded.updated_at`,
		id, title, artists, album, duration, doc.SpotifyURL, doc.Source,
		provider, providerName, providerID, providerURL, doc.SyncType, doc.LineCount, translated,
		doc.OffsetMS, doc.BindCount, doc.CreatedAt, doc.UpdatedAt)
	return err
}

func (d *IndexDB) Remove(id string) error {
	_, err := d.db.Exec(`DELETE FROM bindings WHERE id = ?`, id)
	return err
}

/* IDs returns every indexed track id (for the bucket reconciliation). */
func (d *IndexDB) IDs() (map[string]bool, error) {
	rows, err := d.db.Query(`SELECT id FROM bindings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	return ids, rows.Err()
}

/* ------------------------------------------------------------------ list ---- */

type IndexQuery struct {
	Q             string /* free text over title / artists / album / provider / id */
	Sort          string /* key of listSorts; default updated_at */
	Desc          bool   /* default true: newest first */
	Limit, Offset int
}

/* Sortable columns; text sorts case-insensitively. */
var listSorts = map[string]string{
	"updated_at": "updated_at", "created_at": "created_at",
	"title": "title COLLATE NOCASE", "artists": "artists COLLATE NOCASE",
	"album": "album COLLATE NOCASE", "source": "source COLLATE NOCASE",
	"bind_count": "bind_count", "line_count": "line_count",
}

func likePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

/* List answers GET /api/uploads: page of index rows plus the matching total. */
func (d *IndexDB) List(q IndexQuery) ([]obj, int, error) {
	where := ""
	args := []any{}
	if q.Q != "" {
		p := likePattern(q.Q)
		where = ` WHERE (title LIKE ? ESCAPE '\' OR artists LIKE ? ESCAPE '\'
			OR album LIKE ? ESCAPE '\' OR provider_name LIKE ? ESCAPE '\'
			OR provider_id LIKE ? ESCAPE '\' OR id LIKE ? ESCAPE '\')`
		args = append(args, p, p, p, p, p, p)
	}
	var total int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM bindings`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	col := listSorts[q.Sort]
	if col == "" {
		col = "updated_at"
	}
	dir := "ASC"
	if q.Desc {
		dir = "DESC"
	}
	limit := q.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := d.db.Query(`SELECT `+indexColumns+` FROM bindings`+where+
		` ORDER BY `+col+` `+dir+`, id ASC LIMIT ? OFFSET ?`,
		append(args, limit, q.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []obj{}
	for rows.Next() {
		var id, title, artists, album, spotifyURL, source string
		var provider, providerName, providerID, providerURL, syncType string
		var createdAt, updatedAt string
		var duration, lineCount, translated, offset, bindCount int64
		if err := rows.Scan(&id, &title, &artists, &album, &duration, &spotifyURL, &source,
			&provider, &providerName, &providerID, &providerURL, &syncType, &lineCount,
			&translated, &offset, &bindCount, &createdAt, &updatedAt); err != nil {
			return nil, 0, err
		}
		artistList := []string{}
		if artists != "" {
			artistList = strings.Split(artists, " / ")
		}
		out = append(out, obj{
			"id": id, "title": title, "artists": artistList, "album": album,
			"duration_ms": duration, "spotify_url": spotifyURL,
			"source": source, "source_name": providerNames[source],
			"provider": provider, "provider_name": providerName,
			"provider_id": providerID, "provider_url": providerURL,
			"sync_type": syncType, "line_count": lineCount, "translated": translated == 1,
			"offset_ms": offset, "bind_count": bindCount,
			"created_at": createdAt, "updated_at": updatedAt,
		})
	}
	return out, total, rows.Err()
}
