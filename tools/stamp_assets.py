#!/usr/bin/env python3
"""Stamp ?v=<hash> pada link aset di index.html & mbp.html.

Tujuan: browser tidak lagi memakai file lama dari cache setelah CSS/JS berubah.
Versi diambil dari hash isi file, jadi otomatis berubah begitu file berubah --
tidak perlu ingat menaikkan nomor versi manual.

Jalankan:  python tools/stamp_assets.py
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ['index.html', 'mbp.html']
# tangkap: prefix ("href=\"" atau "src=\""), path aset, suffix ("\")
ASSET_RE = re.compile(r'((?:href|src)=")(css/app\.css|js/[A-Za-z0-9._-]+\.js)\?v=[0-9a-f]*(")')


def file_hash(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        raise SystemExit(f'File tidak ditemukan: {rel}')
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def main() -> None:
    changed = False
    for page in PAGES:
        p = ROOT / page
        src = p.read_text(encoding='utf-8')

        def repl(m: re.Match) -> str:
            prefix, rel, suffix = m.group(1), m.group(2), m.group(3)
            return f'{prefix}{rel}?v={file_hash(rel)}{suffix}'

        out = ASSET_RE.sub(repl, src)
        if out != src:
            p.write_text(out, encoding='utf-8', newline='')
            changed = True
            print(f'  {page}: di-stamp')
        else:
            print(f'  {page}: tidak berubah')
    print('Selesai.' if changed else 'Semua versi sudah mutakhir.')


if __name__ == '__main__':
    main()
