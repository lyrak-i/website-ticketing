import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const stampSource = readFileSync(new URL('../tools/stamp_assets.py', import.meta.url), 'utf8');

// Jalankan file stamp_assets.py di interpreter yang sama secara isolated
// tidak perlu: hash rule diverifikasi persis terhadap bytes LF canonical.
function lfHash(data) {
  return createHash('sha256')
    .update(data.replace(/\r\n?/g, '\n'), 'utf8')
    .digest('hex')
    .slice(0, 10);
}

test('stamping menormalisasi CRLF dan LF ke hash yang sama', () => {
  const lf = 'baris satu\nbaris dua\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(lfHash(lf), lfHash(crlf));
});

test('script stamp memakai hash SHA-256 atas bytes LF canonical', () => {
  assert.match(stampSource, /replace\(b'\\r\\n', b'\\n'\)/);
  assert.match(stampSource, /hashlib\.sha256\(data\)/);
});

test('setiap ?v= di dua halaman cocok dengan hash canonical aset saat ini', () => {
  for (const page of ['index.html', 'mbp.html']) {
    const html = readFileSync(new URL(page, root), 'utf8');
    const matches = [...html.matchAll(/(?:href|src)="(css\/app\.css|js\/[A-Za-z0-9._-]+\.js)\?v=([0-9a-f]{10})"/g)];
    assert.ok(matches.length > 0, `tidak ada asset stamp pada ${page}`);
    for (const [, assetPath, stampedHash] of matches) {
      const bytes = readFileSync(new URL(assetPath, root));
      const canonical = bytes.toString('utf8').replace(/\r\n?/g, '\n');
      assert.equal(stampedHash, lfHash(canonical), `${page} -> ${assetPath}`);
    }
  }
});

test('.gitattributes memaksa line ending LF', () => {
  const attrs = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8');
  assert.match(attrs, /^\* text=auto eol=lf$/m);
});

test('config dan auth JS tidak memuat kredensial demo', () => {
  const auth = readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
  const demoUsers = readFileSync(new URL('../js/demo-users.js', import.meta.url), 'utf8');
  assert.doesNotMatch(auth, /verifyPassword\s*\(|DEMO_USERS\.find/);
  assert.doesNotMatch(demoUsers, /pbkdf2\$/);
});

void root;
