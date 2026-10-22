"""Explicit provider configuration. Presets are chosen by users, never discovered."""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field, replace
from urllib.parse import urlsplit

# Model IDs deliberately have no defaults: availability and capabilities are account specific.
PRESETS = {
    "openai-compatible": ("chat", "", ""),
    "openai": ("responses", "https://api.openai.com/v1", "OPENAI_API_KEY"),
    "anthropic": ("anthropic", "https://api.anthropic.com/v1", "ANTHROPIC_API_KEY"),
    "google": ("gemini", "https://generativelanguage.googleapis.com/v1beta", "GEMINI_API_KEY"),
    "qwen": ("chat", "https://dashscope.aliyuncs.com/compatible-mode/v1", "DASHSCOPE_API_KEY"),
    "deepseek": ("chat", "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"),
    "kimi": ("chat", "https://api.moonshot.cn/v1", "MOONSHOT_API_KEY"),
    "glm": ("chat", "https://open.bigmodel.cn/api/paas/v4", "ZAI_API_KEY"),
    "doubao": ("chat", "https://ark.cn-beijing.volces.com/api/v3", "ARK_API_KEY"),
    "siliconflow": ("chat", "https://api.siliconflow.cn/v1", "SILICONFLOW_API_KEY"),
}

PARAMETERS = {
    "chat": {"temperature", "top_p", "top_k", "seed", "stop", "presence_penalty", "frequency_penalty",
             "reasoning_effort", "thinking", "enable_thinking", "thinking_budget", "response_format",
             "min_p", "repetition_penalty", "chat_template_kwargs"},
    "responses": {"temperature", "top_p", "reasoning", "text", "service_tier", "prompt_cache_key", "prompt_cache_retention"},
    "anthropic": {"temperature", "top_p", "top_k", "stop_sequences", "thinking", "output_config", "service_tier"},
    "gemini": {"temperature", "topP", "topK", "seed", "stopSequences", "presencePenalty", "frequencyPenalty",
               "thinkingConfig", "responseMimeType", "responseSchema", "responseJsonSchema", "mediaResolution"},
}


def text(value, name, *, empty=True):
    if (not isinstance(value, str) or value != value.strip() or len(value) > 2048
            or any(ord(c) < 32 for c in value) or (not empty and not value)):
        raise ValueError("brain_" + name + "_invalid")
    return value


def endpoint(value):
    text(value, "endpoint", empty=False)
    url = urlsplit(value)
    if (url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password
            or url.query or url.fragment or any(c.isspace() for c in value) or "{" in value):
        raise ValueError("brain_endpoint_invalid")
    url.port
    return value.rstrip("/")


def environment(name):
    text(name, "key_environment")
    if name and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise ValueError("brain_key_environment_invalid")
    return name


def secret(name):
    value = os.environ.get(name, "") if name else ""
    if name and (not value or any(ord(c) < 32 for c in value)):
        raise ValueError("brain_key_environment_missing_or_invalid")
    return value


@dataclass(frozen=True)
class AuthConfig:
    mode: str = "api_key"  # api_key | bearer | none | oauth | google_adc
    credential_id: str = "agent-mc"
    client_id: str = ""
    client_secret_env: str = ""
    quota_project: str = ""

    @classmethod
    def parse(cls, raw):
        if not isinstance(raw, dict) or set(raw) - cls.__dataclass_fields__.keys():
            raise ValueError("brain_auth_invalid")
        result = cls(**raw)
        for name, value in vars(result).items():
            text(value, "auth_" + name)
        if result.mode not in {"api_key", "bearer", "none", "oauth", "google_adc"}:
            raise ValueError("brain_auth_mode_invalid")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", result.credential_id):
            raise ValueError("brain_credential_id_invalid")
        environment(result.client_secret_env)
        return result


def validate_parameters(protocol, raw):
    if not isinstance(raw, dict) or set(raw) - PARAMETERS[protocol]:
        raise ValueError("brain_parameters_unsupported_for_protocol")
    try:
        data = json.dumps(raw, allow_nan=False)
    except (ValueError, TypeError, RecursionError):
        raise ValueError("brain_parameters_invalid") from None
    if len(data) > 32768:
        raise ValueError("brain_parameters_too_large")
    for name, value in raw.items():
        bounds = {"temperature": (0, 1 if protocol == "anthropic" else 2), "top_p": (0, 1), "topP": (0, 1),
                  "min_p": (0, 1), "presence_penalty": (-2, 2), "frequency_penalty": (-2, 2),
                  "presencePenalty": (-2, 2), "frequencyPenalty": (-2, 2), "repetition_penalty": (0, 2)}
        if name in bounds:
            lo, hi = bounds[name]
            if type(value) not in {int, float} or not math.isfinite(value) or not lo <= value <= hi:
                raise ValueError("brain_sampling_parameter_invalid")
        elif name in {"top_k", "topK", "seed", "thinking_budget"}:
            if type(value) is not int or (name != "seed" and value < 0):
                raise ValueError("brain_integer_parameter_invalid")
        elif name == "enable_thinking" and type(value) is not bool:
            raise ValueError("brain_thinking_parameter_invalid")
        elif name in {"thinking", "reasoning", "text", "output_config", "thinkingConfig", "response_format",
                      "responseSchema", "responseJsonSchema", "chat_template_kwargs"} and not isinstance(value, dict):
            raise ValueError("brain_object_parameter_invalid")
        elif name in {"stop", "stop_sequences", "stopSequences"}:
            if not isinstance(value, list) or not 1 <= len(value) <= 16 or not all(isinstance(s, str) and s for s in value):
                raise ValueError("brain_stop_parameter_invalid")
        elif name in {"reasoning_effort", "service_tier", "prompt_cache_key", "prompt_cache_retention", "responseMimeType", "mediaResolution"}:
            text(value, "parameter", empty=False)
    thinking = raw.get("thinking", {})
    if thinking.get("type") == "enabled" and protocol == "anthropic":
        budget = thinking.get("budget_tokens")
        if type(budget) is not int or budget < 1024:
            raise ValueError("brain_thinking_budget_invalid")
    return json.loads(data)


@dataclass(frozen=True)
class HttpPlannerConfig:
    # Keep the original positional constructor compatible with existing consumers.
    base_url: str = ""
    model: str = ""
    api_key_env: str = ""
    output_parameter: str = "max_tokens"
    image_input: bool = False
    provider: str = "openai-compatible"
    protocol: str = "chat"
    stream: bool = False
    parameters: dict = field(default_factory=dict)
    auth: AuthConfig = field(default_factory=AuthConfig)
    organization: str = ""
    project: str = ""
    anthropic_version: str = "2023-06-01"
    anthropic_beta: str = ""

    @classmethod
    def parse(cls, raw, *, require_model=True):
        if not isinstance(raw, dict) or set(raw) - cls.__dataclass_fields__.keys():
            raise ValueError("brain_config_invalid")
        provider = raw.get("provider", "openai-compatible")
        if not isinstance(provider, str) or provider not in PRESETS:
            raise ValueError("brain_provider_invalid")
        protocol, url, key = PRESETS[provider]
        values = {"provider": provider, "protocol": protocol, "base_url": url, "api_key_env": key, **raw}
        # Empty URL/key in a form means the selected preset, never a discovered service.
        values["base_url"] = values["base_url"] or url
        values["api_key_env"] = values["api_key_env"] or key
        values["protocol"] = values["protocol"] or protocol
        values["auth"] = AuthConfig.parse(raw.get("auth", {}))
        result = cls(**values)
        if not isinstance(result.protocol, str) or result.protocol not in PARAMETERS:
            raise ValueError("brain_protocol_invalid")
        endpoint(result.base_url)
        text(result.model, "model", empty=not require_model)
        environment(result.api_key_env)
        for name in ("organization", "project", "anthropic_version", "anthropic_beta"):
            text(getattr(result, name), name)
        if type(result.image_input) is not bool or type(result.stream) is not bool:
            raise ValueError("brain_capability_invalid")
        if result.output_parameter not in {"max_tokens", "max_completion_tokens"}:
            raise ValueError("brain_output_parameter_invalid")
        result = replace(result, parameters=validate_parameters(result.protocol, result.parameters))
        if (result.organization or result.project) and result.protocol not in {"chat", "responses"}:
            raise ValueError("brain_openai_headers_require_compatible_protocol")
        if result.auth.mode in {"oauth", "google_adc"}:
            if result.provider not in {"google", "openai"} or endpoint(result.base_url) != PRESETS[result.provider][1]:
                raise ValueError("brain_oauth_requires_official_endpoint")
            if result.provider == "openai" and (result.protocol != "responses" or result.auth.mode == "google_adc" or not result.stream):
                raise ValueError("brain_openai_oauth_requires_streamed_responses")
            if result.provider == "google" and result.protocol != "gemini":
                raise ValueError("brain_google_oauth_requires_gemini")
        if result.auth.mode == "bearer" and not result.api_key_env:
            raise ValueError("brain_bearer_environment_required")
        return result

    def key(self):
        return secret(self.api_key_env) if self.auth.mode in {"api_key", "bearer"} else ""

    def validate_budget(self, budget):
        if type(budget) is not int or not 1 <= budget <= 131072:
            raise ValueError("brain_output_budget_invalid")
        if self.protocol == "anthropic" and self.parameters.get("thinking", {}).get("budget_tokens", 0) >= budget:
            raise ValueError("brain_thinking_budget_must_be_less_than_output")


def planner_settings(raw):
    """Shared form/adapter entry: host remains the default model owner."""
    if not isinstance(raw, dict):
        raise ValueError("brain_config_invalid")
    route = raw.get("route", "host")
    if route not in {"host", "direct", "harnessrouter"}:
        raise ValueError("brain_route_invalid")
    config = {k: v for k, v in raw.items() if k != "route"}
    if route == "harnessrouter":
        from .harness_router import HarnessRouterConfig
        return HarnessRouterConfig.parse(config)
    if route == "host":
        # Disabled draft must not accept credential literals or unknown fields.
        if set(config) - HttpPlannerConfig.__dataclass_fields__.keys():
            raise ValueError("brain_config_invalid")
        if "auth" in config:
            AuthConfig.parse(config["auth"])
        return None
    return HttpPlannerConfig.parse(config)
