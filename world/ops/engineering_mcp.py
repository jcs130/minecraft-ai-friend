"""Bound operations engineer tools. No model, shell or production interface."""
import argparse
from engineering_workspace import EngineeringWorkspace

TOOLS = ('engineering_status', 'engineering_diff', 'engineering_test', 'engineering_test_status', 'engineering_commit')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', choices=['mc-god'], required=True)
    parser.parse_args()
    from mcp.server.fastmcp import FastMCP
    service = EngineeringWorkspace()
    app = FastMCP('qiandengji-engineering')

    @app.tool()
    def engineering_status() -> dict:
        """查看独立源码分支、源码哈希与固定验收计划；实际源文件用本角色原生文件工具读写。"""
        return service.status()

    @app.tool()
    def engineering_diff(max_chars: int = 24000) -> dict:
        """查看有界代码差异；未跟踪文件需用原生read_file读取，差异不是已部署证明。"""
        return service.diff(max_chars)

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

    app.run(transport='stdio')


if __name__ == '__main__': main()
