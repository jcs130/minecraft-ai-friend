"""Retired one-time 6 -> 12 migration; it must not restore artificial limits.

Use tools/sync_role_learning.py --runtime game|operations while the scoped
Qwen service is stopped. It preserves model choices, personal notes and
history, and updates global and role running-config together. Restart that
service after sync to install the quota-off adapter and clear QPM caches.
"""


def apply(*args, **kwargs):
    raise ValueError('iteration_migration_retired_use_sync_role_learning')


if __name__ == '__main__':
    raise SystemExit(__doc__)
