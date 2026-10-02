#!/usr/bin/env python3
"""Keep the local ORD reaction index current with the Open Reaction Database on Hugging Face.

  update_ord.py --check              is there a newer ord-data revision, and what changed?
  update_ord.py --apply              download the changed files, rebuild, swap the index in
  update_ord.py --apply --force      rebuild and swap even when nothing changed (after an extractor change)

--check exits 0 when the index is current and 10 when an update is available (for a cron or a
reminder). --apply needs Nodus closed: it reads the index while running.

How an update runs (only what changed is fetched and re-extracted):
  1. The latest dataset revision and its parquet files with their SHA-256 (from the hub's LFS
     metadata) are compared with the local ord-data files.
  2. New and changed files are downloaded into ord-data; removed ones are moved aside.
  3. The index is rebuilt into a clone of the current one (APFS clone, instant). The builder's
     checkpoints are content-addressed (file SHA-256 + row group), so only new row groups are
     extracted; the merge and the DRFP/faiss step (~12 min) run over everything. conditions.py then
     rebuilds conditions.tsv.zst (reagents, solvents, temperature, yield, reference of the cited
     reactions; ~2 min, also checkpointed).
  4. The new manifest is checked (revision, key counts), then the clone replaces the index and
     the old one is kept as <index>.prev for a rollback (update_ord.py --rollback).
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = 'open-reaction-database/ord-data'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 22), b''):
            h.update(block)
    return h.hexdigest()


def local_files(data):
    out = {}
    root = os.path.join(data, 'data')
    for dirpath, _, names in os.walk(root):
        for name in names:
            if name.endswith('.parquet'):
                path = os.path.join(dirpath, name)
                out[os.path.relpath(path, data)] = path
    return out


def remote_state(revision=None):
    from huggingface_hub import HfApi
    api = HfApi()
    info = api.dataset_info(REPO, revision=revision)
    tree = api.list_repo_tree(REPO, repo_type='dataset', revision=info.sha, recursive=True)
    files = {f.path: (f.lfs.sha256 if getattr(f, 'lfs', None) else None, f.size)
             for f in tree if getattr(f, 'path', '').endswith('.parquet')}
    return info.sha, str(info.last_modified), files


def plan(data, index, revision=None):
    manifest = json.load(open(os.path.join(index, 'manifest.json')))
    latest, modified, remote = remote_state(revision)
    local = local_files(data)
    added = sorted(p for p in remote if p not in local)
    removed = sorted(p for p in local if p not in remote)
    changed = sorted(p for p in remote if p in local and remote[p][0] and sha256(local[p]) != remote[p][0])
    return {
        'indexRevision': manifest.get('revision'), 'latestRevision': latest, 'latestModified': modified,
        'added': added, 'changed': changed, 'removed': removed,
        'downloadBytes': sum(remote[p][1] or 0 for p in added + changed),
        'manifest': manifest,
    }


def github_data_date():
    """The date of the newest commit on ORD's GitHub main that touched data/ — the source the
    website and new submissions use. None when GitHub cannot be asked (rate limit, offline)."""
    import urllib.request
    try:
        url = 'https://api.github.com/repos/open-reaction-database/ord-data/commits?path=data&per_page=1'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json'}), timeout=20) as r:
            return json.load(r)[0]['commit']['committer']['date']
    except Exception:
        return None


def report(p):
    current = p['indexRevision'] == p['latestRevision'] and not (p['added'] or p['changed'] or p['removed'])
    print(f"index built from {p['indexRevision'][:12]} · latest {p['latestRevision'][:12]} ({p['latestModified']})")
    print(f"files: {len(p['added'])} new, {len(p['changed'])} changed, {len(p['removed'])} removed · "
          f"download {p['downloadBytes'] / 1e6:.1f} MB")
    for label in ('added', 'changed', 'removed'):
        for path in p[label][:20]:
            print(f'  {label:8} {path}')
    # The website reads ORD's GitHub repository; the index is built from its Hugging Face copy.
    # Say so if GitHub has data newer than the copy (the copy lags until ORD syncs it).
    github = github_data_date()
    if github:
        hf_day, gh_day = p['latestModified'][:10], github[:10]
        print(f'GitHub main data last changed {gh_day}' + ('' if gh_day <= hf_day else f' — NEWER than the Hugging Face copy ({hf_day}); it will update once ORD syncs it'))
    print('UP TO DATE' if current else 'UPDATE AVAILABLE')
    return current


def nodus_running():
    out = subprocess.run(['pgrep', '-f', 'Nodus.app/Contents/MacOS/Nodus|Electron.app/Contents/MacOS/Electron'],
                         capture_output=True, text=True).stdout.strip()
    return bool(out)


def apply(args, p):
    if nodus_running() and not args.allow_running:
        sys.exit('Nodus is running; close it first (it reads the index).')
    from huggingface_hub import hf_hub_download
    rev = p['latestRevision']
    for path in p['added'] + p['changed']:
        print(f'downloading {path}', flush=True)
        hf_hub_download(REPO, path, repo_type='dataset', revision=rev, local_dir=args.data)
    if p['removed']:
        aside = os.path.join(args.data, f'.removed-{rev[:12]}')
        for path in p['removed']:
            target = os.path.join(aside, path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.move(os.path.join(args.data, path), target)
        print(f'moved {len(p["removed"])} removed file(s) to {aside}', flush=True)

    index = os.path.abspath(args.index)
    staged = index + '.next'
    if os.path.exists(staged):
        shutil.rmtree(staged)
    # APFS clone: instant, and the builder only rewrites what it produces.
    subprocess.run(['cp', '-cR', index, staged], check=True)
    cmd = [sys.executable, os.path.join(HERE, 'build_index.py'), '--root', os.path.abspath(args.data),
           '--out', staged, '--revision', rev]
    if args.workers:
        cmd += ['--workers', str(args.workers)]
    print('building:', ' '.join(cmd), flush=True)
    started = time.time()
    subprocess.run(cmd, check=True)
    # The builder rewrites manifest.json; the conditions of the reactions the new index cites are
    # rebuilt after it (checkpoints cloned with the index, so only new row groups are read).
    cmd = [sys.executable, os.path.join(HERE, 'conditions.py'), '--index', staged, '--root', os.path.abspath(args.data)]
    if args.workers:
        cmd += ['--workers', str(args.workers)]
    print('conditions:', ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True)

    new = json.load(open(os.path.join(staged, 'manifest.json')))
    old = p['manifest']
    problems = []
    if new.get('revision') != rev:
        problems.append(f"manifest revision {new.get('revision')} != {rev}")
    for key in ('exactKeys', 'templates', 'products'):
        if new.get(key, 0) < 0.99 * old.get(key, 0) and not p['removed']:
            problems.append(f'{key} fell from {old.get(key)} to {new.get(key)}')
    if problems:
        sys.exit('new index NOT installed: ' + '; '.join(problems) + f' (left in {staged})')

    previous = index + '.prev'
    if os.path.exists(previous):
        shutil.rmtree(previous)
    os.rename(index, previous)
    os.rename(staged, index)
    print(f"installed: {old.get('exactKeys')} → {new.get('exactKeys')} exact keys, "
          f"{old.get('templates')} → {new.get('templates')} templates, "
          f"{old.get('products')} → {new.get('products')} products in {(time.time() - started) / 60:.1f} min; "
          f'previous index kept at {previous}', flush=True)


def rollback(args):
    index = os.path.abspath(args.index)
    previous = index + '.prev'
    if not os.path.exists(previous):
        sys.exit(f'no previous index at {previous}')
    if nodus_running() and not args.allow_running:
        sys.exit('Nodus is running; close it first.')
    failed = index + '.failed'
    if os.path.exists(failed):
        shutil.rmtree(failed)
    os.rename(index, failed)
    os.rename(previous, index)
    print(f'rolled back; the replaced index is at {failed}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--rollback', action='store_true')
    # The index is the directory Nodus reads (NODUS_REACTION_INDEX_DIR); the data is the ord-data
    # checkout it was built from (ORD_DATA_DIR). Without them: beside this script, as in a
    # workspace where ord-index/ holds the index and links to these tools.
    ap.add_argument('--data', default=os.environ.get('ORD_DATA_DIR') or os.path.join(os.path.dirname(HERE), 'ord-data'))
    ap.add_argument('--index', default=os.environ.get('NODUS_REACTION_INDEX_DIR') or os.path.join(HERE, 'index-v3'))
    ap.add_argument('--revision', help='a specific dataset revision instead of the latest')
    ap.add_argument('--workers', type=int, default=0)
    ap.add_argument('--allow-running', action='store_true', help='skip the Nodus-closed check (scratch copies only)')
    ap.add_argument('--force', action='store_true', help='with --apply: rebuild and swap even when the index is current')
    args = ap.parse_args()
    if args.rollback:
        return rollback(args)
    p = plan(args.data, args.index, args.revision)
    current = report(p)
    if args.check:
        sys.exit(0 if current else 10)
    if current and not args.force:
        print('nothing to do')
        return
    apply(args, p)


if __name__ == '__main__':
    main()
