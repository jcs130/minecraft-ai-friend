# 历史自主更新版本的构建源

当前 `autonomous-src` 和主测试属于 v3。旧构建器必须使用此目录里的固定版本源和测试，不能从当前开发源编译后贴上旧能力名称。

- `autonomous-body-tick-v1`：源码取自项目提交 `2ed50cb78b819258a99219309120344e1b68e484` 中的原 v1 文件；原路径和哈希记录在该目录 `archive.json`。原始 v1 批准清单仍检查同一源码哈希。
- `autonomous-world-tick-v2`：源码取自已验收 v2 构建的 `source` 副本；旧测试与 v1 测试字节相同，均与两份旧构建记录的测试 SHA 一致。完整出处记录在该目录 `archive.json`。

`build_numen_autonomous.py` 和 `build_numen_world_tick.py` 显式引用对应目录，先校验归档源码和测试，再校验最终 JAR 必须与旧已验收产物相同。原 v1/v2 批准清单不改写，v3 构建器及其输入不改动。

重现历史时提供原基线，使用独立输出和 `--no-latest` 保留当前及历史 latest 记录：

```powershell
.\run-python.bat tools/build_numen_autonomous.py --baseline-jar <97ed8069...的原基线.jar> --output-root runtime/numen-historical-rebuild/v1 --no-latest
.\run-python.bat tools/build_numen_world_tick.py --baseline-jar <47cc11d6...的v1.jar> --output-root runtime/numen-historical-rebuild/v2 --no-latest
```

v1 仍按原清单校验 Numen 源仓库提交和入口补丁；可使用 `--source` 指定该提交的已有检出目录。两版都使用现有 JDK 21 和 NeoForge 编译依赖。直接拿当前 v3 生产 JAR 充当旧基线会明确失败。

2026-09-14 已在独立目录真实重建，两版各通过原来的 34 项断言，输出精确复现：

| 版本 | SHA256 |
| --- | --- |
| v1 | `47cc11d609b03b62734c4772b2aa40a89ba02a5bbaab0d85ab10589d45ffec3b` |
| v2 | `22d3d5d7a9660a0978e66b9b98071bf02a337d9b0276aa583d750ca1fbea9104` |

证据为 `runtime/survival-priority-20260914/historical-rebuild-result.json`，同时记录 v3 的构建输入及 latest 前后哈希全部未变。该重建未部署、未调用模型、未修改生产缓存或存档。
