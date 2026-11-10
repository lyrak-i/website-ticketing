#!/usr/bin/env python3
"""Buat hash kata sandi untuk users di apps-script/Code.gs dan js/demo-users.js.

Format: pbkdf2$<ITER>$<SALT_HEX>$<HASH_HEX>  (PBKDF2-HMAC-SHA256)

Pakai:
    py -3 tools/hash_password.py --all          # semua user default
    py -3 tools/hash_password.py omc kata-sandi  # hash untuk 1 user
"""
import hashlib
import os
import sys

ITER = 10000
USERS = [
    ("omc", "omc2026", "Operator OMC (Dispatcher)", "omc", ""),
    ("mbp01", "mbp2026", "MBP-01 (Tim Alpha)", "mbp", "MBP-01"),
    ("mbp02", "mbp2026", "MBP-02 (Tim Bravo)", "mbp", "MBP-02"),
    ("mbp03", "mbp2026", "MBP-03 (Tim Charlie)", "mbp", "MBP-03"),
    ("mbp04", "mbp2026", "MBP-04 (Tim Delta)", "mbp", "MBP-04"),
]


def make_hash(password: str, salt: bytes = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITER)
    return "pbkdf2$%d$%s$%s" % (ITER, salt.hex(), dk.hex())


def main() -> int:
    if len(sys.argv) == 1 or sys.argv[1] == "--all":
        for username, password, name, role, unit in USERS:
            print("%-8s %-26s %s" % (username, name, make_hash(password)))
        print("\nPassword default: OMC=omc2026, MBP=mbp2026 (ganti sebelum produksi)")
        return 0

    print(make_hash(sys.argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
