"""Transformasi sekali-jadi: pecah index.html lama menjadi index.html + style.css + js/app.js.
Dijalankan sekali, lalu dihapus.
"""
import io
import os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "index.html")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

with io.open(SRC, encoding="utf-8") as f:
    lines = f.readlines()

# style.css = isi <style> (baris 22..27 pada file asli, index 21..26)
css = "".join(lines[21:27]).strip() + "\n"
with io.open(os.path.join(OUT, "style.css"), "w", encoding="utf-8", newline="\n") as f:
    f.write(css)

# js/app.js = isi <script> aplikasi (baris 459..1320), dedent 4 spasi
body = "".join(lines[458:1320]).rstrip() + "\n"
body = "\n".join(l[4:] if l.startswith("    ") else l for l in body.split("\n"))
os.makedirs(os.path.join(OUT, "js"), exist_ok=True)
with io.open(os.path.join(OUT, "js", "app.js"), "w", encoding="utf-8", newline="\n") as f:
    f.write(body)

# index.html baru: markup saja (head + body), tanpa <style> dan tanpa <script> aplikasi
head = "".join(lines[0:20])          # s/d penutup <script> tailwind.config
mid = "".join(lines[28:456])         # <body> .. </main> + modal konfigurasi
tail = """  <script src="js/config.js"></script>
  <script src="js/demo-users.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
"""

head = head.replace(
    """  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace']
          }
        }
      }
    };
  </script>
""",
    '  <script src="js/tailwind.config.js"></script>\n'
    '  <link rel="stylesheet" href="style.css">\n',
)
assert "tailwind.config.js" in head, "blok konfigurasi tailwind tidak ditemukan"

with io.open(os.path.join(OUT, "index.html"), "w", encoding="utf-8", newline="\n") as f:
    f.write(head + mid + tail)

print("style.css:", len(css), "byte")
print("js/app.js:", len(body), "byte")
print("index.html:", len(head + mid + tail), "byte")
