#!/usr/bin/env python3
"""Optional command-line moderation for MemeVault community submissions.

You do NOT need this: moderating in the Supabase dashboard (Table editor -> submissions -> set status to
'approved' or 'rejected') does exactly the same thing. This script is only a convenience if you ever choose to
use a service-role key. The key is read from the SUPABASE_SERVICE_KEY environment variable and is never stored.
Never put the service key in the website or commit it.

  export SUPABASE_SERVICE_KEY=...            # Supabase dashboard -> Project settings -> API keys -> secret key
  python3 scripts/moderate.py pending        # list pending submissions with 1-hour preview links
  python3 scripts/moderate.py approve <id> [<id> ...]
  python3 scripts/moderate.py reject  <id> [<id> ...]
  python3 scripts/moderate.py reports [--days 7]
  python3 scripts/moderate.py cleanup [--dry-run]   # delete image files of rejected submissions and orphan uploads >1 day old
"""
import argparse, datetime as dt, json, os, sys, urllib.request, urllib.error

SB = os.environ.get("SUPABASE_URL", "https://zvdhsibcwkvahfqglgvz.supabase.co").rstrip("/")


def key():
    k = os.environ.get("SUPABASE_SERVICE_KEY")
    if not k:
        sys.exit("SUPABASE_SERVICE_KEY is not set. This script is optional; use the Supabase dashboard instead.")
    return k


def call(method, path, body=None, prefer=None):
    k = key()
    h = {"apikey": k, "Content-Type": "application/json"}
    if not k.startswith("sb_secret_"):  # legacy JWT service_role keys also need the Authorization header
        h["Authorization"] = "Bearer " + k
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(SB + path, method=method, headers=h, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:400]}")


def sign(paths, secs=3600):
    if not paths:
        return {}
    res = call("POST", "/storage/v1/object/sign/submissions", {"expiresIn": secs, "paths": paths})
    return {x["path"]: SB + "/storage/v1" + x["signedURL"] for x in res if x.get("signedURL")}


def pending(_):
    rows = call("GET", "/rest/v1/submissions?select=id,title,tags,category,kind,image_path,created_at&status=eq.pending&order=created_at.asc&limit=200")
    urls = sign([r["image_path"] for r in rows])
    for r in rows:
        print(f"{r['id']}  [{r['kind']}] {r['title']!r}  cat={r['category']} tags={','.join(r['tags'] or [])}  {r['created_at'][:16]}")
        print(f"    preview: {urls.get(r['image_path'], '(file missing)')}")
    print(f"{len(rows)} pending")


def set_status(ids, status):
    for i in ids:
        res = call("PATCH", f"/rest/v1/submissions?id=eq.{i}", {"status": status}, prefer="return=representation")
        print(f"{i}: {'-> ' + status if res else 'not found'}")


def reports(a):
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=a.days)).isoformat()
    rows = call("GET", f"/rest/v1/reports?select=meme_id,reason,note,created_at&created_at=gte.{since}&order=created_at.desc&limit=500")
    by = {}
    for r in rows:
        by.setdefault(r["meme_id"], []).append(r)
    for mid, rs in sorted(by.items(), key=lambda x: -len(x[1])):
        print(f"{len(rs):3d}x  {mid}   reasons: {', '.join(sorted({r['reason'] for r in rs}))}")
        for r in rs:
            if r.get("note"):
                print(f"        - {r['note'][:200]}")
    print(f"{len(rows)} reports in the last {a.days} days")


def cleanup(a):
    rej = call("GET", "/rest/v1/submissions?select=image_path&status=eq.rejected&limit=1000")
    known = {r["image_path"] for r in call("GET", "/rest/v1/submissions?select=image_path&limit=10000")}
    objs = call("POST", "/storage/v1/object/list/submissions", {"prefix": "pending", "limit": 1000, "sortBy": {"column": "created_at", "order": "asc"}}) or []
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    orphans = [f"pending/{o['name']}" for o in objs if o.get("id") and f"pending/{o['name']}" not in known
               and dt.datetime.fromisoformat(o["created_at"].replace("Z", "+00:00")) < cutoff]
    paths = sorted({r["image_path"] for r in rej} | set(orphans))
    print(f"{len(rej)} rejected files, {len(orphans)} orphan uploads")
    if paths and not a.dry_run:
        call("DELETE", "/storage/v1/object/submissions", {"prefixes": paths})
        print(f"deleted {len(paths)} files")


p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
s = p.add_subparsers(dest="cmd", required=True)
s.add_parser("pending").set_defaults(f=pending)
for st in ("approve", "reject"):
    x = s.add_parser(st); x.add_argument("ids", nargs="+")
    x.set_defaults(f=lambda a, st=st: set_status(a.ids, "approved" if st == "approve" else "rejected"))
x = s.add_parser("reports"); x.add_argument("--days", type=int, default=7); x.set_defaults(f=reports)
x = s.add_parser("cleanup"); x.add_argument("--dry-run", action="store_true"); x.set_defaults(f=cleanup)
a = p.parse_args(); a.f(a)
