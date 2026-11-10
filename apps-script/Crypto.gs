/**
 * Kripto untuk Google Apps Script (runtime V8).
 *
 * Apps Script tidak menyediakan Web Crypto (crypto.subtle), dan bridge
 * Utilities.computeHmacSha256Signature terlalu lambat untuk PBKDF2
 * 100.000 iterasi (1 panggilan bridge per iterasi).
 * Jadi SHA-256 / HMAC / PBKDF2 diimplementasikan manual di sini.
 *
 * Format hash: pbkdf2$<ITER>$<SALT_HEX>$<HASH_HEX>
 */

// ---------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------
var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256(bytes) {
  var H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  var len = bytes.length;
  var bitLenHi = Math.floor(len / 0x20000000);
  var bitLenLo = (len * 8) >>> 0;
  var total = (((len + 9 + 63) / 64) | 0) * 64;

  var m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  m[total - 8] = (bitLenHi >>> 24) & 0xff;
  m[total - 7] = (bitLenHi >>> 16) & 0xff;
  m[total - 6] = (bitLenHi >>> 8) & 0xff;
  m[total - 5] = bitLenHi & 0xff;
  m[total - 4] = (bitLenLo >>> 24) & 0xff;
  m[total - 3] = (bitLenLo >>> 16) & 0xff;
  m[total - 2] = (bitLenLo >>> 8) & 0xff;
  m[total - 1] = bitLenLo & 0xff;

  var w = new Uint32Array(64);
  for (var off = 0; off < total; off += 64) {
    for (var i = 0; i < 16; i++) {
      w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) |
             (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
    }
    for (var t = 16; t < 64; t++) {
      var x = w[t - 15];
      var y = w[t - 2];
      var s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      var s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      var v = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      w[t] = v;
    }

    var a = H[0], b = H[1], c = H[2], d = H[3];
    var e = H[4], f = H[5], g = H[6], h = H[7];

    for (var k = 0; k < 64; k++) {
      var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var temp1 = (h + S1 + ch + SHA256_K[k] + w[k]) >>> 0;
      var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  var out = new Uint8Array(32);
  for (var j = 0; j < 8; j++) {
    out[j * 4] = (H[j] >>> 24) & 0xff;
    out[j * 4 + 1] = (H[j] >>> 16) & 0xff;
    out[j * 4 + 2] = (H[j] >>> 8) & 0xff;
    out[j * 4 + 3] = H[j] & 0xff;
  }
  return out;
}

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

// ---------------------------------------------------------------
// HMAC-SHA256 & PBKDF2
// ---------------------------------------------------------------
function hmacSha256(key, msg) {
  var BLOCK = 64;
  var k = key.length > BLOCK ? sha256(key) : key;
  var kp = new Uint8Array(BLOCK);
  kp.set(k);

  var ipad = new Uint8Array(BLOCK);
  var opad = new Uint8Array(BLOCK);
  for (var i = 0; i < BLOCK; i++) {
    ipad[i] = kp[i] ^ 0x36;
    opad[i] = kp[i] ^ 0x5c;
  }
  return sha256(concatBytes(opad, sha256(concatBytes(ipad, msg))));
}

/** PBKDF2-HMAC-SHA256, hasil dalam hex. */
function pbkdf2Sha256(password, saltHex, iterations, dkLen) {
  var salt = hexToBytes(saltHex);
  var key = utf8Bytes(password);
  var hLen = 32;
  var blocks = Math.ceil(dkLen / hLen);
  var out = new Uint8Array(dkLen);

  for (var i = 1; i <= blocks; i++) {
    var u = hmacSha256(key, concatBytes(salt, int32be(i)));
    var t = new Uint8Array(hLen);
    t.set(u);
    for (var c = 1; c < iterations; c++) {
      u = hmacSha256(key, u);
      for (var j = 0; j < hLen; j++) t[j] ^= u[j];
    }
    var offset = (i - 1) * hLen;
    var take = Math.min(hLen, dkLen - offset);
    for (var m = 0; m < take; m++) out[offset + m] = t[m];
  }
  return bytesToHex(out);
}

// ---------------------------------------------------------------
// Helper byte
// ---------------------------------------------------------------
function concatBytes(a, b) {
  var out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function int32be(n) {
  return new Uint8Array([
    (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff
  ]);
}

function utf8Bytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var c2 = str.charCodeAt(i + 1);
      var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(
        0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)
      );
      i++;
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function hexToBytes(hex) {
  var clean = String(hex).trim();
  var out = new Uint8Array(clean.length / 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  }
  return out;
}

/** Bandingkan dua string dengan waktu konstan (cegah timing attack). */
function safeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
