import asyncio
import importlib.abc
import socket
import subprocess
import sys
import threading

import pytest


class NoHosts(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, *_):
        if fullname.split(".")[0].lower() in {"plugin", "neko", "cortico"}:
            raise AssertionError("Framework must not import a host SDK: " + fullname)


sys.meta_path.insert(0, NoHosts())


@pytest.fixture
def run_async():
    with asyncio.Runner() as runner:
        yield runner.run


@pytest.fixture
def framework_module():
    import agent_mc_autonomy
    return agent_mc_autonomy


@pytest.fixture(autouse=True)
def offline(monkeypatch, run_async, request):
    # The explicit subprocess probe separately forbids network/processes after startup.
    def forbidden(*_, **__):
        raise AssertionError("Offline tests must not connect, call models or launch services")
    monkeypatch.setattr(socket, "create_connection", forbidden)
    # Windows asyncio uses a localhost socketpair for its internal wake pipe.
    original_pair, original_connect = socket.socketpair, socket.socket.connect
    internal = threading.local()
    def pair(*args, **kwargs):
        internal.creating_pair = True
        try:
            return original_pair(*args, **kwargs)
        finally:
            internal.creating_pair = False
    def connect(sock, address):
        if getattr(internal, "creating_pair", False):
            return original_connect(sock, address)
        return forbidden()
    monkeypatch.setattr(socket, "socketpair", pair)
    monkeypatch.setattr(socket.socket, "connect", connect)
    if request.node.name != "test_sdk_free_process_executes_native_queue_and_optional_brain":
        monkeypatch.setattr(subprocess, "Popen", forbidden)
