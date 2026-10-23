"""An owned thread keeps async clients alive across frontend entry event loops."""

from __future__ import annotations

import asyncio
import copy
import threading
import traceback
from pathlib import Path

from .observations import runtime_error_code


class Worker:
    def __init__(self, factory, log: Path):
        self.factory, self.log = factory, log
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread = None
        self.loop = None
        self.task = None
        self.cancel_scheduled = False
        self.state = {"phase": "stopped", "game_connected": False, "autonomy_running": False}

    def publish(self, **values):
        with self.lock:
            self.state.update(values)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy({**self.state, "worker_alive": bool(self.thread and self.thread.is_alive())})

    def start(self, goal):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return False
            self.stop_event.clear()
            self.cancel_scheduled = False
            self.state = {"phase": "starting", "game_connected": False, "autonomy_running": False}
            self.thread = threading.Thread(target=self._main, args=(goal,), name="minecraft-owner", daemon=True)
            self.thread.start()
            return True

    def _main(self, goal):
        async def execute():
            with self.lock:
                self.loop, self.task = asyncio.get_running_loop(), asyncio.current_task()
            try:
                if not self.stop_event.is_set():
                    await self.factory(goal, self.publish, self.stop_event.is_set)
            except asyncio.CancelledError:
                self.publish(phase="stopped")
            except Exception as error:
                self.log.parent.mkdir(parents=True, exist_ok=True)
                with self.log.open("a", encoding="utf-8") as output:
                    traceback.print_exc(file=output)
                # Do not return provider errors, credentials or raw server text.
                self.publish(phase="failed", error=runtime_error_code(error), error_log=str(self.log))
            finally:
                self.publish(game_connected=False, autonomy_running=False)
                with self.lock:
                    self.loop = self.task = None
        with asyncio.Runner() as runner:
            runner.run(execute())

    def stop(self, timeout=20):
        with self.lock:
            self.stop_event.set()
            if self.loop and self.task and not self.cancel_scheduled:
                self.cancel_scheduled = True
                self.loop.call_soon_threadsafe(self.task.cancel)
            thread = self.thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout)
        return not (thread and thread.is_alive())
