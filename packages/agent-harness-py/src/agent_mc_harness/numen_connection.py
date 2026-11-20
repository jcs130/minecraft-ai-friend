"""Supervision for an existing Numen body and its original action journal."""
import asyncio


def can_reopen(host):
    if host.role.body_kind != "numen":
        return True
    port = host.body.port
    # A rejected fence, unlike a transport failure, can mean another driver owns the body.
    return not port.lost or port.disconnected.is_set()


async def run_with_connection(host):
    """End this actor run on transport loss so the service can reopen the same identity."""
    actor = asyncio.create_task(host.run())
    disconnected = asyncio.create_task(host.body.port.disconnected.wait())
    try:
        done, _ = await asyncio.wait((actor, disconnected), return_when=asyncio.FIRST_COMPLETED)
        if actor in done:
            return actor.result()
        raise ConnectionError("numen_transport_disconnected")
    finally:
        for task in (actor, disconnected):
            task.cancel()
        await asyncio.gather(actor, disconnected, return_exceptions=True)
