import asyncio
import copy
import json
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from agent_mc_autonomy.model_auth import Authorization, OAuthAttempt
from agent_mc_autonomy.model_config import HttpPlannerConfig, PRESETS, planner_settings
from agent_mc_autonomy.model_protocols import assistant_history, request, usage_metrics
from agent_mc_autonomy.planner import HttpPlanner, PlannerResponseError

TOOL = {"type": "function", "function": {"name": "observe", "description": "Read facts", "parameters": {"type": "object", "properties": {}}}}
CALL = {"id": "call_1", "type": "function", "function": {"name": "observe", "arguments": "{}"}}
BASE = [{"role": "system", "content": "stable"}, {"role": "user", "content": "facts"}]


def config(provider, **fields):
    return HttpPlannerConfig.parse({"provider": provider, "model": "chosen", "auth": {"mode": "none"}, **fields})


@pytest.mark.parametrize("protocol", ["chat", "responses"])
def test_explicit_required_tool_choice_reaches_wire_and_is_omitted_without_tools(protocol):
    cfg = config("openai-compatible", protocol=protocol, base_url="http://127.0.0.1:8000/v1",
                 parameters={"tool_choice": "required"})
    _, body = request(cfg, BASE, [TOOL], 2048)
    assert body["tool_choice"] == "required" and body["parallel_tool_calls"] is False
    assert "tool_choice" not in request(cfg, BASE, [], 2048)[1]
    assert "tool_choice" not in request(config("openai-compatible", protocol=protocol,
                                             base_url=cfg.base_url), BASE, [TOOL], 2048)[1]


@pytest.mark.parametrize("choice", ["none", "unknown", {"type": "function", "name": "invented"}])
def test_autonomy_tool_choice_cannot_disable_tools_or_force_unadvertised_functions(choice):
    with pytest.raises(ValueError, match="tool_choice"):
        config("openai-compatible", base_url="http://127.0.0.1:8000/v1", parameters={"tool_choice": choice})


def payload(protocol):
    if protocol == "chat":
        return {"choices": [{"finish_reason": "tool_calls", "message": {"content": None, "reasoning_content": "opaque-reason", "tool_calls": [CALL]}}]}
    if protocol == "responses":
        return {"status": "completed", "output": [{"id": "rs_1", "type": "reasoning", "encrypted_content": "opaque", "summary": []},
            {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "observe", "arguments": "{}"}]}
    if protocol == "anthropic":
        return {"stop_reason": "tool_use", "content": [{"type": "thinking", "thinking": "opaque", "signature": "sig"},
            {"type": "tool_use", "id": "call_1", "name": "observe", "input": {}}]}
    return {"candidates": [{"finishReason": "STOP", "content": {"role": "model", "parts": [
        {"functionCall": {"id": "call_1", "name": "observe", "args": {}}, "thoughtSignature": "sig"}]}}]}


@pytest.mark.parametrize("provider", ["deepseek", "openai", "anthropic", "google"])
def test_native_protocol_roundtrip_preserves_reasoning_and_tools(provider):
    cfg, seen = config(provider), []
    def serve(req):
        seen.append(req)
        return httpx.Response(200, json=payload(cfg.protocol))
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            brain = HttpPlanner(cfg, 2048, 10, client=client)
            first = await brain.decide(BASE, [TOOL])
            call = first["tool_calls"][0]
            history = BASE + [assistant_history(first), {"role": "tool", "tool_call_id": call["id"], "content": "observed"}]
            original = copy.deepcopy(history)
            await brain.decide(history, [TOOL])
            assert history == original
            wire = json.loads(seen[-1].content)
            text = json.dumps(wire)
            assert "_provider_state" not in text and "observed" in text
            if cfg.protocol == "chat":
                assert wire["messages"][2]["reasoning_content"] == "opaque-reason"
            elif cfg.protocol == "responses":
                assert wire["input"][2]["encrypted_content"] == "opaque"
                assert wire["input"][-1]["call_id"] == "call_1" and wire["store"] is False
            elif cfg.protocol == "anthropic":
                assert wire["messages"][1]["content"][0]["signature"] == "sig"
                assert wire["messages"][-1]["content"][0]["tool_use_id"] == "call_1"
            else:
                assert wire["contents"][1]["parts"][0]["thoughtSignature"] == "sig"
                assert wire["contents"][-1]["parts"][0]["functionResponse"]["id"] == "call_1"
    asyncio.run(run())


@pytest.mark.parametrize("provider", PRESETS)
def test_explicit_presets_and_no_default_model(provider):
    fields = {"base_url": "http://127.0.0.1:8000/v1"} if provider == "openai-compatible" else {}
    cfg = config(provider, **fields)
    assert cfg.model == "chosen" and cfg.protocol == PRESETS[provider][0]
    with pytest.raises(ValueError):
        HttpPlannerConfig.parse({"provider": provider, **fields})
    assert planner_settings({}) is None


@pytest.mark.parametrize("change", [
    {"parameters": {"messages": []}}, {"parameters": {"tools": []}}, {"parameters": {"max_tokens": 5}},
    {"parameters": {"temperature": True}}, {"parameters": {"top_p": 3}}, {"parameters": {"temperature": float("nan")}},
    {"parameters": {"stop": "bad"}}, {"parameters": {"thinking": "on"}}, {"auth": {"access_token": "secret"}},
    {"provider": "unknown"}, {"stream": 1}, {"protocol": "unknown"},
])
def test_invalid_parameters_are_rejected_before_network(change):
    with pytest.raises(ValueError):
        HttpPlannerConfig.parse({"provider": "deepseek", "model": "chosen", **change})


@pytest.mark.parametrize("provider,parameters,key", [
    ("qwen", {"enable_thinking": True, "thinking_budget": 2000, "top_p": .8}, "enable_thinking"),
    ("deepseek", {"thinking": {"type": "enabled"}, "reasoning_effort": "high"}, "reasoning_effort"),
    ("openai", {"reasoning": {"effort": "high"}, "text": {"verbosity": "low"}}, "reasoning"),
    ("anthropic", {"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}}, "thinking"),
    ("google", {"thinkingConfig": {"thinkingBudget": 1000}, "topK": 20}, "thinkingConfig"),
])
def test_native_parameters_exact_not_silently_dropped(provider, parameters, key):
    cfg = config(provider, parameters=parameters)
    _, body = request(cfg, BASE, [TOOL], 4096)
    assert (body.get("generationConfig") or body)[key] == parameters[key]
    assert "extra_body" not in body


@pytest.mark.parametrize("provider,header", [("openai", "authorization"), ("anthropic", "x-api-key"), ("google", "x-goog-api-key")])
def test_keys_headers_and_rotation_from_environment(provider, header, monkeypatch):
    cfg = config(provider, api_key_env="TEST_PROVIDER_KEY", auth={"mode": "api_key"})
    monkeypatch.setenv("TEST_PROVIDER_KEY", "first")
    auth = Authorization(cfg)
    assert "first" in asyncio.run(auth.headers(None))[header if header != "authorization" else "Authorization"]
    monkeypatch.setenv("TEST_PROVIDER_KEY", "second")
    assert "second" in asyncio.run(auth.headers(None))[header if header != "authorization" else "Authorization"]


def sse(rows):
    return "".join("data: " + (r if isinstance(r, str) else json.dumps(r)) + "\n\n" for r in rows)


def stream_rows(p):
    if p == "chat":
        return [
            {"choices": [{"index": 0, "delta": {"reasoning_content": "reason", "tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": "observe", "arguments": "{"}}]}}]},
            {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": "}"}}]}, "finish_reason": "tool_calls"}]},
            {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3}}, "[DONE]"]
    if p == "responses":
        return [{"type": "response.output_item.added", "item": {"type": "function_call"}}, {"type": "response.completed", "response": payload(p)}]
    if p == "anthropic":
        return [{"type": "message_start", "message": {"usage": {"input_tokens": 12}}},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "call_1", "name": "observe", "input": {}}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": "{}"}},
            {"type": "content_block_stop", "index": 0},
            {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 3}}, {"type": "message_stop"}]
    return [payload(p)]


@pytest.mark.parametrize("provider", ["deepseek", "openai", "anthropic", "google"])
def test_stream_tools_only_after_valid_terminal(provider):
    cfg = config(provider, stream=True)
    rows = stream_rows(cfg.protocol)
    async def run(data, success):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=data, headers={"content-type": "text/event-stream"}))) as client:
            planner = HttpPlanner(cfg, 2048, 5, client=client)
            if success:
                result = await planner.decide(BASE, [TOOL])
                assert result["tool_calls"] == [CALL] and result["model_status"]["first_output_ms"] is not None
            else:
                with pytest.raises(PlannerResponseError):
                    await planner.decide(BASE, [TOOL])
    asyncio.run(run(sse(rows), True))
    asyncio.run(run(sse(rows[:-1]), False))
    asyncio.run(run(sse(rows) + sse([{"error": {"message": "private"}}]), False))


def test_images_native_and_cross_provider_state_is_not_forwarded():
    image = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
    messages = BASE + [{"role": "user", "content": [{"type": "text", "text": "look"}, image]},
                       {"role": "assistant", "content": "reply", "_provider_state": {"scope": "other", "data": "do-not-send"}}]
    for provider in ("openai", "anthropic", "google"):
        _, body = request(config(provider, image_input=True), messages, [], 1000)
        assert "AAAA" in json.dumps(body) and "do-not-send" not in json.dumps(body)


def test_usage_unknown_stays_unknown_and_caches_are_counted():
    assert usage_metrics("chat", {}) == {}
    assert usage_metrics("responses", {"input_tokens_details": {"cached_tokens": 9}, "output_tokens_details": {"reasoning_tokens": 4}}) == {"cached_tokens": 9, "reasoning_tokens": 4}
    assert usage_metrics("anthropic", {"input_tokens": 10, "cache_read_input_tokens": 40, "cache_creation_input_tokens": 20})["prompt_tokens"] == 70


class Vault:
    def __init__(self, path, value):
        self.lock_path, self.value = path, value
    def load(self):
        return copy.deepcopy(self.value)
    def save(self, value):
        self.value = copy.deepcopy(value)


def oauth_config(provider="openai"):
    return config(provider, stream=True, auth={"mode": "oauth", "client_id": "google-client" if provider == "google" else ""})


def test_oauth_pkce_state_account_binding_and_dynamic_client():
    cfg = oauth_config()
    attempt = OAuthAttempt(cfg, "http://127.0.0.1:4567/auth/callback")
    url = parse_qs(urlsplit(attempt.url()).query)
    assert url["client_id"] == ["dynamic_agent_client"] and url["code_challenge_method"] == ["S256"]
    assert attempt.verifier not in attempt.url()
    captured = []
    def serve(req):
        captured.append(parse_qs(req.content.decode()))
        return httpx.Response(200, json={"access_token": "access", "token_type": "Bearer", "expires_in": 3600,
                                        "refresh_token": "refresh", "id_token": "signed", "scope": "chatgpt.tokens.use.direct"})
    async def verify(_client, provider, token, client_id, nonce=None):
        assert (provider, token, client_id, nonce) == ("openai", "signed", "oaiapp_issued", attempt.nonce)
        return "subject"
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            saved = await attempt.complete("code=code&state="+attempt.state+"&client_id=oaiapp_issued", client, verify=verify)
            assert saved["subject"] == "subject" and saved["client_id"] == "oaiapp_issued"
            assert captured[0]["client_id"] == ["oaiapp_issued"]
            with pytest.raises(RuntimeError, match="consumed"):
                await attempt.complete("", client, verify=verify)
            bad = OAuthAttempt(cfg, "http://127.0.0.1:4567/auth/callback")
            with pytest.raises(RuntimeError, match="state"):
                await bad.complete("code=code&state=wrong", client, verify=verify)
            assert len(captured) == 1
    asyncio.run(run())


def test_oauth_refresh_rotates_once_and_reloads_for_other_process(tmp_path):
    cfg = oauth_config()
    vault = Vault(tmp_path, {"provider": "openai", "subject": "subject", "client_id": "oaiapp_real", "refresh_token": "old",
                            "access_token": "expired", "expires_at": 0, "scope": "chatgpt.tokens.use.direct"})
    seen = []
    def serve(req):
        seen.append(parse_qs(req.content.decode()))
        return httpx.Response(200, json={"access_token": "new", "refresh_token": "rotated", "token_type": "Bearer", "expires_in": 3600})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            auth = Authorization(cfg, store=vault)
            assert await asyncio.gather(auth.token(client), auth.token(client)) == ["new", "new"]
            assert await Authorization(cfg, store=vault).token(client) == "new"
    asyncio.run(run())
    assert len(seen) == 1 and seen[0]["refresh_token"] == ["old"] and vault.value["refresh_token"] == "rotated"
    assert vault.value["expires_at"] > time.time()


@pytest.mark.parametrize("fields", [{"stream": False}, {"protocol": "chat"}, {"base_url": "https://proxy.test/v1"}])
def test_openai_oauth_official_stateless_stream_only(fields):
    with pytest.raises(ValueError):
        config("openai", auth={"mode": "oauth"}, **fields)


def test_auth_error_does_not_leak_token_or_retry(tmp_path):
    cfg = oauth_config()
    vault = Vault(tmp_path, {"provider": "openai", "subject": "x", "client_id": "oaiapp_real", "refresh_token": "private"})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(400, text="private"))) as client:
            with pytest.raises(RuntimeError, match="^brain_oauth_reauthorization_required$"):
                await Authorization(cfg, store=vault).token(client)
    asyncio.run(run())
    assert vault.value["refresh_token"] == "private"


def test_controller_keeps_native_history_on_both_text_and_tool_turns(framework_module, tmp_path, run_async):
    from test_controller import setup, choose
    from dataclasses import replace
    state = {"scope": "test-scope", "data": {"reasoning_content": "signed-content"}}
    responses = [dict(choose(), _provider_state=state), {"content": "waiting", "tool_calls": [], "_provider_state": state}]
    async def decide(*_):
        return responses.pop(0)
    module, _, controller = setup(framework_module, tmp_path, decide)
    controller.settings = replace(controller.settings, max_tool_rounds=1)
    run_async(controller.turn_once("goal", "rules", module.model_tools(controller.bridge.tools)))
    assert controller.groups[-1][0]["_provider_state"] == state
    controller.inflight_request = None
    controller.pending.clear()
    run_async(controller.turn_once("goal", "rules", module.model_tools(controller.bridge.tools)))
    assert controller.groups[-1][0]["_provider_state"] == state


def test_oidc_signature_nonce_audience_and_expiry_verified():
    jwt = pytest.importorskip("jwt")
    pytest.importorskip("cryptography")
    from cryptography.hazmat.primitives.asymmetric import rsa
    from agent_mc_autonomy.model_auth import identity
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    public["kid"] = "test-key"
    claims = {"iss": "https://auth.openai.com", "aud": "oaiapp_real", "sub": "subject", "exp": int(time.time())+1000, "nonce": "nonce"}
    token = jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"keys": [public]}))) as client:
            assert await identity(client, "openai", token, "oaiapp_real", "nonce") == "subject"
            for audience, nonce in [("other-client", "nonce"), ("oaiapp_real", "wrong")]:
                with pytest.raises(RuntimeError, match="identity_invalid"):
                    await identity(client, "openai", token, audience, nonce)
            expired = jwt.encode({**claims, "exp": 1}, key, algorithm="RS256", headers={"kid": "test-key"})
            with pytest.raises(RuntimeError, match="identity_invalid"):
                await identity(client, "openai", expired, "oaiapp_real", "nonce")
    asyncio.run(run())


def test_stream_timeout_and_cancel_close_response_without_retry():
    class Slow(httpx.AsyncByteStream):
        closed = False
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            await asyncio.sleep(10)
        async def aclose(self):
            self.closed = True
    stream = Slow()
    seen = []
    def serve(req):
        seen.append(req)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=stream)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            planner = HttpPlanner(config("deepseek", stream=True), 1000, .01, client=client)
            with pytest.raises(RuntimeError, match="transport_error"):
                await planner.decide(BASE, [TOOL])
    asyncio.run(run())
    assert stream.closed and len(seen) == 1


def test_config_copies_parameters_and_rejects_impossible_thinking_budget():
    params = {"thinking": {"type": "enabled", "budget_tokens": 1024}}
    cfg = config("anthropic", parameters=params)
    params["thinking"]["budget_tokens"] = 2000
    assert cfg.parameters["thinking"]["budget_tokens"] == 1024
    with pytest.raises(ValueError, match="less_than_output"):
        HttpPlanner(cfg, 1024, 30)
    cfg.validate_budget(2048)


def test_catalog_and_login_config_do_not_need_a_model_or_start_game():
    from agent_mc_autonomy.model_admin import list_models
    cfg = HttpPlannerConfig.parse({"provider": "google", "auth": {"mode": "none"}}, require_model=False)
    assert not cfg.model
    seen = []
    def serve(req):
        seen.append(req)
        return httpx.Response(200, json={"models": [{"name": "models/example", "displayName": "Account model"}], "nextPageToken": "next"})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            result = await list_models(cfg, client=client)
            assert result["models"] == [{"id": "example", "label": "Account model"}]
            assert result["has_more"] and not result["inference_called"] and not result["game_started"]
    asyncio.run(run())
    assert len(seen) == 1 and seen[0].method == "GET" and seen[0].url.path == "/v1beta/models"
