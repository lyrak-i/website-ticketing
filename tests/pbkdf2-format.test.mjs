import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync } from 'node:crypto';

function verifyPbkdf2(password, stored) {
  const parts = String(stored).split('$');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'pbkdf2');
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, 'sha256');
  return actual.equals(expected);
}

const adminHash =
  'pbkdf2$10000$c2ab6bd3d5ea28385e33a39e3cb8394b$509ad95ea212ef0d4a3e973865df363a605b1d52ad9e2f41afe78ee5aa481191';

test('demo admin hash matches admin2026', () => {
  assert.ok(verifyPbkdf2('admin2026', adminHash));
});

test('hash format length', () => {
  assert.equal(createHash('sha256').digest('hex').length, 64);
});
