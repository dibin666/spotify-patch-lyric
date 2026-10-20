// CHANGELOG.md: the release notes (GitHub Release body and the plugin's update prompt).
// Every version has a section, every entry is one short line of at most 10 characters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8').replace(/\r/g, '');
const version = readFileSync(new URL('VERSION', root), 'utf8').trim();
const body = changelog.replace(/<!--[\s\S]*?-->/g, '');

const sections = new Map();
let current = null;
for (const line of body.split('\n')) {
  const head = /^## (v\d+\.\d+\.\d+)\s*$/.exec(line);
  if (head) { current = []; sections.set(head[1], current); continue; }
  if (current && line.trim()) current.push(line);
}

test('the current VERSION has a section', () => {
  assert.ok(sections.has(`v${version}`), `CHANGELOG.md has no "## v${version}"`);
});

test('every entry is a "- " line of at most 10 characters', () => {
  for (const [tag, lines] of sections) {
    assert.ok(lines.length > 0, `${tag} has no entries`);
    for (const line of lines) {
      const entry = /^- (\S.*)$/.exec(line);
      assert.ok(entry, `${tag}: not a "- " entry: ${line}`);
      const length = [...entry[1].trim()].length;
      assert.ok(length <= 10, `${tag}: "${entry[1]}" has ${length} characters (at most 10)`);
    }
  }
});

test('versions are listed newest first', () => {
  const key = tag => tag.slice(1).split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
  const tags = [...sections.keys()];
  assert.deepEqual(tags, [...tags].sort((a, b) => key(b) - key(a)));
});
