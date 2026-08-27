#!/usr/bin/env python3
"""Host-side TCP relay: expose Docker Desktop loopback-only published ports to the LAN.

Why this exists (2026-08-27):
  Docker Desktop on this box publishes container ports but Windows netstat shows NO
  LISTENING socket on them; they are only reachable via a transparent loopback
  redirect. LAN clients cannot connect to <host-ip>:<port> directly.
  netsh portproxy does NOT work on this machine (no listener is ever created),
  and both the Windows firewall layer and the Hyper-V firewall layer were ruled out
  by controlled experiments (allow rules changed nothing).
  Root fix: run a tiny asyncio relay bound on 0.0.0.0 that pumps bytes to the
  loopback-only destination.

Usage:
    python host_tcp_relay.py --listen-port 25599 --target-host 127.0.0.1 --target-port 25599

Register (elevated) as logon auto-start tasks if desired:
    schtasks /Create /TN "MCHostRelay25599" /SC ONLOGON /TR "python ... --listen-port 25599 ..." /RL HIGHEST
"""
import argparse
import asyncio
import sys

CONN_TIMEOUT = 5.0
IDLE_TIMEOUT = 3600 * 6


async def pump(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    peer = client_writer.get_extra_info("peername")
    try:
        target_reader, target_writer = await asyncio.wait_for(
            asyncio.open_connection(args.target_host, args.target_port), timeout=CONN_TIMEOUT
        )
    except Exception as exc:
        print(f"[relay:{args.listen_port}] refused {peer}: {exc}", flush=True)
        try:
            client_writer.close()
        except Exception:
            pass
        return
    print(f"[relay:{args.listen_port}] connected {peer}", flush=True)
    task_a = asyncio.create_task(pump(client_reader, target_writer))
    task_b = asyncio.create_task(pump(target_reader, client_writer))
    _done, pending = await asyncio.wait({task_a, task_b}, timeout=IDLE_TIMEOUT,
                                        return_when=asyncio.FIRST_COMPLETED)
    for t in pending:
        t.cancel()
    for w in (client_writer, target_writer):
        try:
            w.close()
        except Exception:
            pass
    print(f"[relay:{args.listen_port}] closed {peer}", flush=True)


args = None


async def main() -> int:
    global args
    parser = argparse.ArgumentParser(description="loopback-to-LAN TCP relay")
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--target-host", default="127.0.0.1")
    parser.add_argument("--target-port", type=int, required=True)
    args = parser.parse_args()

    server = await asyncio.start_server(handle, host="0.0.0.0", port=args.listen_port)
    print(f"[relay:{args.listen_port}] listening on 0.0.0.0 -> {args.target_host}:{args.target_port}", flush=True)
    async with server:
        await server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
