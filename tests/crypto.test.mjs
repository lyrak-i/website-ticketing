import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Fungsi GAS dimuat apa adanya dari source, lalu diberi pagar agar tidak
// menyentuh service Google saat test.
const cryptoSource = readFileSync(new URL('../apps-script/Crypto.gs', import.meta.url), 'utf8');
const cryptoExports = new Function(
  `${cryptoSource}\nreturn { sha256, hmacSha256, pbkdf2Sha256, safeEquals, hexToBytes, bytesToHex, utf8Bytes };`
)();

const { sha256, hmacSha256, pbkdf2Sha256, safeEquals, hexToBytes, bytesToHex, utf8Bytes } = cryptoExports;

test('sha256 cocok dengan vektorknown', () => {
  assert.equal(
    bytesToHex(sha256(hexToBytes('616263'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    bytesToHex(sha256(hexToBytes(''))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('hmac-sha256 cocok dengan RFC 4231 test case 1', () => {
  const key = new Uint8Array(20).fill(0x0b);
  const msg = utf8Bytes('Hi There');
  const expected = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7';
  assert.equal(bytesToHex(hmacSha256(key, msg)), expected);
});

test('pbkdf2-hmac-sha256 cocok dengan vektor known (parity dengan hashlib Python)', () => {
  // Salt 'salt', password 'password', 1 iterasi -> RFC 6070 style untuk SHA-256.
  assert.equal(
    pbkdf2Sha256('password', '73616c74', 1, 32),
    '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'
  );
  // Vektor Python hashlib.pbkdf2_hmac('sha256', b'password', b'salt', 2, 32).
  assert.equal(
    pbkdf2Sha256('password', '73616c74', 2, 32),
    'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43'
  );
});

test('pbkdf2 menghasilkan panjang hex sesuai dkLen', () => {
  assert.equal(pbkdf2Sha256('uji-panjang', '00'.repeat(16), 10000, 32).length, 64);
  assert.equal(pbkdf2Sha256('uji-panjang', '00'.repeat(16), 10000, 16).length, 32);
});

test('hash bootstrap admin cocok dengan format pbkdf2 yang dipakai backend', () => {
  // Vektor known-answer dari Node crypto (bukan kredensial nyata).
  const knownAnswer =
    'pbkdf2$10000$a1b2c3d4e5f60718293a4b5c6d7e8f90$36c9fd9116d7cf3493c10fc60076156a07b8a9f93a265c9db4e58e2104d42133';
  const parts = knownAnswer.split('$');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'pbkdf2');
  const actual = pbkdf2Sha256('vektor-pbkdf2-uji', parts[2], Number(parts[1]), parts[3].length / 2);
  assert.equal(actual, parts[3]);
});

test('safeEquals membandingkan waktu konstan dan menolak panjang berbeda', () => {
  assert.equal(safeEquals('abc123', 'abc123'), true);
  assert.equal(safeEquals('abc123', 'abc124'), false);
  assert.equal(safeEquals('abc', 'abcd'), false);
});
