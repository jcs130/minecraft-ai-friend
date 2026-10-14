"""Optional local input-token counting, owned by the selected planner adapter."""

from __future__ import annotations

import copy
import re
from typing import Protocol


FRAMING_RESERVE = 1024
BYTE_COUNTER_NAME = "utf8-byte-upper-bound+1024-framing"


class ContextCounter(Protocol):
    """Count input tokens synchronously without model, network or game calls.

    Implementations must be deterministic and match the selected model, protocol conversion and chat
    template, including tools and native history. ``name`` is a stable public
    identifier, never a credential or request text. Output tokens, framework
    framing slack and the separately attached image reserve are not included.
    If an optional ``units`` attribute is provided, it must equal ``tokens``.
    The adapter is responsible for invalidating a stale model/template binding.
    """

    name: str

    def __call__(self, messages: list[dict], tools: list[dict]) -> int: ...


class CounterUnavailable(Exception):
    """Only the failure type crosses the adapter's diagnostic boundary."""


def counter_name(counter: ContextCounter) -> str:
    try:
        name = counter.name
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,95}", name):
            raise ValueError("invalid_counter_name")
        if getattr(counter, "units", "tokens") != "tokens":
            raise ValueError("invalid_counter_units")
        return name
    except Exception as error:
        raise CounterUnavailable(type(error).__name__) from None


def count_input(counter: ContextCounter, messages: list[dict], tools: list[dict]) -> int:
    try:
        # An adapter may normalize its working copy; it cannot alter history or
        # the inputs needed when the entire assembly must restart in byte mode.
        value = counter(*copy.deepcopy((messages, tools)))
        if type(value) is not int:
            raise TypeError("invalid_counter_result")
        if value < 0:
            raise ValueError("invalid_counter_result")
        return value
    except Exception as error:
        raise CounterUnavailable(type(error).__name__) from None
