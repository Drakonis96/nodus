"""Round-trip validation of the fast template extractor against ORD.

For sampled mapped reactions: extract a retro template, apply it back to the product,
and check the regenerated reactant set equals the real one.
"""

import glob, os, sys, time
from ord_schema.datasets import load_dataset
from template_fast import extract_template, round_trip_ok, apply_retro

BIG = sorted(glob.glob('/Users/avijit/Code/NodusResearch/ord-data/data/*/*.parquet'),
             key=os.path.getsize, reverse=True)[0]


def mapped_reactions(view, groups, limit):
    for g in groups:
        for rid, rxn in view.iter_reactions(row_group=g):
            cx = None
            for ident in rxn.identifiers:
                if ident.type == 6 and ident.value:
                    cx = ident.value
            if not cx:
                continue
            r, _, p = cx.partition('>>')
            if r and p:
                yield rid, r, p
            limit -= 1
            if limit <= 0:
                return


def main():
    n_want = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    v = load_dataset(BIG)
    t0 = time.time()
    ok = fail = none = 0
    failures = []
    slow = 0
    for i, (rid, r, p) in enumerate(mapped_reactions(v, range(0, 40), n_want)):
        s = time.time()
        res = round_trip_ok(r, p, radius=1)
        if time.time() - s > 2:
            slow += 1
        if res is None:
            none += 1
        elif res:
            ok += 1
        else:
            fail += 1
            if len(failures) < 8:
                failures.append((rid, r[:60], p[:60]))
        if (i + 1) % 200 == 0:
            print(f"  {i+1} done | ok={ok} fail={fail} none={none} | {time.time()-t0:.0f}s", flush=True)
    total = ok + fail + none
    print(f"\nsample={total} ok={ok} fail={fail} none={none} slow(>2s)={slow}")
    print(f"round-trip pass rate (of templated) = {ok/max(ok+fail,1)*100:.1f}%")
    for f in failures:
        print("  FAIL", f[0], "| R:", f[1], "| P:", f[2])

    # the pathological peptide
    print("\n-- pathological peptide (group 1362) --")
    for rid, r, p in mapped_reactions(v, [1362], 1000):
        if rid == 'ord-005ad8c6b5b0427ba965f9b058744968':
            s = time.time()
            t = extract_template(r, p)
            print(f"extract in {time.time()-s:.3f}s | template len={len(t) if t else 0}")
            s = time.time()
            print("round-trip:", round_trip_ok(r, p), f"in {time.time()-s:.3f}s")
            break


if __name__ == '__main__':
    main()
