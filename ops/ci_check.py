# -*- coding: utf-8 -*-
"""CI 门禁统一入口：python ops/ci_check.py [--fast]

跑 tests/ 全部单测（迁移回归 / 语法 / 路径锚点），失败退出码非 0。
用法：
  - 本地全量：python ops/ci_check.py
  - pre-commit 钩子：python ops/ci_check.py --fast（同一套，秒级）
  - GitHub Actions：同命令（.github/workflows/ci.yml）
"""
import os
import sys
import time
import unittest

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tests"))


def main() -> int:
    fast = "--fast" in sys.argv
    t0 = time.time()
    print(f"=== minecraft-ai-friend CI gate {'(fast)' if fast else ''} ===")
    suite = unittest.defaultTestLoader.discover(
        os.path.join(REPO, "tests"), pattern="test_*.py", top_level_dir=os.path.join(REPO, "tests"))
    runner = unittest.TextTestRunner(verbosity=2 if not fast else 1)
    result = runner.run(suite)
    dt = time.time() - t0
    n = result.testsRun
    if result.wasSuccessful():
        print(f"=== PASS: {n} tests, {dt:.1f}s ===")
        return 0
    print(f"=== FAIL: {len(result.failures)} failed, {len(result.errors)} errors, {dt:.1f}s ===")
    return 1


if __name__ == "__main__":
    sys.exit(main())
