/*
 * Spot-Lyric comments plugin — NetEase Cloud Music comment area for the
 * currently playing song. Optional add-on: the patcher ships this file as
 * /spot-lyric/spot-lyric-comments.js inside xpui, and app.js injects it only
 * when the user installs the plugin in the lyrics settings
 * (spot-lyric:settings comments_plugin).
 *
 * It registers window.SpotLyricComments.mount(host); host is the surface app.js
 * exposes: { app, Core, h, svg, ICON, NAMES, toast, confirmDialog, http, version,
 * reload }. mount() leaves the view in window.SpotLyricComments.view
 * ({ el, activate, deactivate }) for the host's side-panel comments tab.
 * NetEase requests go through the same transport as lyrics:
 * direct (--disable-web-security) -> local service -> lyrics server relay.
 * Sign-in cookies travel as a Cookie header through the relay, or via the
 * browser jar with credentials:include on the direct path.
 */
(function () {
  'use strict';
  if (window.SpotLyricComments) return;

  const NETEASE = 'https://music.163.com';
  const PAGE_SIZE = 20;
  /* Comment pages are kept in memory only: closing Spotify frees everything,
   * and entries older than two hours are dropped by the sweeper below. */
  const CACHE_TTL = 2 * 3600 * 1000;
  const ACCOUNT_KEY = 'netease:comments:account';

  /* ------------------------------------------------------------ css ----- */
  const CSS = `
/* The plugin's own page inside the shared side panel: fills the tab body. */
.slc{display:flex;flex-direction:column;flex:1;min-height:0;height:100%;color:#fff;
  font:400 .875rem/1.45 var(--encore-body-font-stack,sans-serif);
  user-select:text;-webkit-user-select:text}
.slc button{user-select:none;-webkit-user-select:none}
.slc input{user-select:text;-webkit-user-select:text}
.slc-head{display:flex;align-items:center;gap:10px;padding:12px 12px 8px;flex:none}
.slc-title{font:700 1.25rem/1.2 var(--encore-title-font-stack,sans-serif)}
.slc-count{color:rgba(255,255,255,.55);font-size:.8125rem;align-self:flex-end;padding-bottom:2px}
.slc-spacer{flex:1}
.slc-user{display:flex;align-items:center;gap:8px;max-width:200px;padding:4px 10px 4px 4px;border:0;border-radius:500px;
  background:rgba(0,0,0,.3);color:#fff;cursor:pointer;font:700 .8125rem var(--encore-body-font-stack,sans-serif);transition:background-color .2s}
.slc-user:hover{background:rgba(0,0,0,.5)}
.slc-user img{width:24px;height:24px;border-radius:50%;object-fit:cover;background:#282828;flex:none}
.slc-user span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slc-user.slc-login-btn{padding:4px 14px}
.slc-scroll{flex:1;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:0 12px 12px;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
.slc-scroll::-webkit-scrollbar{width:12px}
.slc-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border:3px solid transparent;background-clip:padding-box;border-radius:6px}
.slc-scroll::-webkit-scrollbar-thumb:hover{background-color:rgba(255,255,255,.5)}
.slc-song{display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.06)}
.slc-song img{width:48px;height:48px;border-radius:6px;object-fit:cover;background:#282828;flex:none}
.slc-song-txt{min-width:0;display:flex;flex-direction:column;gap:2px}
.slc-song-title{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slc-song-sub{color:#b3b3b3;font-size:.8125rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slc-sec{display:flex;align-items:baseline;gap:8px;margin:22px 0 2px;font-weight:700}
.slc-sec small{color:#8a8a8a;font-weight:400;font-size:.75rem}
.slc-row{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.slc-ava{width:36px;height:36px;border-radius:50%;object-fit:cover;flex:none;background:#282828}
.slc-main{flex:1;min-width:0}
.slc-nick{font-size:.8125rem;color:#b3b3b3;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slc-content{margin-top:2px;color:#fff;white-space:pre-wrap;overflow-wrap:anywhere}
.slc-reply{margin-top:6px;padding:8px 10px;border-radius:6px;background:rgba(255,255,255,.07);color:#b3b3b3;
  font-size:.8125rem;white-space:pre-wrap;overflow-wrap:anywhere}
.slc-reply b{color:#dedede;font-weight:400}
.slc-foot{display:flex;align-items:center;gap:8px;margin-top:8px;color:#727272;font-size:.75rem}
.slc-foot .slc-like{margin-left:auto}
.slc-like{display:inline-flex;align-items:center;gap:5px;padding:2px 4px;border:0;border-radius:4px;background:none;
  color:#b3b3b3;cursor:pointer;font:inherit;font-size:.8125rem;transition:color .15s}
.slc-like:hover{color:#fff}
.slc-like.slc-on{color:#1ed760}
.slc-like:disabled{cursor:default;opacity:.6}
.slc-more{padding:18px;text-align:center;color:#8a8a8a;font-size:.8125rem}
.slc-state{display:flex;flex-direction:column;align-items:center;gap:8px;padding:56px 24px;text-align:center;color:#b3b3b3}
/* display:flex above would override the [hidden] attribute — keep it explicit. */
.slc-state[hidden]{display:none}
.slc-state-title{margin:0;color:#fff;font:700 1.1rem/1.3 var(--encore-title-font-stack,sans-serif)}
.slc-state-sub{margin:0;max-width:420px;font-size:.8125rem}
.slc-input{display:flex;gap:10px;padding:12px 12px 14px;flex:none;border-top:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.22)}
.slc-input input{flex:1;min-width:0;height:38px;padding:0 16px;border:0;border-radius:500px;outline:none;
  background:rgba(255,255,255,.1);color:#fff;font:inherit;transition:box-shadow .1s}
.slc-input input::placeholder{color:#8a8a8a}
.slc-input input:focus{box-shadow:inset 0 0 0 2px rgba(255,255,255,.65)}
.slc-input .sl-btn{min-height:38px}
.sl-dialog.slc-login{position:relative;max-width:380px}
.slc-login .slc-x{position:absolute;top:14px;right:14px}
.slc-login-tabs{display:flex;gap:8px;margin-bottom:14px}
.slc-login-err{margin:8px 0 0;color:#f3727f;font-size:.8125rem;min-height:18px}
.slc-qrbox{width:200px;height:200px;margin:4px auto;padding:10px;border-radius:8px;background:#fff}
.slc-qrbox canvas{display:block;width:100%;height:100%}
.slc-qrtext{margin-top:8px;text-align:center;color:#b3b3b3;font-size:.8125rem;min-height:20px}
.slc-field{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.slc-label{font-size:.8125rem;color:#b3b3b3}
.slc-field .sl-input{padding-left:14px}
.slc-captcha{display:flex;gap:8px}
.slc-captcha .sl-input{flex:1}
.slc-login-note{margin:12px 0 0;color:#727272;font-size:.75rem;line-height:1.4}
.slc-login .sl-btn:disabled{opacity:.5;cursor:default;transform:none}
`;

  /* ------------------------------------------------------------- md5 ---- */
  /* Compact MD5 (RFC 1321) — weapi sends passwords as md5 hex. */
  function md5(str) {
    const K = [], S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
    const bytes = new TextEncoder().encode(str), len = bytes.length;
    const msg = new Uint8Array(((len + 8) >> 6 << 6) + 64);
    msg.set(bytes); msg[len] = 0x80;
    const bitLen = len * 8;
    /* JS shifts are mod 32: writing the bit length must stop at 4 bytes (inputs < 512 MiB). */
    for (let i = 0; i < 4; i++) msg[msg.length - 8 + i] = (bitLen >>> (i * 8)) & 255;
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const rot = (x, n) => (x << n) | (x >>> (32 - n));
    for (let off = 0; off < msg.length; off += 64) {
      const M = [];
      for (let i = 0; i < 16; i++) M[i] = msg[off + i * 4] | (msg[off + i * 4 + 1] << 8) | (msg[off + i * 4 + 2] << 16) | (msg[off + i * 4 + 3] << 24);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const tmp = D; D = C; C = B;
        B = (B + rot((A + F + K[i] + M[g]) | 0, S[i])) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const hex = v => { let s = ''; for (let i = 0; i < 4; i++) s += ((v >>> (i * 8)) & 255).toString(16).padStart(2, '0'); return s; };
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }

  /* ---------------------------------------------------------- weapi ----- */
  /* NetEase web client request signing (params + encSecKey): the text is
   * AES-CBC encrypted twice (nonce, then a random key), the key RSA encrypted
   * with the hard-coded public key. Matches /weapi/* endpoints exactly. */
  const WE_NONCE = '0CoJUm6Qyw8W8jud', WE_IV = '0102030405060708';
  const WE_MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
  const WE_KEYCHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  async function aesText(text, secret) {
    const src = new TextEncoder().encode(text), pad = 16 - (src.length % 16);
    const data = new Uint8Array(src.length + pad);
    data.set(src); data.fill(pad, src.length);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'AES-CBC', false, ['encrypt']);
    const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new TextEncoder().encode(WE_IV) }, key, data);
    return btoa(String.fromCharCode(...new Uint8Array(out)));
  }
  function rsaSecretKey(secret) {
    let hex = '';
    for (let i = secret.length - 1; i >= 0; i--) hex += secret.charCodeAt(i).toString(16).padStart(2, '0');
    let base = BigInt('0x' + hex), exp = 0x10001n, mod = BigInt('0x' + WE_MODULUS), r = 1n;
    base %= mod;
    while (exp) { if (exp & 1n) r = r * base % mod; base = base * base % mod; exp >>= 1n; }
    return r.toString(16).padStart(256, '0');
  }
  async function weapiBody(obj) {
    let secret = '';
    for (let i = 0; i < 16; i++) secret += WE_KEYCHARS[Math.floor(Math.random() * WE_KEYCHARS.length)];
    const params = await aesText(await aesText(JSON.stringify(obj), WE_NONCE), secret);
    return `params=${encodeURIComponent(params)}&encSecKey=${rsaSecretKey(secret)}`;
  }

  /* -------------------------------------------------------------- QR ---- */
  /* Minimal QR encoder: byte mode, EC level M, versions 1-10, auto mask.
   * Codewords and masked matrix verified byte-equal against python-qrcode. */
  function qrMatrix(text) {
    const bytes = new TextEncoder().encode(text);
    const DATA_CAP = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
    const ECC_LEN = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
    const BLOCKS = [[1, 0], [1, 0], [1, 0], [2, 0], [2, 0], [4, 0], [2, 2], [2, 2], [3, 2], [4, 1]];
    const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
    let ver = 0;
    for (let v = 0; v < 10; v++) if (bytes.length <= DATA_CAP[v] - 2) { ver = v + 1; break; }
    if (!ver) throw new Error('qr: text too long');
    const size = 17 + 4 * ver, cap = DATA_CAP[ver - 1];
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(4, 4); push(bytes.length, 8);
    for (const b of bytes) push(b, 8);
    for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    for (let i = 0; bits.length < cap * 8; i++) push(i & 1 ? 0x11 : 0xec, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
    const eccLen = ECC_LEN[ver - 1], gen = [1];
    for (let i = 0; i < eccLen; i++) {
      const ng = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) { ng[j] ^= gen[j]; ng[j + 1] ^= mul(gen[j], EXP[i]); }
      for (let j = 0; j < gen.length; j++) gen[j] = ng[j];
      gen.push(ng[gen.length]);
    }
    const [nShort, nLong] = BLOCKS[ver - 1], per = Math.floor(cap / (nShort + nLong));
    const blocks = []; let off = 0;
    for (let g = 0; g < nShort + nLong; g++) { const len = per + (g < nShort ? 0 : 1); blocks.push(data.slice(off, off + len)); off += len; }
    const eccs = blocks.map(blk => {
      const r = new Array(eccLen).fill(0);
      for (const b of blk) { const f = b ^ r[0]; r.shift(); r.push(0); for (let j = 0; j < eccLen; j++) r[j] ^= mul(gen[j + 1], f); }
      return r;
    });
    const codewords = [];
    for (let i = 0; i <= per; i++) for (const b of blocks) if (i < b.length) codewords.push(b[i]);
    for (let i = 0; i < eccLen; i++) for (const e of eccs) codewords.push(e[i]);
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const set = (x, y, v) => { if (x >= 0 && x < size && y >= 0 && y < size) m[y][x] = !!v; };
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const y of ALIGN[ver - 1]) for (const x of ALIGN[ver - 1]) {
      if (m[y][x] !== null) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    for (const y of [0, 1, 2, 3, 4, 5, 7, 8]) set(8, y, false);
    for (const x of [0, 1, 2, 3, 4, 5, 7]) set(x, 8, false);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, false);
    for (let i = 0; i < 7; i++) set(8, size - 1 - i, false);
    set(8, 4 * ver + 9, true);
    const fixed = m.map(row => row.map(v => v !== null));
    const dbits = [];
    for (const b of codewords) for (let i = 7; i >= 0; i--) dbits.push((b >> i) & 1);
    let bi = 0, up = true;
    for (let x = size - 1; x > 0; x -= 2) {
      if (x === 6) x--;
      for (let i = 0; i < size; i++) {
        const y = up ? size - 1 - i : i;
        for (const xx of [x, x - 1]) if (!fixed[y][xx]) m[y][xx] = bi < dbits.length ? !!dbits[bi++] : false;
      }
      up = !up;
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
    const penalty = mm => {
      let p = 0;
      for (let y = 0; y < size; y++) { let run = 1; for (let x = 1; x < size; x++) { if (mm[y][x] === mm[y][x - 1]) { if (++run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let x = 0; x < size; x++) { let run = 1; for (let y = 1; y < size; y++) { if (mm[y][x] === mm[y - 1][x]) { if (++run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const v = mm[y][x]; if (mm[y][x + 1] === v && mm[y + 1][x] === v && mm[y + 1][x + 1] === v) p += 3; }
      const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], patR = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      const line = get => { for (let i = 0; i + 11 <= size; i++) { let a = true, b = true; for (let j = 0; j < 11; j++) { if (get(i + j) !== !!pat[j]) a = false; if (get(i + j) !== !!patR[j]) b = false; } if (a || b) p += 40; } };
      for (let y = 0; y < size; y++) line(i => mm[y][i]);
      for (let x = 0; x < size; x++) line(i => mm[i][x]);
      let dark = 0;
      for (const row of mm) for (const v of row) if (v) dark++;
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    const formatBits = mask => {
      let rem = mask;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
      return ((mask << 10) | rem) ^ 0x5412;
    };
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const mm = m.map((row, y) => row.map((v, x) => fixed[y][x] ? !!v : (!!v !== MASKS[mask](x, y))));
      const f = formatBits(mask);
      for (let i = 0; i <= 5; i++) mm[i][8] = !!((f >> i) & 1);
      mm[7][8] = !!((f >> 6) & 1); mm[8][8] = !!((f >> 7) & 1); mm[8][7] = !!((f >> 8) & 1);
      for (let i = 9; i < 15; i++) mm[8][14 - i] = !!((f >> i) & 1);
      for (let i = 0; i < 8; i++) mm[8][size - 1 - i] = !!((f >> i) & 1);
      for (let i = 8; i < 15; i++) mm[size - 15 + i][8] = !!((f >> i) & 1);
      mm[size - 8][8] = true;
      const score = penalty(mm);
      if (score < bestScore) { bestScore = score; best = mm; }
    }
    return best;
  }

  /* --------------------------------------------------------- internals -- */
  let app, Core, h, svg, toast, confirmDialog;
  const https = url => typeof url === 'string' ? url.replace(/^http:\/\//, 'https://') : '';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
  const ICONS = {
    comment: `<path d="M2 2.25h12v8.75H7.6L4.2 13.9v-2.9H2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
    heart: '<path d="M8 13.9S2.4 10.6 2.4 6.6A3.1 3.1 0 0 1 8 5a3.1 3.1 0 0 1 5.6 1.6c0 4-5.6 7.3-5.6 7.3z"/>',
    close: '<path d="M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06"/>',
    send: '<path d="M2.2 8.6 13.5 2.2 9.4 13.8 7.6 9.6z"/><path d="M7.6 9.6 13.5 2.2" fill="none" stroke="#0f0f0f" stroke-width="1.2"/>',
    refresh: '<path d="M8 1.5a6.5 6.5 0 0 0-6.06 4.15l1.4.54A5 5 0 0 1 12.28 5.5H10.5V7H15V2.5h-1.5v1.83A6.48 6.48 0 0 0 8 1.5m4.66 8.31A5 5 0 0 1 3.72 10.5H5.5V9H1v4.5h1.5v-1.83a6.5 6.5 0 0 0 11.56-1.32z"/>',
    netease: '<path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm3.12 3.62c.42.6.65 1.42.5 2.24-.16.86-.7 1.55-1.5 1.9-.88.4-1.83.4-2.6.1-1.14-.46-2.33-1.8-1.8-3.12.3-.76 1.12-1.34 1.94-1.3.83.05 1.43.6 1.9 1.1l.15.18c.34.42.68.76 1.12.94.74.3 1.4-.16 1.6-.86.24-.87-.5-1.66-1.2-2.06-.92-.53-2.1-.5-3-.06a3.9 3.9 0 0 0-1.98 2.5c-.16.7-.1 1.44.15 2.1.6 1.6 2.08 2.5 3.7 2.5.94 0 1.9-.35 2.6-1 .5-.46.84-1.05 1.04-1.7.2-.64.22-1.3.1-1.94-.26-1.3-1.05-2.42-2.2-3-.92-.46-2-.6-3-.38-.8.17-1.54.55-2.14 1.1-.42.4-.78.88-1.02 1.42-.38.86-.5 1.83-.34 2.73.1.56.33 1.1.62 1.57a5.9 5.9 0 0 0 2.44 2.2c.7.34 1.5.5 2.28.5.4 0 .8-.03 1.18-.1-.12-.4-.34-.76-.66-1.04z"/>',
  };

  /* ----------------------------------------------------- cookie jar ----- */
  /* The relay has no browser jar: MUSIC_U / __csrf captured from sign-in
   * responses are kept here and sent as a Cookie header. On the direct path
   * (--disable-web-security) fetch() strips the header and the browser jar
   * answers instead — both paths are attached on every request. */
  const jar = new Map();
  const JAR_NAMES = ['MUSIC_U', '__csrf', 'NMTID'];
  const jarHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  function jarSet(name, value) {
    if (!JAR_NAMES.includes(name)) return;
    if (value) jar.set(name, value); else jar.delete(name);
  }
  function captureCookies(list, bodyCookie) {
    for (const source of [bodyCookie, ...(list || [])]) {
      if (typeof source !== 'string') continue;
      const m = /^([^=;\s]+)=([^;]*)/.exec(source.trim());
      if (m) jarSet(m[1], m[2]);
    }
  }
  /* The login endpoints hand the cookie string back in the JSON body too
   * (a plain string or a list of Set-Cookie lines, depending on endpoint). */
  function captureBodyCookie(bodyCookie) {
    for (const item of Array.isArray(bodyCookie) ? bodyCookie : [bodyCookie]) {
      for (const part of String(item || '').split(';')) {
        const m = /^\s*(MUSIC_U|__csrf|NMTID)=([^;]*)/.exec(part);
        if (m) jarSet(m[1], m[2]);
      }
    }
  }
  /* Sign-in responses carry the session in more than one shape: the QR check
   * returns a `cookie` string, cellphone/e-mail logins return `token` — which
   * IS the MUSIC_U value (the same string Set-Cookie would have carried, so
   * transports that cannot surface response headers still leave a session).
   * Other projects confirm: login_by_token(csrf, token) sends it as MUSIC_U. */
  function captureSession(data) {
    if (!data || typeof data !== 'object') return;
    captureBodyCookie(data.cookie);
    if (!jar.get('MUSIC_U')) {
      const token = data.token || (data.data && data.data.token) || (data.result && data.result.token);
      if (typeof token === 'string' && token) jarSet('MUSIC_U', token);
    }
    if (!jar.get('__csrf')) {
      const csrf = data.__csrf || data.csrf || data.csrfToken || (data.data && data.data.__csrf) || (data.data && data.data.csrf);
      if (typeof csrf === 'string' && csrf) jarSet('__csrf', csrf);
    }
  }

  /* ---------------------------------------------------------- account --- */
  let account = null;
  const csrfToken = () => jar.get('__csrf') || '';
  function loadAccount() {
    return app.store.kvGet(ACCOUNT_KEY).then(saved => {
      if (saved && typeof saved === 'object' && saved.cookie) {
        jar.clear();
        for (const part of String(saved.cookie).split(';')) {
          const m = /^\s*(MUSIC_U|__csrf|NMTID)=([^;]*)/.exec(part);
          if (m) jar.set(m[1], m[2]);
        }
        account = { userId: saved.userId || 0, nickname: saved.nickname || '', avatar: saved.avatar || '', at: saved.at || 0 };
      }
    }).catch(() => {});
  }
  function saveAccount(profile) {
    account = { cookie: jarHeader(), userId: profile && profile.userId || 0, nickname: profile && profile.nickname || '', avatar: https(profile && profile.avatar) || '', at: Date.now() };
    app.store.kvSet(ACCOUNT_KEY, { ...account });
  }
  function clearAccount() {
    account = null; jar.clear();
    /* liked flags in cached comments belong to the previous account. */
    comments.clear();
    app.store.kvSet(ACCOUNT_KEY, null);
  }

  /* ------------------------------------------------------------- api ---- */
  const budget = { remaining: 500 };
  async function api(method, url, { body, headers, signal } = {}) {
    const reqHeaders = { Referer: 'https://music.163.com/', Accept: 'application/json', ...(headers || {}) };
    const cookie = [reqHeaders.Cookie, jarHeader()].filter(Boolean).join('; ');
    if (cookie) reqHeaders.Cookie = cookie; else delete reqHeaders.Cookie;
    let response;
    try {
      response = await app.engine.http.request('netease', {
        method, url, headers: reqHeaders, body: body == null ? null : String(body), credentials: 'include',
      }, { signal, budget, retries: 1 });
    } catch (e) {
      throw e instanceof Core.ProviderError ? e : new Core.ProviderError('无法连接网易云音乐：' + (e.message || e), 'network');
    }
    if (response.setCookie) captureCookies(response.setCookie);
    let data;
    try { data = JSON.parse(response.body); } catch (_) { data = null; }
    return { status: response.status, data };
  }
  async function weapi(path, params, signal) {
    const body = await weapiBody({ ...params, csrf_token: csrfToken() });
    return api('POST', NETEASE + path, { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
  }

  /* ------------------------------------------------------------ eapi ---- */
  /* The weapi sign-in endpoints are risk-walled for unknown devices now, so
   * sign-in runs through eapi — the desktop client's own channel
   * (interface3.music.163.com). Envelope: the JSON payload carries a `header`
   * blob with the fake device config, then
   *   data   = apiPath + "-36cd479b6b5-" + payload + "-36cd479b6b5-" + md5("nobody"+apiPath+"use"+payload+"md5forencrypt")
   *   params = AES-128-ECB(data, "e82ckenh8dichen8") hex uppercase
   * WebCrypto has no ECB mode: AES-CBC with a zero IV on a single block IS ECB,
   * so each 16-byte block is encrypted separately and the first 16 output
   * bytes kept (the rest is the auto-added padding block). */
  const EAPI_HOST = 'https://interface3.music.163.com';
  const EAPI_KEY = 'e82ckenh8dichen8';
  const EAPI_DEVICE_KEY = 'netease:comments:device';
  let eapiDeviceId = '';
  async function loadDeviceId() {
    try { eapiDeviceId = String(await app.store.kvGet(EAPI_DEVICE_KEY) || ''); } catch (_) { /* new device */ }
    if (!/^[0-9a-f]{32}$/i.test(eapiDeviceId)) {
      eapiDeviceId = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      app.store.kvSet(EAPI_DEVICE_KEY, eapiDeviceId);
    }
  }
  /* Device profile mirrors what the maintained NetEase API projects send for
   * the iPhone client (appver/UA pair, versioncode, build number, resolution);
   * a coherent fingerprint keeps the risk wall quieter than a bare one. */
  const EAPI_UA = 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)';
  const eapiConfig = () => ({
    os: 'iPhone OS', appver: '9.0.90', osver: '16.2', channel: 'distribution', deviceId: eapiDeviceId,
    versioncode: '5038', mobilename: '', buildver: String(Math.floor(Date.now() / 1000)), resolution: '1920x1080',
  });
  /* Same device blob the request `header` carries, as the Cookie header — the
   * maintained API projects send all of it (MUSIC_U is merged in by api()). */
  const eapiCookie = () => {
    const c = eapiConfig();
    return `os=${encodeURIComponent(c.os)}; appver=${c.appver}; osver=${c.osver}; versioncode=${c.versioncode}; channel=${c.channel}; deviceId=${c.deviceId}; buildver=${c.buildver}; resolution=${c.resolution}`;
  };
  const pkcs7 = (bytes, bs = 16) => {
    const pad = bs - (bytes.length % bs), out = new Uint8Array(bytes.length + pad);
    out.set(bytes); out.fill(pad, bytes.length); return out;
  };
  const hexU = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  async function eapiBody(ep, params) {
    const payload = JSON.stringify({ ...params, header: JSON.stringify({ ...eapiConfig(), requestId: `${Date.now()}_${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}` }) });
    const apiPath = ep.replace('/eapi/', '/api/');
    const digest = md5(`nobody${apiPath}use${payload}md5forencrypt`);
    const text = `${apiPath}-36cd479b6b5-${payload}-36cd479b6b5-${digest}`;
    const bytes = pkcs7(new TextEncoder().encode(text));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(EAPI_KEY), 'AES-CBC', false, ['encrypt']);
    const iv = new Uint8Array(16), out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 16) {
      const block = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, bytes.slice(i, i + 16)));
      out.set(block.slice(0, 16), i);
    }
    return `params=${hexU(out)}`;
  }
  async function eapi(path, params, signal) {
    const body = await eapiBody(path, params);
    /* The desktop client also sends its device config as cookies, and the
     * client UA — the relay forwards it (the direct path drops it, where the
     * browser's own UA goes instead, which NetEase accepts either way). */
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: eapiCookie(), 'User-Agent': EAPI_UA };
    return api('POST', EAPI_HOST + path, { body, headers, signal });
  }

  /* -------------------------------------------------------- comments ---- */
  /* songId -> { at, total, hot, list, more, loading, loadingMore, error }.
   * Memory only: closing Spotify clears it; entries older than 2h expire. */
  const comments = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of comments) if (now - s.at > CACHE_TTL) comments.delete(id);
  }, CACHE_TTL);
  function songState(id) {
    const s = comments.get(id);
    if (s && Date.now() - s.at <= CACHE_TTL) return s;
    const fresh = { at: 0, total: -1, hot: [], list: [], more: true, loading: false, loadingMore: false, error: '' };
    comments.set(id, fresh);
    return fresh;
  }
  function normComment(c) {
    if (!c || typeof c !== 'object') return null;
    const u = c.user || {};
    const replies = Array.isArray(c.beReplied) ? c.beReplied : [];
    const rep = replies.find(r => r && r.user && r.user.nickname && typeof r.content === 'string' && r.content);
    return {
      id: c.commentId, nickname: u.nickname || '云音乐用户', avatar: https(u.avatarUrl),
      content: typeof c.content === 'string' && c.content ? c.content : String(c.richContent || ''),
      time: c.time || 0, likedCount: c.likedCount || 0, liked: !!c.liked,
      location: (c.ipLocation && c.ipLocation.location) || '',
      reply: rep ? { nickname: rep.user.nickname, content: rep.content } : null,
    };
  }
  async function fetchPage(id, offset, signal) {
    const url = `${NETEASE}/api/v1/resource/comments/R_SO_4_${encodeURIComponent(id)}?limit=${PAGE_SIZE}&offset=${offset}`;
    const { status, data } = await api('GET', url, { signal });
    if (!data || (data.code !== 200 && data.code !== 0)) {
      const msg = data && (data.message || data.msg);
      throw new Core.ProviderError(msg ? `网易云音乐：${msg}` : `网易云音乐：HTTP ${status}`);
    }
    return {
      total: data.total | 0, more: !!data.more,
      hot: offset === 0 && Array.isArray(data.hotComments) ? data.hotComments.map(normComment).filter(Boolean) : [],
      list: Array.isArray(data.comments) ? data.comments.map(normComment).filter(Boolean) : [],
    };
  }
  /* The song whose comment area is shown: the NetEase song the current lyrics
   * are bound to; otherwise the best NetEase match of the playing track. */
  async function resolveSong(signal) {
    const engine = app.engine, track = engine.track;
    if (!track || !track.title) return null;
    const match = engine.match;
    if (match && match.provider === 'netease' && match.id) {
      return { id: String(match.id), title: match.title || track.title, artists: match.artists && match.artists.length ? match.artists : track.artists, via: 'lyrics' };
    }
    for (const query of Core.searchQueries(track)) {
      let candidates = [];
      try { candidates = await engine.providerSearch('netease', query.text, signal, { remaining: 4 }); }
      catch (e) { if (e && (e.kind === 'cancelled' || e.kind === 'blocked')) throw e; continue; }
      const best = Core.matchSelect(candidates.map(c => Core.matchScore(track, c)), 'netease');
      if (best) return { id: String(best.id), title: best.title, artists: best.artists, via: 'search' };
    }
    return null;
  }
  async function accountStatus(signal) {
    const { data } = await api('POST', `${NETEASE}/api/w/nuser/account/get`, { signal });
    const profile = data && data.profile;
    return profile && profile.userId ? { userId: profile.userId, nickname: profile.nickname || '', avatar: profile.avatarUrl || '' } : null;
  }

  function fmtCommentTime(ms) {
    const d = new Date(ms), now = new Date();
    const pad = n => String(n).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /* -------------------------------------------------------------- UI ---- */
  class CommentsUI {
    constructor() {
      this.active = false; this.song = null; this.gen = 0; this.pollTimer = 0;
      this.buildPage();
      this.loginDialog = null; this.loginTab = 'qr'; this.qr = { key: '', stopped: true };
      /* Track changes while the comments tab is active reload the area. */
      this.key = '';
      this.pollTimer = setInterval(() => { if (this.active) this.checkTrack(); }, 1500);
      if (this.pollTimer.unref) this.pollTimer.unref();
    }
    buildPage() {
      this.titleEl = h('span', { class: 'slc-title' }, '评论');
      this.countEl = h('span', { class: 'slc-count' });
      this.userBox = h('span', { class: 'slc-head-user' });
      this.refreshBtn = h('button', { type: 'button', class: 'sl-icon-btn', title: '刷新评论', 'aria-label': '刷新评论', onclick: () => this.refresh() }, svg(ICONS.refresh));
      this.head = h('div', { class: 'slc-head' },
        this.titleEl, this.countEl, h('span', { class: 'slc-spacer' }), this.userBox, this.refreshBtn);
      this.songEl = h('div', { class: 'slc-songwrap' });
      this.hotEl = h('div', { class: 'slc-list' });
      this.listEl = h('div', { class: 'slc-list' });
      this.stateEl = h('div', { class: 'slc-state' });
      this.sentinel = h('div', { class: 'slc-more' }, '');
      this.scroll = h('div', { class: 'slc-scroll' }, this.songEl, this.stateEl, this.hotEl, this.listEl, this.sentinel);
      this.input = h('input', {
        type: 'text', maxlength: '140', placeholder: '登录后发表评论',
        onkeydown: e => { if (e.key === 'Enter') this.post(); },
      });
      this.sendBtn = h('button', { type: 'button', class: 'sl-btn sl-btn-green', onclick: () => this.post() }, svg(ICONS.send), '发送');
      this.inputBar = h('div', { class: 'slc-input' }, this.input, this.sendBtn);
      /* The disabled composer swallows clicks: treat any press on it as "log me in". */
      this.inputBar.addEventListener('mousedown', e => { if (!account) { e.preventDefault(); this.showLogin(); } });
      this.el = h('div', { class: 'slc', role: 'region', 'aria-label': '网易云音乐评论区', 'data-testid': 'spot-lyric-comments' },
        this.head, this.scroll, this.inputBar);
      this.sentinelObs = new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting) this.loadMore();
      }, { root: this.scroll, rootMargin: '200px' });
      document.addEventListener('keydown', e => {
        /* Escape closes the shared panel, not just this tab. */
        if (e.key === 'Escape' && this.active && !this.loginDialog) { e.stopPropagation(); app.view.closePanel(); }
      }, true);
    }
    activate() {
      if (this.active) return;
      this.active = true;
      this.renderUser();
      /* MUSIC_U can expire silently between sessions: once per app start the
       * stored account is confirmed so a dead cookie does not linger. */
      if (account && !this._verified) {
        this._verified = true;
        accountStatus().then(profile => { if (!profile) { clearAccount(); this.renderUser(); } }).catch(() => {});
      }
      this.checkTrack(true);
    }
    deactivate() {
      if (!this.active) return;
      this.active = false;
      this.closeLogin();
    }
    /* Current playing song -> NetEase comment resource, following engine.match
     * first and the search fallback otherwise. */
    async checkTrack(force) {
      const engine = app.engine;
      if (!engine.track) { this.applySong(null); return; }
      if (engine.busy) { this.setState('matching'); return; }
      const match = engine.match;
      const probe = match && match.provider === 'netease' ? `${match.provider}:${match.id}` : `search:${engine.track.uri || engine.track.title}`;
      if (!force && probe === this.key) return;
      this.key = probe;
      this.song = null;   /* drop the previous song before the spinner shows */
      const gen = ++this.gen;
      this.setState('loading');
      let song = null, error = '';
      try { song = await resolveSong(); }
      catch (e) { error = e && e.message || String(e); }
      if (gen !== this.gen) return;
      if (error) { this.applySong(null, error); return; }
      this.applySong(song);
    }
    applySong(song, error) {
      this.song = song;
      if (error) { this.setState('error', error); return; }
      if (!song) { this.setState(app.engine.track ? 'nosong' : 'notrack'); return; }
      const state = songState(song.id);
      this.renderSongHeader(song, state);
      if (state.list.length || state.at) { this.render(); return; }
      this.loadFirst();
    }
    async loadFirst() {
      const song = this.song, state = songState(song.id), gen = this.gen;
      state.loading = true; this.setState('loading');
      try {
        const page = await fetchPage(song.id, 0);
        if (gen !== this.gen) return;
        state.at = Date.now(); state.total = page.total;
        state.hot = page.hot; state.list = page.list; state.more = page.more;
        state.error = '';
      } catch (e) {
        if (gen !== this.gen) return;
        state.error = e.message || String(e);
        this.setState('error', state.error);
        return;
      } finally { state.loading = false; }
      this.render();
    }
    async loadMore() {
      const song = this.song;
      if (!song) return;
      const state = songState(song.id), gen = this.gen;
      if (!state.more || state.loadingMore || state.loading || !state.at) return;
      state.loadingMore = true; this.renderSentinel(state);
      try {
        const page = await fetchPage(song.id, state.list.length);
        if (gen !== this.gen) return;
        state.at = Date.now(); state.total = page.total;
        state.list = state.list.concat(page.list);
        state.more = page.more; state.error = '';
      } catch (e) {
        if (gen !== this.gen) return;
        state.moreError = e.message || String(e);
      } finally { state.loadingMore = false; }
      this.render();
    }
    refresh() {
      if (!this.song) { this.checkTrack(true); return; }
      const state = songState(this.song.id);
      state.at = 0; state.list = []; state.hot = []; state.more = true; state.moreError = '';
      this.scroll.scrollTop = 0;
      this.loadFirst();
    }
    /* ------------------------------------------------------- rendering -- */
    renderUser() {
      if (account) {
        this.userBox.replaceChildren(h('button', {
          type: 'button', class: 'slc-user', title: `${account.nickname || '网易云用户'} · 点击退出登录`,
          onclick: () => this.logout(),
        }, account.avatar ? h('img', { src: https(account.avatar), alt: '' }) : svg(ICONS.netease, 16), h('span', null, account.nickname || '网易云用户')));
      } else {
        this.userBox.replaceChildren(h('button', {
          type: 'button', class: 'slc-user slc-login-btn', title: '登录网易云音乐后可点赞和评论',
          onclick: () => this.showLogin(),
        }, svg(ICONS.netease, 16), h('span', null, '登录')));
      }
      const loggedIn = !!account;
      this.input.disabled = !loggedIn;
      this.input.placeholder = loggedIn ? `以 ${account.nickname || '网易云用户'} 的身份评论` : '登录后发表评论';
      this.sendBtn.disabled = !loggedIn;
    }
    setState(kind, detail) {
      const box = this.stateEl;
      const clear = () => { box.replaceChildren(); box.hidden = true; };
      /* Every non-ready state drops the previous song's rows immediately — the
       * old comments must never linger under a loader or an error message. */
      const clearContent = () => {
        this.renderSongHeader(null);
        this.hotEl.replaceChildren(); this.listEl.replaceChildren();
        this.renderSentinel(null); this.sentinelObs.disconnect();
      };
      if (kind === 'loading' || kind === 'matching') {
        clearContent();
        box.hidden = false;
        box.replaceChildren(h('div', { class: 'sl-loader', 'aria-label': '正在加载' }, h('i'), h('i'), h('i')),
          h('p', { class: 'slc-state-sub' }, kind === 'matching' ? '正在匹配歌词…' : '正在加载评论…'));
        return;
      }
      const show = (title, sub, action) => {
        clearContent();
        box.hidden = false;
        box.replaceChildren(h('p', { class: 'slc-state-title' }, title),
          ...(sub ? [h('p', { class: 'slc-state-sub' }, sub)] : []), ...(action ? [action] : []));
      };
      if (kind === 'notrack') show('没有正在播放的歌曲', '播放一首歌后，这里会显示它的网易云音乐评论区');
      else if (kind === 'nosong') show('网易云音乐没有找到这首歌', '当前歌曲在网易云音乐中匹配不到，无法显示评论区');
      else if (kind === 'error') show('无法加载评论', detail || '', h('button', { type: 'button', class: 'sl-btn sl-btn-ghost sl-btn-small', onclick: () => this.checkTrack(true) }, '重试'));
      else { clear(); this.renderSongHeader(this.song, this.song && songState(this.song.id)); }
    }
    render() {
      const song = this.song;
      if (!song) return;
      const state = songState(song.id);
      this.stateEl.replaceChildren(); this.stateEl.hidden = true;
      this.renderSongHeader(song, state);
      this.renderList();
    }
    renderSongHeader(song, state) {
      setText(this.countEl, state && state.total > 0 ? `(${state.total})` : '');
      if (!song) { this.songEl.replaceChildren(); return; }
      const info = app.trackInfo;
      const cover = info && (info.imageLarge || info.image) ? info.imageLarge || info.image : '';
      this.songEl.replaceChildren(h('div', { class: 'slc-song' },
        cover ? h('img', { src: https(cover.replace('spotify:image:', 'https://i.scdn.co/image/')), alt: '' }) : null,
        h('div', { class: 'slc-song-txt' },
          h('div', { class: 'slc-song-title' }, song.title || (info && info.title) || ''),
          h('div', { class: 'slc-song-sub' }, [(song.artists || []).join(', ') || (info && info.artists.join(', ')) || '', '网易云音乐' + (song.via === 'search' ? ' · 自动匹配' : '')].filter(Boolean).join(' · ')))));
    }
    renderList(loading) {
      const song = this.song;
      const state = song ? songState(song.id) : null;
      const sectionTitle = (text, count) => h('div', { class: 'slc-sec' }, text, count != null ? h('small', null, `${count} 条`) : null);
      const hotRows = state && state.hot.length ? [sectionTitle('热门评论'), ...state.hot.map(c => this.commentRow(c, true))] : [];
      this.hotEl.replaceChildren(...hotRows);
      const latest = state ? state.list : [];
      const latestRows = [sectionTitle('最新评论', state && state.total > 0 ? state.total : null), ...latest.map(c => this.commentRow(c, false))];
      this.listEl.replaceChildren(...latestRows);
      this.renderSentinel(state);
      this.sentinelObs.disconnect();
      if (state && !loading) this.sentinelObs.observe(this.sentinel);
    }
    renderSentinel(state) {
      if (!state || !this.song) { setText(this.sentinel, ''); this.sentinel.hidden = true; return; }
      this.sentinel.hidden = false;
      if (state.loadingMore) setText(this.sentinel, '正在加载…');
      else if (state.moreError) {
        this.sentinel.replaceChildren('加载失败 ',
          h('button', { type: 'button', class: 'sl-btn sl-btn-ghost sl-btn-small', onclick: () => { state.moreError = ''; this.loadMore(); } }, '重试'));
      } else if (state.at && !state.list.length && !state.loading) setText(this.sentinel, '还没有评论，来抢沙发');
      else if (!state.more && state.list.length) setText(this.sentinel, '没有更多了');
      else setText(this.sentinel, '');
    }
    commentRow(c, hot) {
      const likeBtn = h('button', {
        type: 'button', class: 'slc-like' + (c.liked ? ' slc-on' : ''),
        title: account ? (c.liked ? '取消点赞' : '点赞') : '登录后点赞',
        onclick: () => this.like(c, likeBtn),
      }, svg(ICONS.heart, 14), h('span', null, c.likedCount > 0 ? String(c.likedCount) : '赞'));
      c._likeBtn = likeBtn;
      return h('div', { class: 'slc-row', 'data-cid': c.id },
        c.avatar ? h('img', { class: 'slc-ava', src: c.avatar, alt: '', loading: 'lazy' }) : h('span', { class: 'slc-ava' }),
        h('div', { class: 'slc-main' },
          h('div', { class: 'slc-nick' }, c.nickname),
          h('div', { class: 'slc-content' }, c.content),
          c.reply ? h('div', { class: 'slc-reply' }, h('b', null, `回复 @${c.reply.nickname}：`), c.reply.content) : null,
          h('div', { class: 'slc-foot' },
            h('span', null, [c.time ? fmtCommentTime(c.time) : '', c.location].filter(Boolean).join(' · ')),
            likeBtn)));
    }
    /* ------------------------------------------------------------ ops --- */
    needLogin() {
      if (account) return false;
      this.showLogin();
      toast('先登录网易云音乐');
      return true;
    }
    async like(c, btn) {
      if (this.needLogin()) return;
      const song = this.song;
      if (!song) return;
      btn.disabled = true;
      try {
        const { data } = await weapi('/weapi/v1/comment/like', { commentId: String(c.id), threadId: `R_SO_4_${song.id}`, like: c.liked ? 0 : 1 });
        if (data && (data.code === 200 || data.code === 0)) {
          c.liked = !c.liked;
          c.likedCount += c.liked ? 1 : -1;
          btn.classList.toggle('slc-on', c.liked);
          setText(btn.querySelector('span'), c.likedCount > 0 ? String(c.likedCount) : '赞');
        } else {
          toast('点赞失败：' + (data && (data.message || data.msg) || '未知错误'));
        }
      } catch (e) { toast('点赞失败：' + (e.message || e)); }
      finally { btn.disabled = false; }
    }
    async post() {
      const text = (this.input.value || '').trim();
      if (!text) return;
      if (this.needLogin()) return;
      const song = this.song;
      if (!song) { toast('没有可评论的歌曲'); return; }
      this.sendBtn.disabled = true;
      try {
        const { data } = await weapi('/weapi/v1/resource/comments/add', { threadId: `R_SO_4_${song.id}`, content: text });
        if (data && (data.code === 200 || data.code === 0) && data.comment) {
          const c = normComment(data.comment);
          const state = songState(song.id);
          if (c) { state.list.unshift(c); state.total++; }
          this.input.value = '';
          this.render();
          toast('评论已发布');
        } else {
          toast('发布失败：' + (data && (data.message || data.msg) || '未知错误'));
        }
      } catch (e) { toast('发布失败：' + (e.message || e)); }
      finally { this.sendBtn.disabled = false; }
    }
    async logout() {
      const ok = await confirmDialog({ title: '退出网易云音乐登录？', body: '退出后将无法点赞和发布评论，登录状态会从本机移除。', confirm: '退出登录' });
      if (!ok) return;
      try { await api('POST', `${NETEASE}/api/logout`); } catch (_) { /* best effort */ }
      clearAccount();
      this.renderUser();
      toast('已退出网易云音乐');
    }
    /* ---------------------------------------------------------- login --- */
    showLogin() {
      this.closeLogin();
      const previous = document.activeElement;
      this.loginBody = h('div');
      this.loginErr = h('p', { class: 'slc-login-err', role: 'alert' });
      this.loginTabs = {
        qr: h('button', { type: 'button', class: 'sl-chip', onclick: () => this.loginTabShow('qr') }, '扫码登录'),
        phone: h('button', { type: 'button', class: 'sl-chip', onclick: () => this.loginTabShow('phone') }, '手机登录'),
        email: h('button', { type: 'button', class: 'sl-chip', onclick: () => this.loginTabShow('email') }, '邮箱登录'),
      };
      const dialog = h('div', { class: 'sl-dialog slc-login', role: 'dialog', 'aria-modal': 'true' },
        h('button', { type: 'button', class: 'sl-icon-btn slc-x', 'aria-label': '关闭登录窗口', title: '关闭', onclick: () => this.closeLogin() }, svg(ICONS.close)),
        h('h2', { class: 'sl-dialog-title' }, '登录网易云音乐'),
        h('div', { class: 'slc-login-tabs' }, this.loginTabs.qr, this.loginTabs.phone, this.loginTabs.email),
        this.loginBody, this.loginErr,
        h('p', { class: 'slc-login-note' }, '登录状态仅保存在本机，用于点赞和发布评论；二维码由网易云音乐生成，请在网易云音乐 App 中扫码确认。'));
      const backdrop = h('div', {
        class: 'sl-dialog-backdrop',
        onmousedown: e => { if (e.target === backdrop) this.closeLogin(); },
      }, dialog);
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeLogin(); }
      };
      document.addEventListener('keydown', onKey, true);
      this.loginDialog = { backdrop, onKey, previous };
      document.body.append(backdrop);
      this.loginTabShow('qr');
    }
    closeLogin() {
      this.qr.stopped = true;
      const d = this.loginDialog;
      if (!d) return;
      this.loginDialog = null;
      document.removeEventListener('keydown', d.onKey, true);
      d.backdrop.remove();
      if (d.previous && d.previous.focus) d.previous.focus({ preventScroll: true });
    }
    loginTabShow(tab) {
      this.loginTab = tab;
      for (const [k, b] of Object.entries(this.loginTabs)) b.classList.toggle('sl-on', k === tab);
      setText(this.loginErr, '');
      if (tab === 'qr') this.qrStart();
      else { this.qr.stopped = true; this.loginBody.replaceChildren(tab === 'phone' ? this.phoneForm() : this.emailForm()); }
    }
    loginError(text) { setText(this.loginErr, text || ''); }
    async finishLogin(loginProfile) {
      let profile = null;
      try { profile = await accountStatus(); } catch (_) { /* below */ }
      if (!profile) {
        if (!jar.get('MUSIC_U')) {
          this.loginError('登录成功但无法读取会话 Cookie：当前转发服务版本过旧（请更新本地服务 / 歌词服务器），可改用扫码登录');
          return;
        }
        /* MUSIC_U came from the body token but the status probe failed: keep
         * the profile the login response already carried instead of a stub. */
        const p = loginProfile || {};
        profile = { userId: p.userId || 0, nickname: p.nickname || '', avatar: p.avatarUrl || p.avatar || '' };
      }
      /* Signing in as a different user: cached comments carry the previous
       * account's liked flags — drop them all and refetch. */
      comments.clear();
      saveAccount(profile || { userId: 0, nickname: '网易云用户', avatar: '' });
      this.closeLogin();
      this.renderUser();
      toast(`已登录${profile && profile.nickname ? '：' + profile.nickname : '网易云音乐'}`);
      const song = this.song;
      if (song) { const state = songState(song.id); state.at = 0; this.loadFirst(); }
    }
    /* QR login: unikey -> QR image -> poll until the phone confirms (803). */
    async qrStart() {
      this.qr.stopped = true;
      const box = h('div', { class: 'slc-qrbox' });
      const text = h('p', { class: 'slc-qrtext' }, '正在获取二维码…');
      const refresh = h('button', { type: 'button', class: 'sl-btn sl-btn-ghost sl-btn-small', style: { display: 'block', margin: '8px auto 0' }, onclick: () => this.qrStart() }, '刷新二维码');
      this.loginBody.replaceChildren(box, text, refresh);
      const session = this.qr = { key: '', stopped: false };
      let unikey;
      try {
        const { data } = await eapi('/eapi/login/qrcode/unikey', { type: '1', noCheckToken: 'true' });
        if (!data || data.code !== 200 || !data.unikey) throw new Error('获取二维码失败');
        unikey = data.unikey;
      } catch (e) { if (!session.stopped) { setText(text, '获取二维码失败：' + (e.message || e)); } return; }
      if (session.stopped) return;
      session.key = unikey;
      session.deadline = Date.now() + 5 * 60 * 1000;
      const canvas = h('canvas');
      const m = qrMatrix(`https://music.163.com/login?codekey=${encodeURIComponent(unikey)}`);
      const cell = 5, quiet = 4, n = m.length;
      canvas.width = canvas.height = (n + quiet * 2) * cell;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) ctx.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
      box.replaceChildren(canvas);
      setText(text, '打开网易云音乐 App，扫码并确认登录');
      /* Poll: 801 waiting / 802 scanned / 803 confirmed / 800 expired. */
      const poll = async () => {
        if (session.stopped || this.loginTab !== 'qr') return;
        if (Date.now() > session.deadline) { setText(text, '二维码已过期，请点击下方刷新'); session.stopped = true; return; }
        try {
          const { data } = await eapi('/eapi/login/qrcode/client/login', { type: '1', noCheckToken: 'true', key: unikey });
          if (session.stopped) return;
          const code = data && data.code;
          if (code === 803) {
            captureSession(data);
            setText(text, '登录成功，正在获取账号信息…');
            this.finishLogin(data && data.profile);
            return;
          }
          if (code === 802) setText(text, '已扫码，请在手机上确认登录');
          else if (code === 800) { setText(text, '二维码已过期，请点击下方刷新'); return; }
        } catch (_) { /* keep polling: transient relay errors are common */ }
        if (!session.stopped) session.timer = setTimeout(poll, 2000);
      };
      session.timer = setTimeout(poll, 1200);
    }
    phoneForm() {
      this._phoneMode = this._phoneMode || 'password';
      const phone = h('input', { class: 'sl-input', type: 'tel', placeholder: '手机号', autocomplete: 'tel' });
      const modeBtns = {};
      const secret = h('input', { class: 'sl-input', type: 'password', placeholder: '密码' });
      const captchaBtn = h('button', { type: 'button', class: 'sl-btn sl-btn-ghost sl-btn-small', onclick: () => this.sendCaptcha(phone.value) }, '获取验证码');
      const secretWrap = h('div', { class: 'slc-captcha' });
      const render = () => {
        for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle('sl-on', k === this._phoneMode);
        secret.placeholder = this._phoneMode === 'password' ? '密码' : '验证码';
        secret.type = this._phoneMode === 'password' ? 'password' : 'tel';
        secretWrap.replaceChildren(...(this._phoneMode === 'captcha' ? [secret, captchaBtn] : [secret]));
      };
      modeBtns.password = h('button', { type: 'button', class: 'sl-chip', onclick: () => { this._phoneMode = 'password'; render(); } }, '密码登录');
      modeBtns.captcha = h('button', { type: 'button', class: 'sl-chip', onclick: () => { this._phoneMode = 'captcha'; render(); } }, '验证码登录');
      const submit = h('button', { type: 'button', class: 'sl-btn sl-btn-green', style: { width: '100%', minHeight: '40px' }, onclick: () => this.phoneLogin(phone.value, secret.value, submit) }, '登录');
      render();
      return h('div', null,
        h('div', { class: 'slc-field' }, h('span', { class: 'slc-label' }, '手机号'), phone),
        h('div', { class: 'slc-login-tabs' }, modeBtns.password, modeBtns.captcha),
        h('div', { class: 'slc-field' }, secretWrap), submit);
    }
    async sendCaptcha(phone) {
      if (!/^1\d{10}$/.test((phone || '').trim())) { this.loginError('请输入 11 位手机号'); return; }
      this.loginError('');
      try {
        /* Plaintext endpoint: the weapi captcha variants reject anonymous
         * params, while /api/sms/captcha/sent answers {code:200,data:true}. */
        const { data } = await api('POST', `${NETEASE}/api/sms/captcha/sent`, {
          body: `cellphone=${encodeURIComponent(phone.trim())}&ctcode=86`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (data && (data.code === 200 || data.code === 0)) toast('验证码已发送');
        else this.loginError('发送失败：' + (data && (data.message || data.msg) || '请稍后重试'));
      } catch (e) { this.loginError('发送失败：' + (e.message || e)); }
    }
    async phoneLogin(phone, secret, btn) {
      phone = (phone || '').trim(); secret = (secret || '').trim();
      if (!/^1\d{10}$/.test(phone)) { this.loginError('请输入 11 位手机号'); return; }
      if (!secret) { this.loginError(this._phoneMode === 'password' ? '请输入密码' : '请输入验证码'); return; }
      btn.disabled = true; this.loginError('');
      try {
        /* Desktop-client channel (eapi): the phone login the official app uses.
         * checkToken is where a slider token would go on the strictest accounts. */
        const params = { type: '1', phone, remember: 'true', rememberLogin: 'true', https: 'true', countrycode: '86', checkToken: '' };
        if (this._phoneMode === 'captcha') params.captcha = secret; else params.password = md5(secret);
        const { data } = await eapi('/eapi/w/login/cellphone', params);
        if (data && data.code === 200) { captureSession(data); this.finishLogin(data.profile); return; }
        const msg = (data && (data.message || data.msg)) || `code ${data && data.code}`;
        /* Account-level protection still wins: point at the QR path, which the
         * logged-in app authorizes by design. */
        const hint = /本人账号|设备|验证/.test(msg) || (data && data.code === 509)
          ? '（该账号触发了新设备验证，建议改用「扫码登录」，由已登录的网易云 App 授权）' : '';
        this.loginError('登录失败：' + msg + hint);
      } catch (e) { this.loginError('登录失败：' + (e.message || e)); }
      finally { btn.disabled = false; }
    }
    emailForm() {
      const email = h('input', { class: 'sl-input', type: 'email', placeholder: '邮箱', autocomplete: 'email' });
      const pass = h('input', { class: 'sl-input', type: 'password', placeholder: '密码', autocomplete: 'current-password' });
      const submit = h('button', { type: 'button', class: 'sl-btn sl-btn-green', style: { width: '100%', minHeight: '40px' }, onclick: () => this.emailLogin(email.value, pass.value, submit) }, '登录');
      pass.addEventListener('keydown', e => { if (e.key === 'Enter') submit.click(); });
      return h('div', null,
        h('div', { class: 'slc-field' }, h('span', { class: 'slc-label' }, '邮箱'), email),
        h('div', { class: 'slc-field' }, h('span', { class: 'slc-label' }, '密码'), pass), submit);
    }
    async emailLogin(email, pass, btn) {
      if (!/^\S+@\S+\.\S+$/.test((email || '').trim())) { this.loginError('请输入正确的邮箱'); return; }
      if (!pass) { this.loginError('请输入密码'); return; }
      btn.disabled = true; this.loginError('');
      try {
        const { data } = await eapi('/eapi/login', { type: '1', username: email.trim(), remember: 'true', rememberLogin: 'true', https: 'true', password: md5(pass) });
        if (data && data.code === 200) { captureSession(data); this.finishLogin(data.profile); return; }
        this.loginError('登录失败：' + (data && (data.message || data.msg) || `code ${data && data.code}`));
      } catch (e) { this.loginError('登录失败：' + (e.message || e)); }
      finally { btn.disabled = false; }
    }
  }

  /* ------------------------------------------------------------ mount --- */
  window.SpotLyricComments = {
    version: '__SPOT_LYRIC_VERSION__',
    async mount(hostApi) {
      app = hostApi.app; Core = hostApi.Core; h = hostApi.h; svg = hostApi.svg; toast = hostApi.toast; confirmDialog = hostApi.confirmDialog;
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.append(style);
      await Promise.all([loadAccount(), loadDeviceId()]);
      const ui = new CommentsUI();
      /* Host contract: the side panel mounts view.el in its comments tab and
       * calls view.activate() / view.deactivate() as the tab is toggled. */
      window.SpotLyricComments.view = { el: ui.el, activate: () => ui.activate(), deactivate: () => ui.deactivate() };
      console.log('%c[spot-lyric]', 'color:#1ed760;font-weight:bold', 'comments plugin mounted');
    },
  };
})();
