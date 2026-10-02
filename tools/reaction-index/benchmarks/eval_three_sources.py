"""Step 4 of ORD-assisted route scouting: per reference step, does the ORD evidence cover it, does a
textbook passage cover its reaction class, and how many steps does either cover?

ORD hit: the step's organic precursors are one of the top-6 disconnections of its product (what the
app shows) or one of the top-3 recorded preparations. Textbook hit (lexical lane only; the app also
runs a dense lane): one of the top-2 passages for the step's class query, from the in-scope works
contains every root of that query. Run from ord-index/:
  .venv/bin/python benchmarks/eval_three_sources.py <nodus.sqlite copy>
"""
import os
import json, re, sqlite3, sys
sys.path.insert(0, os.environ.get('CHEMISTRY_STUDIO_PYTHON', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'nodus-research-skill-marketplace', 'plugins', 'chemistry-studio', 'python')))
import reactions_worker as W
from rdkit import RDLogger
RDLogger.DisableLog('rdApp.*')

DB = sys.argv[1]
INDEX = 'index-v3'
# Mirrors shared/synthesisEvidence.ts.
TEXTBOOK = re.compile(r"\b(?:organic\s+chemistry|organic\s+synthesis|synthetic\s+(?:organic|sequences|methods)|reactions?\s+and\s+synthesis|name[d]?\s+reactions|heterocyclic\s+chemistry|medicinal\s+chemistry|reaction\s+mechanisms?)\b", re.I)
CLASS_QUERIES = {
    'enolate alkylation (malonic or acetoacetic ester synthesis)': 'malonic ester synthesis acetoacetic ester synthesis',
    'intramolecular aldol condensation (Robinson annulation)': 'Robinson annulation',
    'amide hydrolysis (deprotection of an acetamide)': 'hydrolysis of amides',
    'diazonium salt substitution (Sandmeyer)': 'Sandmeyer reaction diazonium salts',
    'Kolbe-Schmitt carboxylation of a phenol': 'Kolbe-Schmitt carboxylation phenoxide',
    'nitro group reduction to amine': 'reduction of nitro compounds to arylamines',
    'acylation of an alcohol or phenol': 'acetylation acetic anhydride ester',
    'amide formation by acylation of an amine': 'amides from acid chlorides and amines',
    'rearrangement or isomerization': None,
}

db = sqlite3.connect(DB)
rows = db.execute("SELECT w.nodus_id, w.title, (SELECT group_concat(c.name, char(31)) FROM work_collections wc JOIN collections c USING(collection_key) WHERE wc.nodus_id = w.nodus_id) FROM works w WHERE w.archived = 0 AND EXISTS (SELECT 1 FROM passages p WHERE p.nodus_id = w.nodus_id)").fetchall()
scope = [r[0] for r in rows if r[1] and (TEXTBOOK.search(r[1]) or any(n.strip().lower() == 'chemistry' for n in (r[2] or '').split('\x1f')))]

roots_of = lambda q: list(dict.fromkeys(t[:7] if len(t) >= 8 else t for t in re.findall(r'\w+', q.lower()) if len(t) >= 4))
index_like = lambda t: len(re.findall(r'\d+', t)) / max(1, len(t.split())) > 0.25
cache = {}
def textbook(query):
    if query in cache: return cache[query]
    roots = roots_of(query)
    fts = ' OR '.join(f'"{r}"*' for r in roots)
    found = db.execute(f"SELECT w.title, p.page_label, p.text FROM passages_fts f JOIN passages p ON p.passage_id = f.passage_id JOIN works w ON w.nodus_id = p.nodus_id WHERE passages_fts MATCH ? AND p.nodus_id IN ({','.join('?' * len(scope))}) ORDER BY bm25(passages_fts) LIMIT 24", [fts, *scope]).fetchall()
    found = [f for f in found if not index_like(f[2])]
    def score(item):
        words = re.findall(r'\w+', item[2].lower())
        return sum(any(w.startswith(r) for w in words) for r in roots) / len(roots)
    found.sort(key=lambda f: -score(f))
    top = found[:2]
    hit = next((f for f in top if score(f) == 1.0), None)
    cache[query] = (hit, top)
    return cache[query]

cases = json.load(open('benchmarks/route_scouting_cases.json'))['cases']
results = {}
for c in cases:
    products = sorted({W._canon(s['product']) for s in c['steps']})
    for r in W._disconnect(INDEX, products, 6, c.get('starts', [])):
        results[(c['item'], r['target'])] = r

n = ord_hits = tb_hits = union = classed = 0
lines = []
for c in cases:
    for s in c['steps']:
        n += 1
        product = W._canon(s['product'])
        r = results[(c['item'], product)]
        want = {W._canon(m) for m in s['precursors'] if W._is_organic(m)}
        proposed = any(want <= set(p['precursors'].split('.')) for p in r['proposals'][:6])
        recorded = any(want <= set((x['reaction'] or '').split('>>')[0].split('.')) for x in ((r['madeBy'] or {}).get('reactions') or [])[:3])
        ord_hit = proposed or recorded
        classes = W._reaction_classes('.'.join(W._canon(m) for m in s['precursors']), product)
        classed += bool(classes)
        query = next((CLASS_QUERIES.get(k, k) for k in classes if CLASS_QUERIES.get(k, k)), None)
        hit, _ = textbook(query) if query else (None, [])
        ord_hits += ord_hit; tb_hits += bool(hit); union += ord_hit or bool(hit)
        lines.append(f"#{c['item']:>2} {c['name'][:18]:18s} ORD {'✔' if ord_hit else '·'}  TB {'✔' if hit else '·'}  {(classes or ['-'])[0][:40]:40s} {('['+hit[0][:22]+' '+str(hit[1])+']') if hit else ''}")

print('\n'.join(lines))
print(f'\n{len(scope)} works in scope; {n} reference steps, {classed} with a named class')
print(f'ORD evidence (top-6 proposal or top-3 recorded): {ord_hits}/{n} ({ord_hits/n:.0%})')
print(f'textbook passage on the step\'s class (lexical, top-2): {tb_hits}/{n} ({tb_hits/n:.0%})')
print(f'either: {union}/{n} ({union/n:.0%})')
