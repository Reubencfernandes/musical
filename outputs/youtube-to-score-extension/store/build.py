"""Builds the Chrome Web Store package of YouTube to Score.

The store does not accept extensions that download copyrighted media, so the store build leaves out
the optional yt-dlp helper (native/, the nativeMessaging permission and its code) and the MP3 download
of a capture. Recording a part with tab capture and turning it into sheet music stay.

Code that only the GitHub build keeps sits between store:strip-start and store:strip-end lines
(// in scripts, <!-- --> in pages); this script drops those lines and checks nothing is left over.

    python store/build.py [out.zip] [--dir unpacked-folder]
"""
import json
import os
import re
import sys
import zipfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {'native', 'store', '__pycache__'}
SKIP_FILES = {'README.md', 'PRIVACY.md'}
TEXT = ('.js', '.html', '.css', '.json')
# Words that must not reach the store package.
BANNED = ('store:strip', 'yt-dlp', 'yt_dlp', 'connectNative', 'nativeMessaging', 'download-mp3', 'Get audio now')


def strip(text, name):
    """Removes every store:strip-start ... store:strip-end block, marker lines included."""
    nl = '\r\n' if '\r\n' in text else '\n'
    out, depth = [], 0
    for n, line in enumerate(text.split(nl), 1):
        if 'store:strip-start' in line:
            if depth:
                raise SystemExit(f'{name}:{n}: nested store:strip-start')
            depth = 1
        elif 'store:strip-end' in line:
            if not depth:
                raise SystemExit(f'{name}:{n}: store:strip-end without a start')
            depth = 0
        elif not depth:
            out.append(line)
    if depth:
        raise SystemExit(f'{name}: store:strip-start is never closed')
    return nl.join(out)


def files():
    for root, dirs, names in os.walk(SRC):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith('.'))
        for name in sorted(names):
            if name in SKIP_FILES or name.startswith('.'):
                continue
            path = os.path.join(root, name)
            yield path, os.path.relpath(path, SRC).replace(os.sep, '/')


def build():
    out = {}
    for path, rel in files():
        data = open(path, 'rb').read()
        if rel == 'manifest.json':
            m = json.loads(data)
            m['permissions'] = [p for p in m['permissions'] if p != 'nativeMessaging']
            data = (json.dumps(m, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
        elif rel.endswith(TEXT):
            data = strip(data.decode('utf-8'), rel).encode('utf-8')
        if rel.endswith(TEXT):
            text = data.decode('utf-8')
            found = [w for w in BANNED if w in text]
            if found:
                raise SystemExit(f'{rel} still contains {found}')
        out[rel] = data
    # The pages' scripts must not look up the elements the store build removed.
    for page, script in (('popup.html', 'popup.js'), ('clip.html', 'clip.js')):
        ids = set(re.findall(r'id="([^"]+)"', out[page].decode('utf-8')))
        used = set(re.findall(r"\$\('([\w-]+)'\)", out[script].decode('utf-8')))
        missing = sorted(used - ids)
        if missing:
            print(f'note: {script} looks up ids not in {page} (may be created at run time): {missing}')
    return out


def main():
    args = sys.argv[1:]
    unpacked = None
    if '--dir' in args:
        i = args.index('--dir')
        unpacked = args[i + 1]
        del args[i:i + 2]
    zip_path = args[0] if args else 'kiku-youtube-to-score-store.zip'
    out = build()
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel, data in out.items():
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    if unpacked:
        for rel, data in out.items():
            dest = os.path.join(unpacked, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, 'wb').write(data)
    m = json.loads(out['manifest.json'])
    print(f"{m['name']} {m['version']} store build: {len(out)} files, permissions {m['permissions']} -> {zip_path}")


if __name__ == '__main__':
    main()
