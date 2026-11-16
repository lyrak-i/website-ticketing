#!/usr/bin/env python3
"""Buat hash kata sandi untuk kolom `passwordHash` di tab `Auth_Users`.

Format: pbkdf2$<ITER>$<SALT_HEX>$<HASH_HEX>  (PBKDF2-HMAC-SHA256)

Pakai:
    py -3 tools/hash_password.py "password-baru"   # hash untuk 1 password

Catatan: backend (apps-script/Auth.gs) sudah bisa membuat hash sendiri —
password cukup diketik di dashboard Admin lalu disimpan lewat aksi `setPassword`.
Alat ini cuma bantu kalau hash perlu dibuat di luar browser.
"""
import hashlib
import os
import sys

ITER = 10000


def make_hash(password: str, salt: bytes = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITER)
    return "pbkdf2$%d$%s$%s" % (ITER, salt.hex(), dk.hex())


def main() -> int:
    if len(sys.argv) < 2:
        print("Pakai: py -3 tools/hash_password.py \"password-baru\"")
        return 1
    print(make_hash(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
