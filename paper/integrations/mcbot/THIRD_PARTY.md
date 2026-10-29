# 许可与独立实现

独立Paper适配器、边界测试和协议探针按本仓库MIT许可提供。它们不包含qaqms/mcbot的源码、资源或JAR。

qaqms/mcbot采用保留所有权利的许可。本项目仅核对固定公开版本的通道、数据格式和可用工具，独立编写互操作实现；不改包、不重分发其客户端，不将其宣传为本项目自有作品。客户端须从作者官方渠道取得。

`numen/`、`numen-content/`下的窄接口及由构建脚本生成的Numen补丁按LGPL-3.0-only提供。完整上游源码、许可及固定基线为[Numen 287ac6e5](https://github.com/jcs130/minecraft-numen/tree/287ac6e5d492ea73323fc4eb4ce668aacac89130)；本目录提供全部新增源和确定的变换，`build-manifest.json`记录输入、变更类和产物摘要。构建保留Numen JAR的其他条目。分发这些补丁JAR时须同时提供本目录及对应的上游源码和许可，不能只发无源二进制。
