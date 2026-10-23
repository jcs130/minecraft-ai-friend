# 分支与历史工程

2026-10-23，服主批准将当前千灯纪作为默认 main 的内容。更新使用保留双方历史的合并，保留原 main 的 MC 核心和自主组件；不强推丢弃提交。

| 分支 | 用途 |
| --- | --- |
| `main` | Paper 千灯纪、已上线 0.8.6 网站（`800cf4fb`）、通用 MC 核心和自部署入口 |
| `legacy/pre-paper-main-20261023` | 更换前的 main，固定 `a9f3e55137d0a548eb8d59517748e29cc713183e`；旧 NeoForge／运营工程与当时的完整 MC 核心均可取回 |
| `qiandengji-personal-stash` | 原 Paper 开发和正式回补记录；包含独立未发布候选，不再要求新用户先选这个分支 |
| `portal-account-fix-20261023` | 上一版网站 0.8.4 的固定来源 `9f03e4f1101d12f75c83add996165958565c964c`；保留用于历史与回退，当前官网固定来源为 main 的 `800cf4fbf29163a5fbc8f7ed6aa0967cf2a9f1b5` |

```sh
git clone https://github.com/jcs130/minecraft-ai-friend.git
cd minecraft-ai-friend
# 如需查阅旧工程：
git switch --track origin/legacy/pre-paper-main-20261023
```

分支保存源码，不保存运行世界、玩家背包和密码库。旧根目录 Compose 与启动脚本属于旧环境，不能直接用来启动 Paper。后续向 main 提交仍须保持私有文件边界和各组件测试；不要把本地未发布的官网候选、运行库或第三方私有素材直接带入。
