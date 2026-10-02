#!/usr/bin/env python3
"""Chemistry document scan: textbook reaction schemes → checked reaction records.

Every stage is checkpointed in one SQLite database, so a stopped or crashed run resumes where it
left off and nothing already read is sent to the vision model again.

  scan.py add <nodus_id> <pdf> [--title T]   detect schemes: crops on vector pages, whole page on raster pages (free)
  scan.py read [--books k,...] [--cap 100]   read pending schemes with Gemini Flash (paid; stops at the $ cap)
  scan.py check                              cross-check every molecule: SMILES vs formula vs name (OPSIN/PubChem)
  scan.py status                             counts, tokens, spend

Database: <userData>/chemistry-schemes/scan.sqlite (SCHEME_SCAN_DB overrides). Progress for the
side panel: CLAUDE-PROGRESS.json when SCHEME_SCAN_PROGRESS points at it. The Gemini key is read
from ~/.config/nodus-harness/keys.json ("gemini").

Detection reuses the declutter layout classifier (blocks.mjs → electron/extraction/schemeLayout.ts):
scheme text items are clustered, clusters sharing a vertical band are merged into one scheme row,
and each row is widened to the vector drawing paths that touch it (bonds extend past their atom
labels). A page whose raster images cover ≥ 15% of it (a scanned or image-based scheme) is read
whole instead. Records keep page, box and their order on the page (top to bottom), which matches
the order of the [scheme] markers in the decluttered text of that page.
"""
import base64, concurrent.futures as cf, datetime, hashlib, json, os, re, sqlite3, subprocess, sys, threading, time, urllib.parse
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get('SCHEME_SCAN_DB') or os.path.expanduser('~/Library/Application Support/Nodus/chemistry-schemes/scan.sqlite')
PROGRESS = os.environ.get('SCHEME_SCAN_PROGRESS')
MODEL = 'gemini-flash-latest'
PROMPT_VERSION = 'v2'
SECOND_OPINION = 'v2-med'  # Flash, thinking medium, on crops with a flagged record (pilot: +52% confirmed molecules)
# $ per 1M tokens (Gemini 3.8 Flash, standard, through 2026-12-31; ai.google.dev pricing checked 2026-10-01)
PRICE = {'gemini-flash-latest': (0.75, 3.75), 'gemini-pro-latest': (2.0, 12.0), 'gemini-3.1-pro-preview': (2.0, 12.0)}
RASTER_SHARE = 0.15
CROP_SCALE, PAGE_SCALE = 3, 2

PROMPT = """You are reading a reaction scheme from an organic chemistry textbook. Extract every reaction arrow you can see as a separate record.

For each arrow:
- reactants: the structures/compounds on the left of the arrow, as SMILES. Transcribe ALL drawn stereochemistry (wedges, hashes, E/Z) into the SMILES.
- products: the structures on the right, as SMILES, with all drawn stereochemistry.
- reagents: everything written above/below the arrow (reagents, catalysts, solvents, temperature, numbered sequential steps), as written in plain text.
- yield: as written (e.g. "87%", "70%, 97.6 ds"), or null.
- molecules: for EVERY reactant and product structure, an object {"smiles": "...", "name": "...", "formula": "..."} with its systematic or common name (as specific as you can; null only if it cannot be named) and its molecular formula (Hill order, e.g. C9H11NO2). These are used to cross-check your SMILES, so derive them independently from the drawing.
- confidence: "high", "medium" or "low" for the whole record.
For a structure you cannot read reliably, write "UNREADABLE" rather than guessing. For a generic group (R, Ar, PG, X) use the SMILES wildcard [*] and give the formula without it.
Skip transition-state drawings, mechanisms (curved arrows) and equilibria between resonance forms: they are not synthetic steps. If there is no synthetic reaction arrow, return an empty list.

Reply with JSON only: {"reactions": [{"reactants": [...], "reagents": "...", "products": [...], "yield": null, "molecules": [], "confidence": "high"}]}"""

# v3: v2 plus the arrow type. Retrosynthesis books (Warren) draw target => precursors with an open
# double arrow; read as forward reactions those records are reversed.
PROMPT_V3 = PROMPT.replace('- confidence: "high"', '- arrow: "forward" for a reaction arrow (starting materials -> product), "retrosynthetic" for a retrosynthesis arrow (an open double-line arrow, target => precursors or synthons, often labelled with the bond disconnected, "FGI" or similar). Always list the molecules as drawn: reactants = left of the arrow, products = right.\n- confidence: "high"').replace(
    '"molecules": [], "confidence": "high"}]}', '"molecules": [], "arrow": "forward", "confidence": "high"}]}')
PROMPTS = {'v2': PROMPT, 'v2-med': PROMPT, 'v2-high': PROMPT, 'v2-pro': PROMPT, 'v3': PROMPT_V3}
# Labels that mark a retrosynthesis arrow where a reaction arrow would carry reagents.
RETRO_LABEL = re.compile(r'(⇒|=>|\bFG[IA]\b|disconnect|synthon|^\s*C\s*[-–—]\s*(?:C|N|O|S|X|Hal|Br|Cl|I|Si|P)\b)', re.I | re.M)

SCHEMA = """
CREATE TABLE IF NOT EXISTS books(book_key TEXT PRIMARY KEY, nodus_id TEXT, title TEXT, path TEXT, pages INTEGER, body REAL, detected_at TEXT);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, book_key TEXT, page INTEGER, kind TEXT, x0 REAL, y0 REAL, x1 REAL, y1 REAL, ordinal INTEGER,
  UNIQUE(book_key, page, kind, ordinal));
CREATE TABLE IF NOT EXISTS readings(item_id INTEGER, model TEXT, prompt_version TEXT, json TEXT, input_tokens INTEGER, output_tokens INTEGER, error TEXT, created_at TEXT,
  PRIMARY KEY(item_id, model, prompt_version));
CREATE TABLE IF NOT EXISTS names(name TEXT PRIMARY KEY, smiles TEXT, source TEXT);
CREATE TABLE IF NOT EXISTS records(item_id INTEGER, n INTEGER, reactants TEXT, reagents TEXT, products TEXT, yield TEXT, molecules TEXT,
  status TEXT, checks TEXT, PRIMARY KEY(item_id, n));
"""


def connect():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    con = sqlite3.connect(DB, timeout=300, check_same_thread=False)
    con.execute('PRAGMA journal_mode=WAL')
    con.executescript(SCHEMA)
    if 'ref' not in [r[1] for r in con.execute('PRAGMA table_info(items)')]:
        con.execute('ALTER TABLE items ADD COLUMN ref TEXT')  # EPUB: the image's path inside the archive
    if 'source' not in [r[1] for r in con.execute('PRAGMA table_info(records)')]:
        con.execute("ALTER TABLE records ADD COLUMN source TEXT DEFAULT 'v2'")  # which reading a record came from
    return con


def file_sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 22), b''):
            h.update(block)
    return h.hexdigest()


def progress(title, done, total, detail, state='running'):
    if not PROGRESS:
        return
    try:
        jobs = json.load(open(PROGRESS)).get('jobs', [])
    except (OSError, ValueError):
        jobs = []
    jobs = [j for j in jobs if j.get('title') != title]
    jobs.append({'title': title, 'done': done, 'total': total, 'detail': detail, 'state': state,
                 'updated': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    tmp = PROGRESS + '.tmp'
    json.dump({'jobs': jobs}, open(tmp, 'w'), indent=2)
    os.replace(tmp, PROGRESS)


# ── detect ──────────────────────────────────────────────────────────────────────────────────
def merge_rows(blocks, body):
    rows = []
    for b in sorted(blocks, key=lambda b: -b['y1']):
        for r in rows:
            if min(r['y1'], b['y1']) - max(r['y0'], b['y0']) > -body * 1.5:
                r.update(x0=min(r['x0'], b['x0']), y0=min(r['y0'], b['y0']), x1=max(r['x1'], b['x1']), y1=max(r['y1'], b['y1']), n=r['n'] + b['n'])
                break
        else:
            rows.append(dict(b))
    return rows


def add_book(nodus_id, pdf, title=None):
    import pypdfium2 as pdfium, pypdfium2.raw as raw
    con = connect()
    key = file_sha(pdf)
    if con.execute('SELECT detected_at FROM books WHERE book_key=?', (key,)).fetchone():
        print(f'already detected: {title or pdf}'); return
    doc = pdfium.PdfDocument(pdf)
    total = len(doc)
    proc = subprocess.Popen(['node', os.path.join(HERE, 'blocks.mjs'), pdf], stdout=subprocess.PIPE, text=True)
    pages = crops = 0
    body = 10
    for line in proc.stdout:
        info = json.loads(line)
        p, body = info['page'], info['body']
        page = doc[p - 1]
        w, h = page.get_width(), page.get_height()
        paths, raster = [], 0.0
        for obj in page.get_objects():
            l, b, r, t = obj.get_bounds()
            if obj.type == raw.FPDF_PAGEOBJ_IMAGE:
                raster += max(0, r - l) * max(0, t - b)
            elif obj.type == raw.FPDF_PAGEOBJ_PATH and (r - l) < w * 0.9 and (t - b) < h * 0.9:
                paths.append((l, b, r, t))
        rows = []
        if raster / (w * h) >= RASTER_SHARE:
            rows = [{'kind': 'page', 'x0': 0, 'y0': 0, 'x1': w, 'y1': h}]
        else:
            for r in merge_rows(merge_rows(info['blocks'], body), body):
                x0, y0, x1, y1 = r['x0'] - 25, r['y0'] - 25, r['x1'] + 25, r['y1'] + 25
                for (l, b, rr, t) in paths:
                    if l < x1 and rr > x0 and b < y1 and t > y0:
                        x0, y0, x1, y1 = min(x0, l - 4), min(y0, b - 4), max(x1, rr + 4), max(y1, t + 4)
                rows.append({'kind': 'crop', 'x0': max(0, x0), 'y0': max(0, y0), 'x1': min(w, x1), 'y1': min(h, y1)})
        for ordinal, r in enumerate(sorted(rows, key=lambda r: -r['y1'])):
            con.execute('INSERT OR IGNORE INTO items(book_key,page,kind,x0,y0,x1,y1,ordinal) VALUES(?,?,?,?,?,?,?,?)',
                        (key, p, r['kind'], r['x0'], r['y0'], r['x1'], r['y1'], ordinal))
            crops += 1
        pages += 1
        con.commit()
        if pages % 25 == 0:
            progress('Scheme scan: detect', pages, total, f'{title or os.path.basename(pdf)} · {crops} schemes so far')
    proc.wait()
    con.execute('INSERT OR REPLACE INTO books VALUES(?,?,?,?,?,?,?)', (key, nodus_id, title, pdf, total, body, datetime.datetime.now().isoformat()))
    con.commit()
    progress('Scheme scan: detect', total, total, f'{title or os.path.basename(pdf)} · {crops} schemes', 'done')
    print(f'{title or pdf}: {pages} pages, {crops} schemes')


def drawing_clusters(page, body, min_paths=12):
    """Regions of a page dense in small vector paths (bonds, arrows): structures whose few text labels
    the layout classifier does not flag. Paths within 2.5 x body of each other join one cluster."""
    import pypdfium2.raw as raw
    w, h = page.get_width(), page.get_height()
    boxes = []
    for obj in page.get_objects():
        if obj.type != raw.FPDF_PAGEOBJ_PATH:
            continue
        l, b, r, t = obj.get_bounds()
        if l < 0 or b < 0 or r > w or t > h:
            continue  # crop marks and bleed outside the page
        if max(r - l, t - b) < min(150, w * 0.3):
            boxes.append([l, b, r, t, 1])
    gap = body * 2.5
    merged = True
    while merged:
        merged, out = False, []
        for bx in boxes:
            for o in out:
                if bx[0] < o[2] + gap and bx[2] > o[0] - gap and bx[1] < o[3] + gap and bx[3] > o[1] - gap:
                    o[0], o[1], o[2], o[3], o[4] = min(o[0], bx[0]), min(o[1], bx[1]), max(o[2], bx[2]), max(o[3], bx[3]), o[4] + bx[4]
                    merged = True
                    break
            else:
                out.append(bx)
        boxes = out
    return [b for b in boxes if b[4] >= min_paths and (b[2] - b[0]) > body * 3 and (b[3] - b[1]) > body * 2]


def supplement(only=None):
    """Add crops for drawing clusters that no existing item covers (vector pages only). Existing items
    and their readings are untouched; new items get ordinals from 100 up."""
    import pypdfium2 as pdfium
    con = connect()
    for key, title, path, body in con.execute('SELECT book_key, title, path, body FROM books').fetchall():
        if only and title not in only or not path.lower().endswith('.pdf'):
            continue
        doc, added = pdfium.PdfDocument(path), 0
        for p in range(1, len(doc) + 1):
            have = con.execute('SELECT kind, x0, y0, x1, y1, ordinal FROM items WHERE book_key=? AND page=?', (key, p)).fetchall()
            if any(k == 'page' for k, *_ in have):
                continue
            page = doc[p - 1]
            w, h = page.get_width(), page.get_height()
            ordinal = max([o for *_, o in have if o >= 100], default=99) + 1
            pad_x, pad_y = 18, (body or 10) * 2.2  # reagents sit a line or two above/below the arrow
            clusters = [{'x0': l - pad_x, 'y0': b - pad_y, 'x1': r + pad_x, 'y1': t + pad_y, 'n': n} for (l, b, r, t, n) in drawing_clusters(page, body or 10)]
            for c in merge_rows(merge_rows(clusters, body or 10), body or 10):
                x0, y0, x1, y1 = max(0, c['x0']), max(0, c['y0']), min(w, c['x1']), min(h, c['y1'])
                if x1 - x0 < 30 or y1 - y0 < 20:
                    continue
                inside = sum(max(0, min(x1, X1) - max(x0, X0)) * max(0, min(y1, Y1) - max(y0, Y0)) for _, X0, Y0, X1, Y1, _ in have)
                if inside > 0.5 * (x1 - x0) * (y1 - y0):
                    continue
                con.execute('INSERT OR IGNORE INTO items(book_key,page,kind,x0,y0,x1,y1,ordinal) VALUES(?,?,?,?,?,?,?,?)',
                            (key, p, 'crop', max(0, x0), max(0, y0), min(w, x1), min(h, y1), ordinal))
                ordinal += 1; added += 1
            con.commit()
        print(f'{title}: +{added} drawing crops', flush=True)


def add_epub(nodus_id, epub, title=None, min_w=120, min_h=40):
    """An EPUB's schemes are its images: one item per image (kind 'image'), in reading order.
    page = the chapter's position in the spine, ordinal = the image's order within that chapter."""
    import posixpath, re, zipfile, io
    from PIL import Image
    con = connect()
    key = file_sha(epub)
    if con.execute('SELECT 1 FROM books WHERE book_key=?', (key,)).fetchone():
        print(f'already added: {title or epub}'); return
    z = zipfile.ZipFile(epub)
    opf = re.search(r'full-path="([^"]+)"', z.read('META-INF/container.xml').decode()).group(1)
    opf_xml, base = z.read(opf).decode('utf-8', 'replace'), posixpath.dirname(opf)
    manifest = {m.group(1): m.group(2) for m in re.finditer(r'<item\b[^>]*?id="([^"]+)"[^>]*?href="([^"]+)"', opf_xml)}
    manifest.update({m.group(2): m.group(1) for m in re.finditer(r'<item\b[^>]*?href="([^"]+)"[^>]*?id="([^"]+)"', opf_xml)})
    spine = [manifest[i] for i in re.findall(r'<itemref\b[^>]*idref="([^"]+)"', opf_xml) if i in manifest]
    n = 0
    for chapter, href in enumerate(spine, 1):
        doc_path = posixpath.normpath(posixpath.join(base, urllib.parse.unquote(href)))
        html = z.read(doc_path).decode('utf-8', 'replace')
        ordinal = 0
        for src in re.findall(r'<img\b[^>]*?src="([^"]+)"', html):
            member = posixpath.normpath(posixpath.join(posixpath.dirname(doc_path), urllib.parse.unquote(src)))
            try:
                w, h = Image.open(io.BytesIO(z.read(member))).size
            except (KeyError, OSError):
                continue
            if w < min_w or h < min_h:
                continue  # icons, inline glyphs
            con.execute('INSERT OR IGNORE INTO items(book_key,page,kind,x0,y0,x1,y1,ordinal,ref) VALUES(?,?,?,?,?,?,?,?,?)',
                        (key, chapter, 'image', 0, 0, w, h, ordinal, member))
            ordinal += 1; n += 1
    con.execute('INSERT OR REPLACE INTO books VALUES(?,?,?,?,?,?,?)', (key, nodus_id, title, epub, len(spine), None, datetime.datetime.now().isoformat()))
    con.commit()
    print(f'{title or epub}: {len(spine)} chapters, {n} images')


# ── read ────────────────────────────────────────────────────────────────────────────────────
RENDER_LOCK = threading.Lock()  # pdfium is not thread-safe


def render(item):
    if item[3] == 'image':
        return _epub_image(item)
    with RENDER_LOCK:
        return _render(item)


def _epub_image(item):
    import io, zipfile
    from PIL import Image
    path = connect().execute('SELECT path FROM books WHERE book_key=?', (item[1],)).fetchone()[0]
    img = Image.open(io.BytesIO(zipfile.ZipFile(path).read(item[9]))).convert('RGB')
    if img.width < 900:  # small EPUB images: upscale so subscripts and wedges stay legible
        f = 900 / img.width
        img = img.resize((900, int(img.height * f)), Image.LANCZOS)
    buf = io.BytesIO(); img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


def _render(item):
    """Called under RENDER_LOCK. Every pdfium object is closed here, inside the lock: one freed by the
    garbage collector on another thread while a page renders crashes pdfium (SIGSEGV in ~CPDF_Page)."""
    import io, pypdfium2 as pdfium
    _, book_key, page_no, kind, x0, y0, x1, y1, _ = item[:9]
    path = connect().execute('SELECT path FROM books WHERE book_key=?', (book_key,)).fetchone()[0]
    doc = pdfium.PdfDocument(path)
    page = bitmap = None
    try:
        page = doc[page_no - 1]
        w, h = page.get_width(), page.get_height()
        bitmap = page.render(scale=PAGE_SCALE) if kind == 'page' else page.render(scale=CROP_SCALE, crop=(x0, y0, w - x1, h - y1))
        buf = io.BytesIO(); bitmap.to_pil().copy().save(buf, format='PNG')
        return base64.b64encode(buf.getvalue()).decode()
    finally:
        for obj in (bitmap, page, doc):
            if obj is not None:
                obj.close()


def parse_reply(text):
    decoder, reactions, at = json.JSONDecoder(), [], 0
    text = text.strip()
    while at < len(text):
        starts = [i for i in (text.find('{', at), text.find('[', at)) if i >= 0]
        if not starts:
            break
        try:
            value, end = decoder.raw_decode(text, min(starts))
        except json.JSONDecodeError:
            at = min(starts) + 1; continue
        if isinstance(value, dict):
            reactions += value.get('reactions', [value] if 'reactants' in value else [])
        elif isinstance(value, list):
            reactions += [v for v in value if isinstance(v, dict) and 'reactants' in v]
        at = end
    return reactions


def gemini(image_b64, key, model=None, thinking='low', prompt=None):
    body = {'contents': [{'parts': [{'inline_data': {'mime_type': 'image/png', 'data': image_b64}}, {'text': prompt or PROMPT}]}],
            'generationConfig': {'temperature': 0, 'responseMimeType': 'application/json', 'maxOutputTokens': 32000, 'thinkingConfig': {'thinkingLevel': thinking}}}
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model or MODEL}:generateContent?key={key}'
    for attempt in range(6):
        try:
            r = requests.post(url, json=body, timeout=300)
        except requests.RequestException:
            time.sleep(10 * (attempt + 1)); continue
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(min(120, 15 * 2 ** attempt)); continue
        if not r.ok:
            raise RuntimeError(f'{r.status_code} {r.text[:300]}')
        out = r.json()
        parts = out.get('candidates', [{}])[0].get('content', {}).get('parts', [])
        text = ''.join(p.get('text', '') for p in parts)
        meta = out.get('usageMetadata', {})
        return parse_reply(text), meta.get('promptTokenCount', 0), meta.get('candidatesTokenCount', 0) + meta.get('thoughtsTokenCount', 0)
    raise RuntimeError('Gemini kept failing')


def spent(con):
    rows = con.execute('SELECT model, sum(input_tokens), sum(output_tokens) FROM readings GROUP BY model').fetchall()
    return sum((i or 0) / 1e6 * PRICE.get(m, (0.75, 3.75))[0] + (o or 0) / 1e6 * PRICE.get(m, (0.75, 3.75))[1] for m, i, o in rows)


def read(books=None, cap=100.0, workers=6):
    con = connect()
    key = json.load(open(os.path.expanduser('~/.config/nodus-harness/keys.json')))['gemini']
    where = ' AND i.book_key IN (SELECT book_key FROM books WHERE nodus_id IN (%s))' % ','.join('?' * len(books)) if books else ''
    pending = con.execute(f"""SELECT i.* FROM items i LEFT JOIN readings r ON r.item_id=i.id AND r.model=? AND r.prompt_version=? AND r.error IS NULL
      WHERE r.item_id IS NULL{where} ORDER BY (SELECT rowid FROM books b WHERE b.book_key=i.book_key), i.page, i.ordinal""", (MODEL, PROMPT_VERSION, *(books or []))).fetchall()
    total_items = con.execute('SELECT count(*) FROM items').fetchone()[0]
    done = total_items - len(pending)
    lock, stop = threading.Lock(), threading.Event()
    print(f'{len(pending)} schemes to read; spent so far ${spent(con):.2f} of ${cap:.2f}', flush=True)

    def one(item):
        if stop.is_set():
            return
        try:
            reactions, tin, tout = gemini(render(item), key)
            row = (item[0], MODEL, PROMPT_VERSION, json.dumps({'reactions': reactions}), tin, tout, None, datetime.datetime.now().isoformat())
        except Exception as error:
            row = (item[0], MODEL, PROMPT_VERSION, None, 0, 0, str(error)[:300], datetime.datetime.now().isoformat())
        with lock:
            con.execute('INSERT OR REPLACE INTO readings VALUES(?,?,?,?,?,?,?,?)', row)
            con.commit()

    with cf.ThreadPoolExecutor(workers) as pool:
        futures = [pool.submit(one, item) for item in pending]
        for n, _ in enumerate(cf.as_completed(futures), 1):
            if n % 10 == 0 or n == len(futures):
                with lock:
                    cost = spent(con)
                errors = con.execute('SELECT count(*) FROM readings WHERE error IS NOT NULL').fetchone()[0]
                progress('Scheme scan: read', done + n, total_items, f'${cost:.2f} of ${cap:.0f} cap · {errors} errors (retried next run)')
                if cost >= cap and not stop.is_set():
                    stop.set()
                    print(f'spend cap ${cap:.2f} reached; stopping (resume later)', flush=True)
    cost = spent(con)
    left = con.execute(f"""SELECT count(*) FROM items i LEFT JOIN readings r ON r.item_id=i.id AND r.model=? AND r.prompt_version=? AND r.error IS NULL WHERE r.item_id IS NULL""", (MODEL, PROMPT_VERSION)).fetchone()[0]
    progress('Scheme scan: read', total_items - left, total_items, f'${cost:.2f} spent · {left} left', 'done' if not left else 'waiting')
    print(f'done; ${cost:.2f} spent; {left} schemes left', flush=True)


def recheck(model, thinking, tag, limit=None, cap=50.0, workers=8, total_cap=185.0, books=None, every=False):
    """Second opinion on crops whose first reading has a flagged record: read again with `model` at
    `thinking` and store it under prompt_version `tag` (the first reading is kept). Spend counts only
    this tag's tokens against `cap`."""
    con = connect()
    key = json.load(open(os.path.expanduser('~/.config/nodus-harness/keys.json')))['gemini']
    rows = con.execute(f"""SELECT DISTINCT i.* FROM items i {'' if every else "JOIN records x ON x.item_id=i.id AND x.status='flagged' AND x.source='v2'"}
      WHERE NOT EXISTS (SELECT 1 FROM readings r WHERE r.item_id=i.id AND r.model=? AND r.prompt_version=? AND r.error IS NULL)
      {' AND i.book_key IN (SELECT book_key FROM books WHERE nodus_id IN (%s))' % ','.join('?' * len(books)) if books else ''}
      ORDER BY (SELECT rowid FROM books b WHERE b.book_key=i.book_key), i.page, i.ordinal""", (model, tag, *(books or []))).fetchall()
    if limit:
        import random
        random.Random(7).shuffle(rows); rows = rows[:limit]
    price = PRICE.get(model, (2.0, 12.0))
    tag_cost = lambda: (lambda t: (t[0] or 0) / 1e6 * price[0] + (t[1] or 0) / 1e6 * price[1])(
        con.execute('SELECT sum(input_tokens), sum(output_tokens) FROM readings WHERE model=? AND prompt_version=?', (model, tag)).fetchone())
    lock, stop = threading.Lock(), threading.Event()
    print(f'{len(rows)} flagged crops to re-read with {model} ({thinking}); ${tag_cost():.2f} spent on {tag} so far', flush=True)

    def one(item):
        if stop.is_set():
            return
        try:
            reactions, tin, tout = gemini(render(item), key, model, thinking, PROMPTS.get(tag, PROMPT))
            row = (item[0], model, tag, json.dumps({'reactions': reactions}), tin, tout, None, datetime.datetime.now().isoformat())
        except Exception as error:
            row = (item[0], model, tag, None, 0, 0, str(error)[:300], datetime.datetime.now().isoformat())
        with lock:
            con.execute('INSERT OR REPLACE INTO readings VALUES(?,?,?,?,?,?,?,?)', row); con.commit()
            if tag_cost() >= cap or spent(con) >= total_cap:
                stop.set()

    with cf.ThreadPoolExecutor(workers) as pool:
        for n, _ in enumerate(cf.as_completed([pool.submit(one, r) for r in rows]), 1):
            if n % 10 == 0 or n == len(rows):
                progress(f'Scheme scan: second opinion ({tag})', n, len(rows), f'${tag_cost():.2f} of ${cap:.0f}')
    print(f'done; ${tag_cost():.2f} spent on {tag}', flush=True)


# ── check ───────────────────────────────────────────────────────────────────────────────────
ELEMENTS = set("""H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru
Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U
Np Pu Am Cm Bk Cf Es Fm Md No Lr c n o s p se as b""".split()) - {'Ar'}  # [Ar] in a scheme is aryl, not argon


def generic_to_wildcard(smiles):
    """Placeholders written as atoms ([R'], [E+], [M], [Z], [Nu], [Ar], [PG]) become the wildcard [*]."""
    import re
    def fix(m):
        sym = re.match(r'\d*([A-Za-z][a-z]?)', m.group(1))
        inner = re.sub(r'^\d+', '', m.group(1))
        ok = sym and sym.group(1) in ELEMENTS and re.fullmatch(r'[A-Za-z][a-z]?(@{1,2})?(H\d*)?([+-]\d*|[+-]+)?(:\d+)?', inner)
        return m.group(0) if ok else '[*]'
    return re.sub(r'\[([^\]]+)\]', fix, smiles)


def strip_charge(formula):
    import re
    return re.sub(r'[+-]\d*$', '', (formula or '').replace(' ', ''))


def resolve_names(con, names, workers=8):
    """Name -> SMILES for every name not cached yet: OPSIN first (systematic names), then PubChem
    (common and trade names; kept under its 5 requests/second limit). Results, misses included,
    are cached in the names table."""
    todo = [n for n in names if n and not con.execute('SELECT 1 FROM names WHERE name=?', (n,)).fetchone()]
    pace, last = threading.Lock(), [0.0]

    def pubchem(name):
        with pace:
            wait = last[0] + 0.25 - time.time()
            if wait > 0:
                time.sleep(wait)
            last[0] = time.time()
        r = requests.get(f'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{urllib.parse.quote(name, safe="")}/property/IsomericSMILES/TXT', timeout=20)
        return r.text.strip().splitlines()[0] if r.ok and r.text.strip() else None

    def one(name):
        for attempt in range(3):
            try:
                r = requests.get(f'https://www.ebi.ac.uk/opsin/ws/{urllib.parse.quote(name, safe="")}.smi', timeout=20)
                if r.ok and r.text.strip():
                    return name, r.text.strip(), 'opsin'
                found = pubchem(name)
                return name, found, 'pubchem' if found else None
            except requests.RequestException:
                time.sleep(5 * (attempt + 1))
        return name, None, 'error'

    with cf.ThreadPoolExecutor(workers) as pool:
        for k, (name, smiles, source) in enumerate(pool.map(one, todo), 1):
            if source != 'error':  # network failures are retried on the next run
                con.execute('INSERT OR REPLACE INTO names VALUES(?,?,?)', (name, smiles, source))
                con.commit()  # one row per transaction: never hold the write lock across network waits (it stalls the read)
            if k % 50 == 0 or k == len(todo):
                progress('Scheme scan: check', k, len(todo), 'resolving molecule names (OPSIN, PubChem)')


def check(redo=False):
    from rdkit import Chem, RDLogger
    from rdkit.Chem.rdMolDescriptors import CalcMolFormula
    RDLogger.DisableLog('rdApp.*')
    con = connect()
    if redo:
        con.execute('DELETE FROM records'); con.commit()
    # Crops without records, plus crops with a second-opinion reading (re-merged every run; cheap, names are cached).
    item_ids = [r[0] for r in con.execute("""SELECT DISTINCT r.item_id FROM readings r WHERE r.error IS NULL AND r.model=? AND
      ((r.prompt_version IN (?, 'v3') AND NOT EXISTS (SELECT 1 FROM records x WHERE x.item_id=r.item_id AND x.source=r.prompt_version))
       OR r.prompt_version=?)""", (MODEL, PROMPT_VERSION, SECOND_OPINION))]
    as_list = lambda v: v if isinstance(v, list) else [v] if v else []  # a reply occasionally gives one string
    parsed = []
    for item_id in item_ids:
        versions = []
        # The primary reading is v3 where one exists (it says which arrows are retrosynthetic), else v2.
        found = dict(con.execute("SELECT prompt_version, json FROM readings WHERE item_id=? AND model=? AND error IS NULL AND prompt_version IN (?,?,'v3')",
                                 (item_id, MODEL, PROMPT_VERSION, SECOND_OPINION)).fetchall())
        primary = 'v3' if 'v3' in found else PROMPT_VERSION
        for version, payload in [(v, found[v]) for v in (primary, SECOND_OPINION) if v in found]:
            reactions = [x for x in json.loads(payload)['reactions'] if isinstance(x, dict)]
            for x in reactions:
                x['reactants'], x['products'] = as_list(x.get('reactants')), as_list(x.get('products'))
                x['molecules'] = [m for m in as_list(x.get('molecules')) if isinstance(m, dict)]
            versions.append((version, reactions))
        parsed.append((item_id, versions))
    rs_all = [x for _, vs in parsed for _, rs in vs for x in rs]
    resolve_names(con, sorted({m.get('name') for x in rs_all for m in x['molecules'] if isinstance(m.get('name'), str)}))
    names = dict(con.execute('SELECT name, smiles FROM names').fetchall())

    def skeleton(s):
        m = Chem.MolFromSmiles(s) if s else None
        return Chem.MolToInchiKey(m).split('-')[0] if m else None

    def grade(x):
        checks, conflict, confirmed, generic = [], False, 0, False
        for m in x['molecules']:
            s, name, formula = m.get('smiles'), m.get('name'), strip_charge(m.get('formula'))
            s = generic_to_wildcard(s) if isinstance(s, str) else None
            if not s or s == 'UNREADABLE' or '*' in s:
                generic = True; checks.append({'smiles': s, 'result': 'generic'}); continue
            mol = Chem.MolFromSmiles(s)
            if mol is None:
                conflict = True; checks.append({'smiles': s, 'result': 'invalid'}); continue
            real = strip_charge(CalcMolFormula(mol))
            formula_ok = (formula == real) if formula else None
            resolved = names.get(name) if isinstance(name, str) else None
            name_ok = (skeleton(resolved) == skeleton(s)) if resolved else None
            # The resolved name is independent evidence; the model's own formula count is weak evidence.
            # Name = SMILES -> confirmed even when the formula was miscounted. Name and formula agreeing
            # against the SMILES (2 vs 1) means the SMILES is the wrong one: flag it, suggest the name's structure.
            suggestion = None
            if name_ok:
                result = 'confirmed'
            elif name_ok is False:
                name_mol = Chem.MolFromSmiles(resolved)
                name_formula = strip_charge(CalcMolFormula(name_mol)) if name_mol else None
                result = 'conflict'
                if formula and formula == name_formula and formula_ok is False:
                    suggestion = resolved
            else:
                result = 'conflict' if formula_ok is False else 'formula' if formula_ok else 'unchecked'
            conflict |= result == 'conflict'; confirmed += result == 'confirmed'
            checks.append({'smiles': s, 'name': name, 'formula': formula, 'real': real, 'resolved': resolved, 'result': result,
                           **({'suggested': suggestion, 'why': 'name and formula agree, SMILES differs'} if suggestion else {})})
        structures = [generic_to_wildcard(s) for s in x['reactants'] + x['products'] if isinstance(s, str)]
        readable = bool(structures) and all(s != 'UNREADABLE' and Chem.MolFromSmiles(s) is not None for s in structures)
        # Repaired: every conflict has a name+formula structure to replace the SMILES with (2 vs 1), and
        # nothing else is wrong. The original SMILES stay in reactants/products; checks[].suggested has the fix.
        repairable = conflict and all(c.get('suggested') for c in checks if c['result'] in ('conflict', 'invalid'))
        status = ('repaired' if repairable and readable else 'flagged') if conflict or not readable else 'generic' if generic else 'confirmed' if confirmed else 'unchecked'
        # A retrosynthesis arrow (target => precursors) is not a forward reaction: kept, never indexed.
        arrow = x.get('arrow') if isinstance(x.get('arrow'), str) else ''
        if arrow.lower().startswith('retro') or (isinstance(x.get('reagents'), str) and RETRO_LABEL.search(x['reagents'])):
            status = 'retro'
        return status, checks

    def products_key(x):
        keys = [skeleton(generic_to_wildcard(p)) for p in x['products'] if isinstance(p, str) and '*' not in generic_to_wildcard(p)]
        return tuple(sorted(k for k in keys if k)) or None

    verified = ('confirmed', 'repaired')
    for k, (item_id, versions) in enumerate(parsed, 1):
        # First reading's records, then a second opinion's verified reactions: one that matches a flagged
        # first-reading reaction (same products) supersedes it; one that matches nothing is added.
        rows = []
        for version, reactions in versions:
            for x in reactions:
                status, checks = grade(x)
                key = products_key(x)
                if version != SECOND_OPINION:
                    rows.append([x, status, checks, version, key]); continue
                if status not in verified:
                    continue
                same = [r for r in rows if key and r[4] == key and r[3] != SECOND_OPINION]
                if any(r[1] in verified for r in same):
                    continue
                for r in same:
                    r[1] = 'superseded'
                rows.append([x, status, checks, version, key])
        con.execute('DELETE FROM records WHERE item_id=?', (item_id,))
        for n, (x, status, checks, version, _) in enumerate(rows):
            con.execute('INSERT INTO records(item_id,n,reactants,reagents,products,yield,molecules,status,checks,source) VALUES(?,?,?,?,?,?,?,?,?,?)',
                        (item_id, n, json.dumps(x['reactants']), x.get('reagents') if isinstance(x.get('reagents'), str) else json.dumps(x.get('reagents')),
                         json.dumps(x['products']), x.get('yield') if isinstance(x.get('yield'), (str, type(None))) else str(x.get('yield')),
                         json.dumps(x['molecules']), status, json.dumps(checks), version))
        con.commit()  # short write transactions: the read commits every reply and must not wait
        if k % 200 == 0 or k == len(parsed):
            progress('Scheme scan: check', k, len(parsed), 'cross-checking SMILES vs formula vs name')
    con.commit()
    print(f'checked {len(parsed)} readings')


def status():
    con = connect()
    for row in con.execute("""SELECT b.title, count(DISTINCT i.id), sum(i.kind='page'), count(DISTINCT r.item_id)
      FROM books b JOIN items i ON i.book_key=b.book_key LEFT JOIN readings r ON r.item_id=i.id AND r.error IS NULL GROUP BY b.book_key"""):
        print(f'{(row[0] or "?")[:44]:44} schemes {row[1]:6}  whole pages {row[2] or 0:5}  read {row[3]:6}')
    tok = con.execute('SELECT sum(input_tokens), sum(output_tokens), sum(error IS NOT NULL) FROM readings').fetchone()
    print(f'tokens {tok[0] or 0:,} in / {tok[1] or 0:,} out · errors {tok[2] or 0} · spent ${spent(con):.2f}')
    for s, c in con.execute('SELECT status, count(*) FROM records GROUP BY status'):
        print(f'records {s}: {c}')


if __name__ == '__main__':
    args = sys.argv[1:]
    opt = lambda name, default=None: args[args.index(name) + 1] if name in args else default
    if args[0] == 'add':
        add_book(args[1], args[2], opt('--title'))
    elif args[0] == 'read':
        read(opt('--books').split(',') if opt('--books') else None, float(opt('--cap', '100')), int(opt('--workers', '6')))
    elif args[0] == 'add-epub':
        add_epub(args[1], args[2], opt('--title'))
    elif args[0] == 'supplement':
        supplement(args[1].split(',') if len(args) > 1 else None)
    elif args[0] == 'recheck':
        recheck(opt('--model', 'gemini-flash-latest'), opt('--thinking', 'high'), opt('--tag'), int(opt('--limit')) if opt('--limit') else None,
                float(opt('--cap', '50')), int(opt('--workers', '8')), float(opt('--total-cap', '185')),
                opt('--books').split(',') if opt('--books') else None, '--every' in args)
    elif args[0] == 'check':
        check(redo='--redo' in args)
    elif args[0] == 'status':
        status()
