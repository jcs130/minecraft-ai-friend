"""Collect hosting business evidence without initializing or migrating a store.

Run on the operator host with an explicitly selected existing hosting.sqlite.
The JSON contains role identifiers and is private operational evidence. It does
not contain owner IDs, keys, profiles, goals, tool arguments or receipt bodies.
This database alone cannot prove live body ownership, model use or event times.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import sqlite3


def collect(database):
    path = Path(database).resolve(strict=True)
    if not path.is_file():
        raise ValueError("Select an existing hosting.sqlite file")
    # Do not instantiate HostingStore: its constructor intentionally changes
    # generations and pending requests when a service starts.
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=3)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"roles", "requests"}.issubset(tables):
            raise ValueError("This is not a hosting business database")
        roles = [dict(row) for row in connection.execute(
            "SELECT server,uuid,name,mode,state,epoch,problem FROM roles ORDER BY server,uuid")]
        actions = [dict(row) for row in connection.execute(
            "SELECT state,COUNT(*) AS count FROM requests GROUP BY state ORDER BY state")]
        unresolved = [dict(row) for row in connection.execute(
            "SELECT role,COUNT(*) AS count FROM requests WHERE state IN ('pending','unknown') GROUP BY role ORDER BY role")]
        counts = {}
        for name in ("hosted_profiles", "native_model_bindings", "hub_model_bindings"):
            counts[name] = connection.execute('SELECT COUNT(*) FROM "' + name + '"').fetchone()[0] if name in tables else None
        columns = {name: [row[1] for row in connection.execute('PRAGMA table_info("' + name + '")')]
                   for name in ("roles", "requests")}
        summary = {"roles": roles, "requestStates": actions, "unresolvedByRole": unresolved, "bindingAndProfileCounts": counts}
        return {"schema": "qiandengji-hosting-read-only-evidence/v1",
                "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "readOnly": True, **summary,
                "snapshotSha256": hashlib.sha256(json.dumps(summary, sort_keys=True).encode()).hexdigest(),
                "hasRoleEventTimestamps": any(name in columns["roles"] for name in ("created_at", "updated_at", "attached_at")),
                "hasRequestEventTimestamps": any(name in columns["requests"] for name in ("created_at", "updated_at", "completed_at")),
                "boundaries": ["Rows are not proof of live body control or real model calls.",
                               "Profile/configuration time is not a handover time.",
                               "Binding counts describe stored references, not confirmed live connections.",
                               "Use native save/logout and original-client receipts for a real handover."]}
    finally:
        connection.rollback()
        connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    args = parser.parse_args()
    print(json.dumps(collect(args.database), ensure_ascii=False, indent=2))
