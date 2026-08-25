# -*- coding: utf-8 -*-
"""安装 git pre-commit 钩子：提交前跑 CI 门禁（ops/ci_check.py --fast），红了就拒提交。

用法：python ops/install-hooks.py [--uninstall]
幂等：重复执行直接覆盖为最新版钩子。
"""
import io
import os
import stat
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(REPO, ".git", "hooks", "pre-commit")

BODY = """#!/bin/sh
# minecraft-ai-friend CI gate（ops/install-hooks.py 生成）
# 迁移回归 / 语法 / 路径锚点，任一失败即阻断提交。
if command -v python >/dev/null 2>&1; then
  PY=python
elif command -v py >/dev/null 2>&1; then
  PY="py -3"
else
  echo "[pre-commit] 找不到 python，门禁无法执行" >&2
  exit 1
fi
$PY ops/ci_check.py --fast
exit $?
"""


def main() -> int:
    if "--uninstall" in sys.argv:
        if os.path.exists(HOOK):
            os.remove(HOOK)
            print("removed", HOOK)
        return 0
    os.makedirs(os.path.dirname(HOOK), exist_ok=True)
    io.open(HOOK, "w", encoding="utf-8", newline="\n").write(BODY)
    try:  # 类 unix 环境补执行位（Windows 无此概念，忽略失败）
        os.chmod(HOOK, os.stat(HOOK).st_mode | stat.S_IEXEC)
    except OSError:
        pass
    print("installed", HOOK)
    return 0


if __name__ == "__main__":
    sys.exit(main())
