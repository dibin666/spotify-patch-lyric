// Comments plugin internals (src/comments.js): the IIFE only exports
// window.SpotLyricComments, so the source is evaluated in a vm sandbox that
// captures the internals through a debug hook appended after the source.
// fetchPage / resolveSong / the QR unikey request are exercised against the
// real music.163.com endpoints through the app's Http transport contract
// (stubbed with node fetch here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const core = (await import('node:module')).createRequire(import.meta.url)(path.join(root, 'src/core.js'));
const src = fs.readFileSync(path.join(root, 'src/comments.js'), 'utf8');

const HOOK = `
;globalThis.__internals = {
  md5, qrMatrix, weapiBody, rsaSecretKey, normComment, songState, fetchPage, resolveSong,
  jar: () => jar, jarHeader, captureBodyCookie, captureSession, api, accountStatus,
  account: () => account,
  UI: CommentsUI, hash33, ptuiCB, qqJar: () => qqJar, qqGet, qqPost, qqUuid,
  setHost(x) { app = x.app; Core = x.Core; h = x.h; svg = x.svg; toast = x.toast; confirmDialog = x.confirmDialog; },
  setAccount(a) { account = a; },
};`;

function sandbox() {
  const context = {
    window: {}, console,
    document: { createElement: () => ({}), addEventListener() {}, head: { append() {} }, body: { append() {} } },
    /* setInterval must not pin the test process down for the 2h sweeper. */
    TextEncoder, crypto, btoa, setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
    location: { href: 'https://open.spotify.com/' },
  };
  context.globalThis = context;
  vm.createContext(context);
  /* The internals live inside the plugin IIFE: the hook is injected just
   * before its closing brace so it can see the function declarations. */
  const wrapped = src.replace(/\}\)\(\);\s*$/, `${HOOK}\n})();`);
  assert.ok(wrapped !== src, 'hook not injected');
  vm.runInContext(wrapped, context);
  return context.__internals;
}

/* Http transport contract: {method, url, headers, body, credentials} ->
 * {status, body, retryAfter, setCookie} — identical to directFetch/relays. */
function stubApp(track, match) {
  const calls = [];
  return {
    app: {
      engine: {
        track, match,
        http: {
          async request(provider, req) {
            calls.push({ provider, url: req.url, method: req.method });
            const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
            return {
              status: resp.status, body: await resp.text(),
              setCookie: resp.headers.getSetCookie ? resp.headers.getSetCookie() : [],
            };
          },
        },
        async providerSearch(provider, query) {
          const resp = await fetch(`https://music.163.com/api/search/get/web?type=1&s=${encodeURIComponent(query)}&limit=5`,
            { headers: { Referer: 'https://music.163.com/' } });
          const body = await resp.json();
          return core.providerCandidates(provider, body) || [];
        },
      },
      store: { kvGet: async () => null, kvSet: async () => {} },
      trackInfo: null,
    },
    Core: core, h: () => ({}), svg: () => ({}), toast() {}, confirmDialog: async () => true,
    calls,
  };
}

test('UI implements the panel-tab contract (el/activate/deactivate)', () => {
  const { UI } = sandbox();
  /* The comments tab lives inside the shared side panel: the host mounts
   * view.el once and drives it with activate()/deactivate(). */
  for (const fn of ['activate', 'deactivate']) {
    assert.equal(typeof UI.prototype[fn], 'function', `${fn} missing`);
  }
  for (const gone of ['buildEntry', 'buildButton', 'toggle', 'show', 'close']) {
    assert.equal(UI.prototype[gone], undefined, `${gone} should be removed`);
  }
});

test('md5 matches RFC test vectors', () => {
  const { md5 } = sandbox();
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
});

test('qrMatrix produces a scannable byte-mode matrix', () => {
  const { qrMatrix } = sandbox();
  const m = qrMatrix('https://music.163.com/login?codekey=a4756ec9-984c-44dd-89bf-345d9a342382');
  assert.ok(m.length >= 21 && m.length <= 57 && m.length === m[0].length);
  /* 7x7 finder squares: black core, white ring, black ring, white separator */
  for (const [cx, cy] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]]) {
    assert.equal(m[cy + 3][cx + 3], true);   // solid 3x3 centre
    assert.equal(m[cy + 5][cx + 5], false);  // white ring inside
    assert.equal(m[cy + 6][cx + 6], true);   // outer ring
  }
  /* timing pattern alternates on row/column 6 */
  assert.equal(m[6][8] !== m[6][9], true);
});

test('weapiBody returns params + encSecKey with decodable structure', async () => {
  const { weapiBody } = sandbox();
  const body = await weapiBody({ username: 'test@example.com', password: 'x'.repeat(32), rememberLogin: 'true' });
  const params = new URLSearchParams(body);
  assert.ok(params.get('params').length > 0);
  assert.equal(params.get('encSecKey').length, 256);
  assert.ok(params.get('params').includes('%') === false); // URLSearchParams decoded it
});

test('normComment normalizes the NetEase payload', () => {
  const { normComment } = sandbox();
  const c = normComment({
    commentId: 1, content: '好听', time: 1700000000000, likedCount: 42, liked: true,
    user: { nickname: '某人', avatarUrl: 'http://p1.music.126.net/x.jpg' },
    ipLocation: { location: '上海' },
    beReplied: [{ user: { nickname: '原作者' }, content: '原评论' }],
  });
  assert.equal(c.avatar.startsWith('https://'), true);
  assert.equal(c.reply.nickname, '原作者');
  assert.equal(c.likedCount, 42);
});

test('fetchPage reads hot + latest comments from the real API', async () => {
  const i = sandbox();
  const stub = stubApp({ title: '海阔天空', artists: ['Beyond'], uri: 'spotify:track:x' }, { provider: 'netease', id: '347230' });
  i.setHost(stub);
  const page = await i.fetchPage('347230', 0);
  assert.ok(page.total > 0);
  assert.ok(page.hot.length > 0, 'expected hot comments');
  assert.ok(page.list.length > 0, 'expected latest comments');
  assert.equal(stub.calls[0].url, 'https://music.163.com/api/v1/resource/comments/R_SO_4_347230?limit=20&offset=0');
});

test('resolveSong returns the bound NetEase song and falls back to search', async () => {
  const i = sandbox();
  /* lyrics bound to a NetEase match -> that song id */
  i.setHost(stubApp({ title: '海阔天空', artists: ['Beyond'], uri: 'spotify:track:1' }, { provider: 'netease', id: '347230', title: '海阔天空', artists: ['Beyond'] }));
  const bound = await i.resolveSong();
  assert.equal(bound.id, '347230');
  assert.equal(bound.via, 'lyrics');
  /* lyrics from another provider -> NetEase search fallback */
  i.setHost(stubApp({ title: '海阔天空', artists: ['Beyond'], uri: 'spotify:track:2', duration_ms: 326000 }, { provider: 'qq', id: 'x' }));
  const found = await i.resolveSong();
  assert.ok(found && /^\d+$/.test(found.id), `expected numeric NetEase id, got ${found && found.id}`);
  assert.equal(found.via, 'search');
});

test('hash33 derives the ptqrtoken checksum', () => {
  const { hash33 } = sandbox();
  /* Reference value computed against a real qrsig (the classic e=e*33+c loop). */
  assert.equal(hash33('aa8ffe9a8fb732eb49720bbcb0b8a16f13058d1c4262d3c29f95a4d4e9eaedace28c41525006d5ebfcff7a57b146b5a36c3745d299fd2afaccd5c63906fe6fa4'), 1758097909);
  assert.equal(hash33(''), 0);
  assert.equal(hash33('a'), 97);
  /* seed 5381 makes it the oauth g_tk over p_skey (getToken in qlogin_v2.js). */
  assert.equal(hash33('', 5381), 5381);
  assert.equal(hash33('a', 5381), 5381 * 33 + 97);
});

test('ptuiCB parses the ptlogin callback tuple', () => {
  const { ptuiCB } = sandbox();
  /* the array is built inside the vm context: compare joined, not deepEqual. */
  assert.equal(ptuiCB("ptuiCB('66','0','','0','二维码未失效。', '')").join('|'), '66|0||0|二维码未失效。|');
  const ok = ptuiCB("ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?pttype=2&s_url=x','0','登录成功','nick')");
  assert.equal(ok[0], '0');
  assert.match(ok[2], /^https:\/\/ssl\.ptlogin2\.graph\.qq\.com\/check_sig/);
  assert.equal(ptuiCB('{"code":200}'), null);
  assert.equal(ptuiCB(''), null);
});

test('captureSession restores MUSIC_U from the body token when headers were lost', () => {
  const i = sandbox();
  i.setHost(stubApp(null, null));
  /* Cellphone logins answer {code:200, token, profile} without a cookie field;
   * token is the MUSIC_U value, so an old relay that drops Set-Cookie still
   * ends up with a usable session. */
  i.captureSession({ code: 200, token: '0abc123token', profile: { userId: 7 } });
  assert.equal(i.jar().get('MUSIC_U'), '0abc123token');
  assert.match(i.jarHeader(), /MUSIC_U=0abc123token/);
  /* A cookie string in the body wins over the token (the real Set-Cookie value). */
  const j = sandbox();
  j.setHost(stubApp(null, null));
  j.captureSession({ code: 200, token: 'ignored', cookie: 'MUSIC_U=realcookie; Path=/; __csrf=csrf9' });
  assert.equal(j.jar().get('MUSIC_U'), 'realcookie');
  assert.equal(j.jar().get('__csrf'), 'csrf9');
});

test('QR login unikey endpoint answers on the plain api path', async () => {
  const i = sandbox();
  i.setHost(stubApp(null, null));
  const { data } = await i.api('POST', 'https://music.163.com/api/login/qrcode/unikey', {
    body: 'type=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(data.code, 200);
  assert.ok(data.unikey.length > 8);
});
