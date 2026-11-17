from __future__ import annotations

import logging
import asyncio


def main() -> None:
    import uvicorn

    from .app import create_app
    from .config import load_settings
    from .service import GraphitiService

    settings = load_settings()
    if settings.host not in ("127.0.0.1", "localhost", "::1") and not settings.token():
        raise SystemExit("Refusing to bind a non-loopback address without AGENT_MEMORY_SIDECAR_TOKEN_ENV")
    logging.getLogger("agent_memory_sidecar").info(
        "driver=%s llm=%s embedder=%s", settings.driver, settings.llm.describe(), settings.embedder.describe())
    async def serve():
        app = create_app(GraphitiService(settings), settings.token())
        await uvicorn.Server(uvicorn.Config(app, host=settings.host, port=settings.port, log_level="info")).serve()
    asyncio.run(serve())


if __name__ == "__main__":
    main()
