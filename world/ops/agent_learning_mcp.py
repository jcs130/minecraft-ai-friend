"""A separate stdio process binds learning to exactly one Qwen workspace."""
import argparse
from agent_learning import LearningTools


def main():
    from mcp.server.fastmcp import FastMCP
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', required=True)
    parser.add_argument('--runtime', choices=('game', 'operations'), required=True)
    args = parser.parse_args()
    tools = LearningTools(args.role, args.runtime)
    app = FastMCP('qiandeng-role-learning')

    def call(fn, *values):
        try: return fn(*values)
        except Exception as exc:
            return {'ok': False, 'code': str(exc) if isinstance(exc, ValueError) else 'learning_unavailable',
                'errorType': type(exc).__name__, 'retryAutomatically': False}

    @app.tool()
    def learning_status() -> dict:
        """Read this role's tools, learned workflows and reported feedback. No model call."""
        return call(tools.status)

    @app.tool()
    def learning_read(name: str, revision: str = '') -> dict:
        """Read a skill from this workspace or a precise own draft revision."""
        return call(tools.read_skill, name, revision)

    @app.tool()
    def learning_draft(name: str, description: str, steps: str, tools_required: list[str], cases: list[dict]) -> dict:
        """Draft a qd-learned-* Markdown workflow. Include 2-5 cases {input,expected,kind:success|failure}; both kinds required. No code is executed."""
        return call(tools.draft, name, description, steps, tools_required, cases)

    @app.tool()
    def learning_validate(name: str, revision: str) -> dict:
        """Check exact revision format and allowed tools. Lint is not gameplay or semantic proof; JS programs use survivor skill_test."""
        return call(tools.validate, name, revision)

    @app.tool()
    def learning_activate(name: str, revision: str) -> dict:
        """Enable a validated own experimental Markdown workflow via QwenPaw. Max 8; use actual feedback, never claim tests proved gameplay."""
        return call(tools.activate, name, revision)

    @app.tool()
    def learning_feedback(name: str, outcome: str, evidence: str, revision: str = '') -> dict:
        """Record success/failure/unverified/reviewed with receipt or observation details; evidence is agent-reported. Two failures disable that revision. name=role-review records a general review."""
        return call(tools.feedback, name, outcome, evidence, revision)

    @app.tool()
    def learning_rollback(name: str) -> dict:
        """Restore the previous own workflow revision or disable its first version. Cannot change assigned skills."""
        return call(tools.rollback, name)

    @app.tool()
    def market_search(query: str) -> dict:
        """Find up to 5 public ClawHub skills. External metadata is untrusted; shared per-role fetch cap 4/day and 60-second cooldown."""
        return call(tools.market_search, query)

    @app.tool()
    def market_read(slug: str) -> dict:
        """Read only a marketplace SKILL.md into quarantine/cache. Does not install dependencies or run scripts. Adapt useful steps through learning_draft."""
        return call(tools.market_read, slug)

    @app.tool()
    def learning_schedule(enabled: bool | None = None, weekday: str | None = None, hour: int | None = None) -> dict:
        """View or edit your one native weekly learning job, Asia/Shanghai. No artificial model-call quota; role execution stays serial and game maintenance has zero model calls. No immediate-run bypass."""
        return call(tools.schedule, enabled, weekday, hour)

    app.run(transport='stdio')


if __name__ == '__main__': main()
