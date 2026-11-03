#!/usr/bin/env node
/*
 * Regenerate the T2S_FROM / T2S_TO lookup strings in src/core.js from OpenCC
 * dictionary data (https://github.com/BYVoid/OpenCC, data/dictionary/).
 *
 *   node tools/gen-t2s.mjs            # fetch dicts, patch src/core.js
 *   node tools/gen-t2s.mjs ./dir      # use a local dir containing the .txt files
 *
 * Character-level fold only — ambiguity is resolved by taking OpenCC's first
 * candidate (e.g. 乾→干). That is fine for matching: normalize() applies the
 * same fold to both sides, so consistent loss still collides.
 *
 * Sources:
 *   TSCharacters.txt               traditional -> simplified (base table)
 *   TWVariants.txt / HKVariants.txt  regional variants -> standard trad (chained)
 *   JPShinjitaiCharacters.txt      shinjitai -> kyujitai (chained: 桜→櫻→樱)
 *   CJK_Compatibility_Ideographs.txt  U+F900.. compat chars -> ideograph (chained)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DICTS = ['TSCharacters.txt', 'TWVariants.txt', 'HKVariants.txt',
  'JPShinjitaiCharacters.txt', 'CJK_Compatibility_Ideographs.txt'];
const BASE = 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/';
const CORE = path.join(import.meta.dirname, '..', 'src', 'core.js');

const dir = process.argv[2] || fs.mkdtempSync(path.join(import.meta.dirname, '.opencc-'));
for (const f of DICTS) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p) || fs.statSync(p).size < 100)
    execFileSync('curl', ['-sLf', '-m', '60', '-o', p, BASE + f], { stdio: 'inherit' });
  if (fs.statSync(p).size < 100) { console.error(`failed to fetch ${f}`); process.exit(1); }
}

const isBmp = s => [...s].length === 1 && s.codePointAt(0) <= 0xffff;
const parse = f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
  .filter(l => l && !l.startsWith('#'))
  .map(l => l.split('\t')).filter(p => p.length === 2)
  .map(([k, v]) => [k, v.split(' ')[0]]);

const t2s = new Map();
for (const [k, v] of parse('TSCharacters.txt'))
  if (k !== v && isBmp(k) && isBmp(v) && !t2s.has(k)) t2s.set(k, v);
for (const f of DICTS.slice(1))
  for (const [k, v] of parse(f)) {
    if (!isBmp(k) || !isBmp(v) || t2s.has(k) || k === v) continue;
    const t = t2s.get(v) || v;                    // variant -> trad -> simplified, else trad
    if (t !== k) t2s.set(k, t);
  }

const from = [...t2s.keys()].join(''), to = [...t2s.values()].join('');
let src = fs.readFileSync(CORE, 'utf8');
const replaced = src
  .replace(/const T2S_FROM = "[^"]+";/, `const T2S_FROM = "${from}";`)
  .replace(/const T2S_TO = "[^"]+";/, `const T2S_TO = "${to}";`);
if (replaced === src) { console.error('T2S strings not found in ' + CORE); process.exit(1); }
fs.writeFileSync(CORE, replaced);
console.log(`${CORE}: ${t2s.size} pairs written`);
