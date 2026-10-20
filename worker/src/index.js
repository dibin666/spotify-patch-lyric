/*
 * Spot-Lyric install / update endpoint (Cloudflare Worker).
 *
 *   GET /                 the installer: install.ps1 for PowerShell (irm ... | iex),
 *                         install.sh for curl / wget (curl -fsSL ... | bash), a short page for browsers
 *   GET /install.sh       GET /install.ps1
 *   GET /latest           latest release: { tag, version, name, notes, url, published_at }
 *   GET /archive/<tag>.tar.gz | .zip    source archive of a release tag (GitHub codeload)
 *
 * Everything comes from the GitHub releases of REPO; responses are cached at the edge.
 */
const REPO = 'dibin666/spotify-patch-lyric';
const GITHUB = `https://github.com/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const TAG_RE = /^v\d+\.\d+\.\d+$/;
const UA = { 'user-agent': 'spot-lyric-worker (+https://github.com/dibin666/spotify-patch-lyric)' };
const CORS = { 'access-control-allow-origin': '*' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'access-control-allow-methods': 'GET, HEAD', 'access-control-max-age': '86400' } });
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('method not allowed', 405);
    try {
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const raw = (env && env.RAW_BASE) || RAW;   // RAW_BASE: local testing only
      if (path === '/') {
        const kind = clientKind(request.headers.get('user-agent') || '');
        if (kind === 'browser') return page(url.host);
        return await script(kind === 'powershell' ? 'install.ps1' : 'install.sh', raw, env, ctx);
      }
      if (path === '/install.sh' || path === '/install.ps1') return await script(path.slice(1), raw, env, ctx);
      if (path === '/latest') return json(await cached(ctx, 'latest', 300, () => latest(env)));
      const archive = /^\/archive\/(v\d+\.\d+\.\d+)\.(tar\.gz|zip)$/.exec(path);
      if (archive) return await proxyArchive(archive[1], archive[2], request, ctx);
      return text('not found', 404);
    } catch (e) {
      return text(`error: ${e && e.message || e}`, 502);
    }
  },
};

/* PowerShell's Invoke-RestMethod / Invoke-WebRequest send "WindowsPowerShell/5.1" or "PowerShell/7.x". */
function clientKind(ua) {
  if (/PowerShell\//i.test(ua)) return 'powershell';
  if (!ua || /^(curl|wget|fetch|libfetch|python|go-http|aria2)/i.test(ua) || !/Mozilla\//.test(ua)) return 'shell';
  return 'browser';
}

/* Latest release. The API gives the release notes; when it is rate limited (shared Worker IPs),
 * the /releases/latest redirect gives the tag and CHANGELOG.md of that tag the notes. */
async function latest(env) {
  const headers = { ...UA, accept: 'application/vnd.github+json' };
  if (env && env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const api = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
  if (api.ok) {
    const r = await api.json();
    if (TAG_RE.test(r.tag_name || '')) {
      return { tag: r.tag_name, version: r.tag_name.slice(1), name: r.name || `Spot-Lyric ${r.tag_name}`, notes: r.body || '', url: r.html_url, published_at: r.published_at || '' };
    }
  }
  const redirect = await fetch(`${GITHUB}/releases/latest`, { headers: UA, redirect: 'manual' });
  const tag = ((redirect.headers.get('location') || '').match(/\/tag\/(v\d+\.\d+\.\d+)$/) || [])[1];
  if (!tag) throw new Error(`no release found (API ${api.status}, redirect ${redirect.status})`);
  let notes = '';
  const changelog = await fetch(`${RAW}/${tag}/CHANGELOG.md`, { headers: UA });
  if (changelog.ok) notes = changelogSection(await changelog.text(), tag);
  return { tag, version: tag.slice(1), name: `Spot-Lyric ${tag}`, notes, url: `${GITHUB}/releases/tag/${tag}`, published_at: '' };
}

/* The "## vX.Y.Z" section of CHANGELOG.md, without its heading. */
function changelogSection(text, tag) {
  const out = [];
  let on = false;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^## /.test(line)) { if (on) break; on = line.slice(3).trim().split(/\s/)[0] === tag; continue; }
    if (on) out.push(line);
  }
  return out.join('\n').trim();
}

/* The installer of the latest release (older releases have none: then main). A UTF-8 BOM is
 * dropped: "irm | iex" would otherwise start the script with U+FEFF. */
async function script(name, raw, env, ctx) {
  const body = await cached(ctx, `script:${name}`, 300, async () => {
    let tag = '';
    try { tag = (await cached(ctx, 'latest', 300, () => latest(env))).tag; } catch (_) { /* main below */ }
    for (const ref of [tag, 'main'].filter(Boolean)) {
      const r = await fetch(`${raw}/${ref}/${name}`, { headers: UA });
      if (r.ok) return { text: (await r.text()).replace(/^\uFEFF/, '') };
    }
    throw new Error(`${name} not found`);
  });
  return new Response(body.text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', ...CORS } });
}

async function proxyArchive(tag, ext, request, ctx) {
  const cache = caches.default;
  const key = new Request(`https://cache.spot-lyric/archive/${tag}.${ext}`);
  let res = await cache.match(key);
  if (!res) {
    const upstream = await fetch(`https://codeload.github.com/${REPO}/${ext === 'zip' ? 'zip' : 'tar.gz'}/refs/tags/${tag}`, { headers: UA });
    if (!upstream.ok) return text(`archive ${tag} not found`, upstream.status === 404 ? 404 : 502);
    res = new Response(upstream.body, {
      headers: {
        'content-type': ext === 'zip' ? 'application/zip' : 'application/gzip',
        'content-disposition': `attachment; filename="spotify-patch-lyric-${tag}.${ext}"`,
        'cache-control': 'public, max-age=86400', ...CORS,
      },
    });
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return request.method === 'HEAD' ? new Response(null, { headers: res.headers }) : res;
}

/* JSON values cached at the edge for `ttl` seconds. */
async function cached(ctx, name, ttl, make) {
  const cache = caches.default;
  const key = new Request(`https://cache.spot-lyric/${encodeURIComponent(name)}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const value = await make();
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } })));
  return value;
}

const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', ...CORS } });
const text = (body, status = 200) => new Response(body + '\n', { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } });

function page(host) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const site = esc(`https://${host}`);
  return new Response(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spot-Lyric for Spotify</title>
<style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#121212;color:#fff;display:flex;justify-content:center}
main{max-width:720px;padding:48px 24px}h1{margin:0 0 8px;font-size:2rem}p{color:#b3b3b3}h2{margin:32px 0 8px;font-size:1.1rem}
pre{background:#282828;border-radius:8px;padding:14px 16px;overflow-x:auto;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#1ed760;user-select:all}
a{color:#1ed760}
</style></head><body><main>
<h1>Spot-Lyric for Spotify</h1>
<p>Spotify 桌面客户端第三方歌词插件。安装和更新都用同一条命令：已安装时会直接更新到最新版本并沿用原来的设置。</p>
<h2>Windows（PowerShell）</h2><pre>irm ${site} | iex</pre>
<h2>macOS / Linux（终端）</h2><pre>curl -fsSL ${site} | bash</pre>
<h2>安装后</h2><pre>spot-lyric update      # 更新
spot-lyric setup       # 重新设置
spot-lyric status      # 查看状态
spot-lyric uninstall   # 卸载</pre>
<p><a href="${GITHUB}">GitHub</a> · <a href="${GITHUB}/releases">更新记录</a></p>
</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
