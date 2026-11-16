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

const knownAnswer =
  'pbkdf2$10000$a1b2c3d4e5f60718293a4b5c6d7e8f90$36c9fd9116d7cf3493c10fc60076156a07b8a9f93a265c9db4e58e2104d42133';

test('vektor known-answer pbkdf2 terverifikasi', () => {
  assert.ok(verifyPbkdf2('vektor-pbkdf2-uji', knownAnswer));
});

test('hash format length', () => {
  assert.equal(createHash('sha256').digest('hex').length, 64);
});
