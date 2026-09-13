"""Bound operations engineer tools. No model, shell or production interface."""
import argparse
from engineering_workspace import EngineeringWorkspace

TOOLS = ('engineering_status', 'engineering_diff', 'engineering_test', 'engineering_test_status', 'engineering_commit')


def register_engineering_tools(app, service):
    @app.tool()
    def engineering_status(capture_source: bool = False, paths: list[str] | None = None) -> dict:
        """快速查看分支和固定验收计划；paths限定1-32个相对文件或目录才查工作改动，默认dirty=null表示未扫描。准备测试时才设capture_source=true（不传paths），完整读取当前源码取得新鲜sourceSha256。"""
        return service.status(capture_source=capture_source, paths=paths)

    @app.tool()
    def engineering_diff(max_chars: int = 24000, paths: list[str] | None = None) -> dict:
        """paths指定1-32个相对文件或目录，按需查看其Git差异；省略paths不扫描工作树。不生成源码快照，未跟踪文件需原生read_file读取。"""
        return service.diff(max_chars, paths=paths)

    @app.tool()
    def engineering_test(plan_id: str, expected_source_sha256: str, request_id: str) -> dict:
        """将当前不可变源码快照交给固定隔离测试计划；只排队，不能提供shell或自选镜像。"""
        return service.test(plan_id, expected_source_sha256, request_id)

    @app.tool()
    def engineering_test_status(job_id: str) -> dict:
        """读取测试回执；unknown不重投，queued/running留待下一任务查看，不循环等候。"""
        return service.test_status(job_id)

    @app.tool()
    def engineering_commit(message: str, expected_source_sha256: str, test_job_id: str, request_id: str) -> dict:
        """固定验收通过且源码未变时保存本地Git提交；不推送、不部署、不操作生产。"""
        return service.commit(message, expected_source_sha256, test_job_id, request_id)

    return list(TOOLS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', choices=['mc-god'], required=True)
    parser.add_argument('--native-runtime', choices=['game', 'operations'])
    parser.add_argument('--native-role')
    args = parser.parse_args()
    from mcp.server.fastmcp import FastMCP
    from world_team_hosts import ENGINEER, host_tool_app
    app = FastMCP('qiandengji-engineering')
    bound = host_tool_app(app, ENGINEER, args.native_runtime, args.native_role)
    register_engineering_tools(bound, EngineeringWorkspace())
    app.run(transport='stdio')


if __name__ == '__main__': main()
