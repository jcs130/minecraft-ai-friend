# 当前起始之城保护示例

这是合并片段，不能整份覆盖现役文件。仅替换 BlockAccess 中 aincrad 的范围，保留原八处和建设者；把五个城市/角落区域合入 WorldGuard 文件，保留其他领地和原编辑者覆盖。部署时应先运行原生策略重载，再从它新保存的区域文件合并，防止丢掉新生成的野外放行区。

分别使用已有 `mycli admin blockaccess reload --json`、`rg load -w aincrad` 和 `denizen reload scripts`。等待 WorldGuard 异步加载结束，再用原生策略同步保存并核对运行结果；不能只看文件写入就宣称生效。使用前备份、在独立服验证；副本保护由原插件保留。旧 aincrad-protection 是历史版本。

当前发布和回退见 `paper/docs/AINCRAD_CITY_POLICY_20261029.md`。
