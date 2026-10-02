#!/usr/bin/env python3
"""Watch a reaction-index build without loading the index.

Reads <out>/progress.json (written continuously by build_index.py), counts the
checkpoints in <out>/parts, checks whether the builder is still alive via
<out>/build.pid, and echoes the useful lines from build.log. Read-only, so it is
safe to run while the build is going.

Usage:
  python progress.py [out_dir]              # one snapshot (default ./index)
  python progress.py [out_dir] --watch      # refresh every 5s
  python progress.py [out_dir] --watch 10   # refresh every 10s
"""

import json, os, subprocess, sys, time

INTERESTING = ('force-fast', 'WATCHDOG', 'completeness', 'scan done',
               'merged', 'faiss index', 'DONE', 'task error', 'WARNING')
TOTAL_GROUPS = 2466


def _running(out):
    pid_path = os.path.join(out, 'build.pid')
    if os.path.exists(pid_path):
        try:
            pid = int(open(pid_path).read().strip())
            os.kill(pid, 0)
            return pid
        except (ValueError, OSError):
            pass
    try:
        got = subprocess.run(['pgrep', '-f', 'build_index.py'],
                             capture_output=True, text=True).stdout.split()
        return int(got[0]) if got else None
    except Exception:
        return None


def _tail_lines(log_path, n=6):
    if not os.path.exists(log_path):
        return []
    size = os.path.getsize(log_path)
    with open(log_path, 'rb') as fh:
        fh.seek(max(0, size - 65536))
        text = fh.read().decode('utf-8', 'replace')
    keep = [ln.rstrip() for ln in text.splitlines() if any(k in ln for k in INTERESTING)]
    return keep[-n:]


def _bar(frac, width=28):
    frac = max(0.0, min(1.0, frac))
    filled = int(frac * width)
    return '[' + '#' * filled + '.' * (width - filled) + f'] {frac * 100:5.1f}%'


def snapshot(out):
    log = os.path.join(out, 'build.log')
    parts = len([f for f in os.listdir(os.path.join(out, 'parts'))
                 if f.endswith('.json')]) if os.path.isdir(os.path.join(out, 'parts')) else 0
    prog = {}
    pp = os.path.join(out, 'progress.json')
    if os.path.exists(pp):
        try:
            prog = json.load(open(pp))
        except (ValueError, OSError):
            pass

    pid = _running(out)
    phase = prog.get('phase', 'not started')
    lines = [f'nodus reaction index  —  {os.path.abspath(out)}']
    lines.append(f'status : {"RUNNING (pid %d)" % pid if pid else "not running"}')
    lines.append(f'phase  : {phase}')

    if phase == 'scan':
        done, total = prog.get('done', 0), prog.get('total', TOTAL_GROUPS)
        lines.append(f'progress: {_bar(done / total if total else 0)}  {done}/{total}'
                     f'  skipped {prog.get("skipped", 0)}')
        lines.append(f'timing : {prog.get("elapsedMin", 0)}m elapsed, ETA {prog.get("etaMin", 0)}m')
    elif phase == 'fingerprints':
        b, tb = prog.get('batches', 0), prog.get('totalBatches', 1)
        lines.append(f'progress: {_bar(b / tb if tb else 0)}  fp batch {b}/{tb}')
    if parts:
        lines.append(f'parts  : {parts} checkpoints on disk')

    tail = _tail_lines(log)
    if tail:
        lines.append('log    :')
        lines += [f'         {ln}' for ln in tail]

    if prog.get('finished') or (phase == 'fingerprints' and prog.get('batches') == prog.get('totalBatches')):
        lines.append('artifacts: manifest.json, exact/templates/products.tsv.zst, reactions.faiss.zst')
    return '\n'.join(lines)


def main():
    argv = sys.argv[1:]
    watch = 0.0
    if '--watch' in argv:
        i = argv.index('--watch')
        watch = float(argv[i + 1]) if i + 1 < len(argv) and not argv[i + 1].startswith('-') else 5.0
        del argv[i:i + 1 + (1 if i < len(argv) - 1 and not argv[i + 1].startswith('-') else 0)]
    out = argv[0] if argv else './index'

    if not watch:
        print(snapshot(out))
        return
    try:
        while True:
            os.system('clear' if os.name != 'nt' else 'cls')
            print(snapshot(out))
            print(f'\nrefreshing every {watch:g}s — Ctrl-C to stop')
            time.sleep(watch)
    except KeyboardInterrupt:
        print()


if __name__ == '__main__':
    main()
