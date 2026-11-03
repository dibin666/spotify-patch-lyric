package server

// Minimal S3 client (AWS Signature V4) for Cloudflare R2 or any S3-compatible
// storage: PUT / GET / DELETE of one object.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

type S3Bucket struct {
	endpoint        *url.URL
	bucket          string
	accessKeyID     string
	secretAccessKey string
	region          string
	client          *http.Client
}

func newS3FromEnv(env func(string) (string, bool)) *S3Bucket {
	get := func(k string) string { v, _ := env(k); return v }
	bucket, id, secret := get("R2_BUCKET"), get("R2_ACCESS_KEY_ID"), get("R2_SECRET_ACCESS_KEY")
	endpoint := get("R2_ENDPOINT")
	if endpoint == "" && get("R2_ACCOUNT_ID") != "" {
		endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", get("R2_ACCOUNT_ID"))
	}
	if bucket == "" || id == "" || secret == "" || endpoint == "" {
		return nil
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		return nil
	}
	region := get("R2_REGION")
	if region == "" {
		region = "auto"
	}
	return &S3Bucket{u, bucket, id, secret, region, &http.Client{Timeout: 15 * time.Second}}
}

func (b *S3Bucket) Local() bool { return false }

func sha256hex(data string) string {
	sum := sha256.Sum256([]byte(data))
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

/* RFC 3986 encoding of each path segment, as SigV4 requires. */
func encodeKey(key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		var sb strings.Builder
		for _, c := range []byte(p) {
			if c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.' || c == '~' {
				sb.WriteByte(c)
			} else {
				fmt.Fprintf(&sb, "%%%02X", c)
			}
		}
		parts[i] = sb.String()
	}
	return strings.Join(parts, "/")
}

/* SigV4 canonical query string: name and value each RFC-3986 encoded, sorted. */
func canonicalQuery(values url.Values) string {
	pairs := make([]string, 0, len(values))
	for n, vs := range values {
		for _, v := range vs {
			pairs = append(pairs, uriEscape(n)+"="+uriEscape(v))
		}
	}
	sort.Strings(pairs)
	return strings.Join(pairs, "&")
}

/* RFC 3986 encoding: like url.PathEscape but with %20 for spaces, no "+". */
func uriEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func (b *S3Bucket) request(ctx context.Context, method, key string, body string, headers map[string]string, query url.Values) (*http.Response, error) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	day := amzDate[:8]
	path := strings.TrimRight(b.endpoint.Path, "/") + "/" + url.PathEscape(b.bucket)
	if key != "" {
		path += "/" + encodeKey(key)
	}
	queryString := canonicalQuery(query)
	all := map[string]string{"host": b.endpoint.Host, "x-amz-content-sha256": sha256hex(body), "x-amz-date": amzDate}
	for k, v := range headers {
		all[strings.ToLower(k)] = strings.TrimSpace(v)
	}
	names := make([]string, 0, len(all))
	for n := range all {
		names = append(names, n)
	}
	sort.Strings(names)
	var canonicalHeaders strings.Builder
	for _, n := range names {
		canonicalHeaders.WriteString(n + ":" + all[n] + "\n")
	}
	signed := strings.Join(names, ";")
	canonical := strings.Join([]string{method, path, queryString, canonicalHeaders.String(), signed, all["x-amz-content-sha256"]}, "\n")
	scope := day + "/" + b.region + "/s3/aws4_request"
	toSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)}, "\n")
	k := hmacSHA256([]byte("AWS4"+b.secretAccessKey), day)
	k = hmacSHA256(k, b.region)
	k = hmacSHA256(k, "s3")
	k = hmacSHA256(k, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(k, toSign))

	decoded, err := url.PathUnescape(path)
	if err != nil {
		return nil, err
	}
	u := &url.URL{Scheme: b.endpoint.Scheme, Host: b.endpoint.Host, Path: decoded, RawPath: path, RawQuery: queryString}
	var reader io.Reader
	if method == "PUT" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), reader)
	if err != nil {
		return nil, err
	}
	for n, v := range all {
		if n != "host" {
			req.Header.Set(n, v)
		}
	}
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s", b.accessKeyID, scope, signed, signature))
	return b.client.Do(req)
}

func readSnippet(r *http.Response) string {
	data, _ := io.ReadAll(io.LimitReader(r.Body, 200))
	return string(data)
}

func (b *S3Bucket) Put(ctx context.Context, key, body, contentType string, metadata map[string]string) error {
	headers := map[string]string{"content-type": contentType}
	for n, v := range metadata {
		headers["x-amz-meta-"+n] = v
	}
	resp, err := b.request(ctx, "PUT", key, body, headers, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("R2 PUT %d: %s", resp.StatusCode, readSnippet(resp))
	}
	return nil
}

func (b *S3Bucket) Get(ctx context.Context, key string) (string, bool, error) {
	resp, err := b.request(ctx, "GET", key, "", nil, nil)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return "", false, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", false, fmt.Errorf("R2 GET %d: %s", resp.StatusCode, readSnippet(resp))
	}
	data, err := io.ReadAll(resp.Body)
	return string(data), err == nil, err
}

func (b *S3Bucket) Delete(ctx context.Context, key string) error {
	resp, err := b.request(ctx, "DELETE", key, "", nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if (resp.StatusCode < 200 || resp.StatusCode > 299) && resp.StatusCode != 404 {
		return fmt.Errorf("R2 DELETE %d: %s", resp.StatusCode, readSnippet(resp))
	}
	return nil
}

/* ListObjectsV2 result page. */
type listObjectsResult struct {
	IsTruncated bool   `xml:"IsTruncated"`
	NextToken   string `xml:"NextContinuationToken"`
	Contents    []struct {
		Key          string `xml:"Key"`
		LastModified string `xml:"LastModified"`
		Size         int64  `xml:"Size"`
	} `xml:"Contents"`
}

func (b *S3Bucket) List(ctx context.Context, prefix string) ([]ListItem, error) {
	items := []ListItem{}
	token := ""
	for {
		query := url.Values{"list-type": {"2"}, "prefix": {prefix}, "max-keys": {"1000"}}
		if token != "" {
			query.Set("continuation-token", token)
		}
		resp, err := b.request(ctx, "GET", "", "", nil, query)
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return nil, fmt.Errorf("R2 LIST %d: %s", resp.StatusCode, truncate(string(data), 200))
		}
		var page listObjectsResult
		if err := xml.Unmarshal(data, &page); err != nil {
			return nil, fmt.Errorf("R2 LIST parse: %w", err)
		}
		for _, c := range page.Contents {
			modified, _ := time.Parse(time.RFC3339, c.LastModified)
			items = append(items, ListItem{Key: c.Key, Modified: modified, Size: c.Size})
		}
		if !page.IsTruncated || page.NextToken == "" {
			return items, nil
		}
		token = page.NextToken
	}
}
