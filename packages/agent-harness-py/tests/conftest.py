from __future__ import annotations

import asyncio
import sys
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent))


@pytest.fixture
def run() -> Callable[[Coroutine[Any, Any, Any]], Any]:
    def go(coro: Coroutine[Any, Any, Any]) -> Any:
        return asyncio.run(asyncio.wait_for(coro, 60))
    return go
