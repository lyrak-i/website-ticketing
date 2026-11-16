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
    """Hash file dengan line ending dinormalisasi ke LF.

    Git menyimpan blob dengan LF (lihat .gitattributes), sementara checkout di
    Windows bisa mengubahnya jadi CRLF. Kalau hash dihitung dari byte mentah,
    ?v= tidak akan cocok dengan file yang benar-benar di-deploy. Jadi dinormalisasi
    dulu supaya hasilnya deterministik di semua platform.
    """
    path = ROOT / rel
    if not path.exists():
        raise SystemExit(f'File tidak ditemukan: {rel}')
    data = path.read_bytes().replace(b'\r\n', b'\n').replace(b'\r', b'\n')
    return hashlib.sha256(data).hexdigest()[:10]


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
            p.write_text(out, encoding='utf-8', newline='\n')
            changed = True
            print(f'  {page}: di-stamp')
        else:
            print(f'  {page}: tidak berubah')
    print('Selesai.' if changed else 'Semua versi sudah mutakhir.')


if __name__ == '__main__':
    main()
