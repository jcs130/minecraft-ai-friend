"""Tombstone (case-638934 Step1a): superseded by tests/survival_trajectory.py.

This was an earlier Step1a draft (iter_receipts/data_card API). Its test file
was never aligned to this API, so keeping both would fail the shared tests/
run. The canonical reader is tests/survival_trajectory.py with
tests/test_survival_trajectory.py; this module's unique pieces (strict receipt
regex/size validation, turn-actions/ + lease.json + crash-marker coverage)
were preserved verbatim 2026-09-15 at
drafts/survivor_trajectory-v2-data-card-20260915.py in the qd-engineer
workspace, to be ported into the canonical module with tests in a later
increment. Safe for an operator to delete this file entirely.
"""
