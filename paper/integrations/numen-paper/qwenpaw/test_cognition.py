"""Role isolation against the real QwenPaw 2.2.2 whitelist and tool ABI."""
import asyncio
import json
import unittest
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

from agentscope.message import ToolCallBlock
from qwenpaw.runtime.builder import AgentBuilder
from qwenpaw.schemas import TextContent
import test_native_game as native
from cognition_profile import cognition_profile

game, CFG = native.game, native.CFG


class Cognition(unittest.IsolatedAsyncioTestCase):
    # Share fixtures, not inherited test methods (do not inflate test counts).
    setUp = native.NativeGame.setUp
    tearDown = native.NativeGame.tearDown
    context = native.NativeGame.context
    channel = native.NativeGame.channel
    def review(self, session="review-one", tools=None, role="review"):
        ctx = self.context(session, "console", "console")
        ctx.request.request_context.update(qiandengji_role=role)
        if tools is not None:
            ctx.request.request_context["subagent_allowed_tools"] = tools
        return ctx

    async def test_late_enabled_workspace_gets_snapshot_with_native_config_gates(self):
        from qwenpaw.app.workspace.local_workspace import QwenPawLocalWorkspace
        from qwenpaw.runtime.tool_registry import ToolDescriptor, ToolRegistry
        descriptor = ToolDescriptor(name="qiandengji_snapshot", func=game.qiandengji_snapshot,
                                    enabled_by_default=False)
        with patch.object(game.qiandengji_snapshot, "_tool_descriptor", descriptor, create=True):
            for enabled in (True, False):
                registry = ToolRegistry()
                ctx = self.review("late-"+str(enabled))
                ctx.workspace = NS(plugins=NS(tool_registry=registry))
                await game.GameEnter().run(ctx)
                adapter = QwenPawLocalWorkspace(registry, workdir=str(self.workspace))
                tools = await adapter.list_tools(agent_config=NS(tools=NS(builtin_tools={
                    "qiandengji_snapshot": NS(enabled=enabled)})),
                    request_context=ctx.request.request_context)
                self.assertEqual([tool.name for tool in tools], ["qiandengji_snapshot"] if enabled else [])
                self.assertIs(registry.get("qiandengji_snapshot").func, game.qiandengji_snapshot)
                await game.GameLeave().run(ctx)

    async def test_reloaded_workspace_replaces_only_stale_snapshot_descriptor(self):
        from qwenpaw.runtime.tool_registry import ToolDescriptor, ToolRegistry
        registry = ToolRegistry()
        old = lambda: None
        other = ToolDescriptor(name="other_plugin", func=old)
        registry.register(ToolDescriptor(name="qiandengji_snapshot", func=old))
        registry.register(other)
        descriptor = ToolDescriptor(name="qiandengji_snapshot", func=game.qiandengji_snapshot,
                                    enabled_by_default=False)
        with patch.object(game.qiandengji_snapshot, "_tool_descriptor", descriptor, create=True):
            workspace = NS(plugins=NS(tool_registry=registry))
            game.ensure_snapshot_registration(workspace)
            game.ensure_snapshot_registration(workspace)
        self.assertIs(registry.get("qiandengji_snapshot"), descriptor)
        self.assertIs(registry.get("other_plugin"), other)

    async def test_review_does_not_wait_for_body_and_keeps_own_session(self):
        body = self.context()
        await game.GameEnter().run(body)
        review = self.review()
        result = await asyncio.wait_for(game.GameEnter().run(review), 0.1)
        self.assertEqual(result.action.value, "continue")
        self.assertEqual(review.session_id, "review-one")
        self.assertTrue(self.lane.lock.locked())
        await game.GameLeave().run(review)
        self.assertTrue(self.lane.lock.locked())
        await game.GameLeave().run(body)

    async def test_native_child_with_no_requested_filter_is_restricted(self):
        ctx = self.review()
        ctx.request.request_context = {"_spawn_subagent": True, "parent_session_id": CFG["session_id"]}
        await game.GameEnter().run(ctx)
        rc = ctx.request.request_context
        self.assertEqual(set(rc["subagent_allowed_tools"]), game.REVIEW_TOOLS)
        self.assertEqual(rc["subagent_skills"], [])
        await game.GameLeave().run(ctx)

    async def test_requested_restriction_is_intersection_never_broadened(self):
        ctx = self.review(tools=["memory_search", "lua", "command", "spawn_subagent"])
        await game.GameEnter().run(ctx)
        self.assertEqual(ctx.request.request_context["subagent_allowed_tools"], ["memory_search"])
        await game.GameLeave().run(ctx)
        empty = self.review(tools=[])
        await game.GameEnter().run(empty)
        self.assertEqual(empty.request.request_context["subagent_allowed_tools"], [])
        await game.GameLeave().run(empty)

    async def test_real_final_builder_filter_removes_body_host_and_recursive_tools(self):
        ctx = self.review()
        await game.GameEnter().run(ctx)
        tools = [NS(name=n) for n in [*game.REVIEW_TOOLS, "lua", "command", "say", "execute_shell_command", "spawn_subagent"]]
        result = AgentBuilder.apply_subagent_tool_whitelist(tools, ctx.request.request_context)
        self.assertEqual({t.name for t in result}, game.REVIEW_TOOLS)
        await game.GameLeave().run(ctx)

    async def test_review_limit_rejects_without_queuing_and_releases_after_error(self):
        first, second, third = self.review("one"), self.review("two"), self.review("three")
        await game.GameEnter().run(first)
        await game.GameEnter().run(second)
        result = await game.GameEnter().run(third)
        self.assertEqual(result.action.value, "short_circuit")
        first.error = TimeoutError()
        await game.GameLeave().run(second)
        await game.GameLeave().run(first)
        self.assertFalse(self.lane.review_sessions)
        await game.GameEnter().run(third)
        await game.GameLeave().run(third)

    async def test_cannot_analyse_using_canonical_body_session(self):
        ctx = self.review(CFG["session_id"])
        result = await game.GameEnter().run(ctx)
        self.assertEqual(result.action.value, "short_circuit")
        self.assertFalse(self.lane.lock.locked())

    async def test_review_cannot_start_slash_goal(self):
        ctx = self.review()
        ctx.request.input = [NS(content=[TextContent(type="text", text="/goal 乱挖")])]
        await game.GameEnter().run(ctx)
        self.assertTrue(ctx.request.input[0].content[0].text.startswith("[后台"))
        await game.GameLeave().run(ctx)

    async def test_snapshot_only_has_fixed_read_queries_with_cache(self):
        channel = self.channel()
        self.lane.channel = channel
        channel.invoke = AsyncMock(return_value={"content": [{"type":"text","text":"MC_STATUS {\"food\":20}"}]})
        ctx = self.review()
        await game.GameEnter().run(ctx)
        for section in ("status", "tasks", "skills", "status"):
            result = await game.qiandengji_snapshot(section)
            data = json.loads(result.content[0].text)
            self.assertTrue(data["readOnly"])
            self.assertEqual(data["source"], "paper-mycli")
            self.assertIn("observedAt", data)
        self.assertEqual(channel.invoke.await_count, 3)
        bad = await game.qiandengji_snapshot("/give @s diamond")
        self.assertEqual(bad.state.value, "error")
        self.assertEqual(channel.invoke.await_count, 3)
        await game.GameLeave().run(ctx)

    async def test_snapshot_missing_connection_returns_unknown_without_retry(self):
        channel = self.channel()
        self.lane.channel = channel
        channel.invoke = AsyncMock(side_effect=TimeoutError())
        ctx = self.review()
        await game.GameEnter().run(ctx)
        data = json.loads((await game.qiandengji_snapshot()).content[0].text)
        self.assertEqual(data["status"], "unknown")
        channel.invoke.assert_awaited_once()
        await game.GameLeave().run(ctx)

    async def test_snapshot_detects_stale_advice_after_body_round(self):
        channel = self.channel()
        self.lane.channel = channel
        channel.invoke = AsyncMock(return_value={"content":[{"type":"text","text":"MC_STATUS {}"}]})
        review = self.review()
        await game.GameEnter().run(review)
        data = json.loads((await game.qiandengji_snapshot()).content[0].text)
        old = data["revision"]
        body = self.context()
        await game.GameEnter().run(body)
        await game.GameLeave().run(body)
        data = json.loads((await game.qiandengji_snapshot(expected_revision=old)).content[0].text)
        self.assertTrue(data["stale"])
        self.assertNotEqual(data["revision"], old)
        await game.GameLeave().run(review)

    async def test_restored_mutating_call_is_denied_without_invocation(self):
        middleware = game.PublicTools(self.lane, review=True)
        next_handler = AsyncMock()
        for name in ("lua", "command", "spawn_subagent", "say"):
            result = [r async for r in middleware.on_acting(None, {"tool_call": NS(name=name)}, next_handler)]
            self.assertEqual(result[0].state.value, "error")
        next_handler.assert_not_called()

    async def test_spawn_uses_native_background_timeout_and_whitelist(self):
        call = ToolCallBlock(id="spawn", name="spawn_subagent", input=json.dumps({"task":"复盘", "timeout":9999,"fork":True}))
        seen = []
        async def downstream():
            seen.append(json.loads(call.input))
            yield game.tool_result({"task_id":"native-task"})
        middleware = game.PublicTools(self.lane)
        result = [r async for r in middleware.on_acting(None, {"tool_call":call}, downstream)]
        self.assertEqual(len(result), 1)
        self.assertEqual(set(seen[0]["allowed_tools"]), game.REVIEW_TOOLS)
        self.assertTrue(seen[0]["background"])
        self.assertFalse(seen[0]["fork"])
        self.assertEqual(seen[0]["timeout"], 180)

    async def test_oversize_spawn_batch_is_not_sent_and_empty_whitelist_stays_empty(self):
        with self.assertRaises(ValueError):
            game.constrain_spawn({"task":"", "batch":[{"task":"x"}]*3})
        data = game.constrain_spawn({"task":"x","allowed_tools":[]})
        self.assertEqual(data["allowed_tools"], [])
        batch = game.constrain_spawn({"task":"", "batch":json.dumps([{"task":"复盘"},{"task":"规划", "allowed_tools":["memory_search","lua"]}])})
        self.assertEqual(batch["batch"][1]["allowed_tools"], ["memory_search"])

    async def test_review_does_not_overwrite_public_body_state_or_leak_memory(self):
        self.lane.project("tool_sent", "native-command")
        before = (self.workspace / "game-public-status.json").read_bytes()
        middleware = game.PublicTools(self.lane, review=True)
        prompt = await middleware.on_system_prompt(None, "private memory")
        self.assertIn("后台复盘", prompt)
        self.assertEqual(before, (self.workspace / "game-public-status.json").read_bytes())

    async def test_current_atomic_memory_preserves_real_citation_without_fabricated_entry(self):
        payload = {"hits":[{"memory":{"text":"旧事实", "artifact":{"family":"atomic-memory","artifact_id":"actual-id","revision":3}},
                            "score":0.03,"matched_by":["text","vector"]}]}
        hit = game.normalize_memory_hits(payload)[0]
        self.assertEqual(hit["text"], "旧事实")
        self.assertEqual(hit["citation"]["memory_ref"]["artifact_id"], "actual-id")
        self.assertNotIn("entry_id", hit["citation"])

    async def test_legacy_memory_entry_citations_remain_exact(self):
        hit = {"text":"entry", "score":0.5,"matched_by":["fts"],
               "citation":{"memory_ref":{"family":"memory","artifact_id":"old-id","revision":2},
                           "entry_id":"entry-real","entry_version_id":"version-real"}}
        self.assertEqual(game.normalize_memory_hits({"hits":[hit]})[0], hit)

    async def test_malformed_remote_memory_is_rejected_without_inventing_fields(self):
        for payload in ({}, {"hits":[{}]}, {"hits":[{"memory":{"text":"x","artifact":{}}, "score":float("nan"),"matched_by":[]}]},
                        {"hits":[{"text":"x","score":0.1,"matched_by":[],"citation":{"memory_ref":{"family":"memory","artifact_id":"x","revision":1}}}]}):
            with self.assertRaises(ValueError):
                game.normalize_memory_hits(payload)

    async def test_memory_bridge_denies_scope_switch_without_network_and_writes_once(self):
        native = NS(config=NS(scope_id="private-scope"), _http=NS(post=AsyncMock()), remember=AsyncMock(),close=AsyncMock())
        bridge = game.PowerContextClientBridge(native)
        with self.assertRaises(ValueError):
            await bridge.search(query="x", scope_id="other-player")
        with self.assertRaises(ValueError):
            await bridge.search(query="")
        native._http.post.assert_not_called()
        native.remember.side_effect = TimeoutError()
        with self.assertRaises(TimeoutError):
            await bridge.remember(kind="fact",text="x")
        native.remember.assert_awaited_once()

    async def test_review_native_react_budget_is_separate_from_body(self):
        review = self.review()
        await game.GameEnter().run(review)
        review.agent = NS(react_config=NS(max_iters=12))
        await game.ReviewBudget().run(review)
        self.assertEqual(review.agent.react_config.max_iters, 6)
        await game.GameLeave().run(review)
        body = self.context()
        body.agent = NS(react_config=NS(max_iters=12))
        await game.ReviewBudget().run(body)
        self.assertEqual(body.agent.react_config.max_iters, 12)

    async def test_each_body_tool_invalidates_old_review_snapshot_even_within_a_turn(self):
        old = self.lane.revision
        async def downstream():
            self.assertNotEqual(self.lane.revision, old)
            yield game.tool_result({"status":"unknown"})
        middleware = game.PublicTools(self.lane)
        result = [item async for item in middleware.on_acting(None, {"tool_call":NS(name="command")}, downstream)]
        self.assertEqual(len(result), 1)
        self.assertNotEqual(self.lane.revision, old)

    async def test_candidate_profile_is_scoped_and_preserves_old_memory_and_host_policies(self):
        source = {"active_model":{"model":"unchanged"},"running":{"loop":{"goal":{}},
            "reme_light_memory_config":{"auto_memory_interval":5},"llm_max_qpm":12},
            "tools":{"builtin_tools":{"execute_shell_command":{"enabled":False}}}}
        result = cognition_profile(source,scope_id="server-returned-scope-id",token="in-memory-test-token")
        self.assertEqual(source["running"]["loop"]["goal"], {})
        self.assertEqual(result["active_model"], source["active_model"])
        self.assertEqual(result["running"]["reme_light_memory_config"],source["running"]["reme_light_memory_config"])
        self.assertFalse(result["tools"]["builtin_tools"]["execute_shell_command"]["enabled"])
        self.assertEqual(result["running"]["llm_max_qpm"],12)
        self.assertEqual(result["running"]["llm_max_concurrent"],3)
        pc = result["running"]["memory_backend_configs"]["qiandengji-powercontext"]
        self.assertFalse(pc["auto_memory_search_config"]["enabled"])
        self.assertEqual(pc["auto_memory_search_config"]["max_results"],2)

    async def test_profile_rejects_public_memory_endpoint_or_missing_scope_credentials(self):
        for kwargs in ({"base_url":"http://example.com:8100"},{"scope_id":""},{"token":""},
                       {"base_url":"http://user:secret@127.0.0.1:8100"}):
            values={"scope_id":"scope","token":"test-token",**kwargs}
            with self.assertRaises(ValueError): cognition_profile({},**values)


if __name__ == "__main__":
    unittest.main()
