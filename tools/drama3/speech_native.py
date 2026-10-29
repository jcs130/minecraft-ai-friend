"""Small ctypes binding for speech.cpp 0.9.0's Drama 3 C API."""

from __future__ import annotations

from array import array
import ctypes as c
import json
from pathlib import Path
import threading
from typing import Callable, Protocol

from gpu_headroom import reserve_nvidia_vram


class SpeechError(RuntimeError):
    def __init__(self, status: int, message: str, option: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.option = option


class CancellationSignal(Protocol):
    def is_set(self) -> bool: ...


def _utf8(value: str | Path) -> bytes:
    return str(value).encode("utf-8")


class SpeechEngine:
    """One loaded model; the lock serializes synthesis and runtime voice addition."""

    SAMPLE_RATE = 44100
    API_MAJOR = 3
    API_MINOR = 4

    def __init__(self, dll_path: Path, model_path: Path, device: str = "Vulkan0", threads: int = 12,
                 reserve_vram_mib: int = 4096) -> None:
        self.model_path = Path(model_path)
        self.dll = c.CDLL(str(dll_path))
        self._bind()
        if (self.dll.speech_api_version_major() != self.API_MAJOR or
                self.dll.speech_api_version_minor() < self.API_MINOR):
            raise RuntimeError("speech.cpp C API 3.4 or newer is required")
        self.version = self.dll.speech_version().decode()
        if self.version != "0.9.0":
            raise RuntimeError(f"speech.cpp 0.9.0 required; found {self.version}")
        self.device = device
        self.threads = threads
        self.reserve_vram_mib = reserve_vram_mib
        self._model = c.c_void_p()
        self._lock = threading.RLock()
        self.file_info = self._read_info(self.dll.speech_model_info_open, _utf8(model_path))
        if (self.file_info.get("architecture"), self.file_info.get("task")) != ("drama3", "synthesis"):
            raise RuntimeError("model is not a Drama 3 synthesis model")
        if not self.file_info.get("voice_files") or self.file_info.get("voice_recordings"):
            raise RuntimeError("unexpected Drama 3 voice contract")
        if self.file_info.get("sample_rate") != self.SAMPLE_RATE:
            raise RuntimeError("unexpected Drama 3 sample rate")
        self.codec = self.file_info["voice_codec"]

    def _fn(self, name: str, restype: object, *argtypes: object) -> None:
        fn = getattr(self.dll, name)
        fn.restype = restype
        fn.argtypes = list(argtypes)

    def _bind(self) -> None:
        p, pp = c.c_void_p, c.POINTER(c.c_void_p)
        self._fn("speech_api_version_major", c.c_int)
        self._fn("speech_api_version_minor", c.c_int)
        self._fn("speech_version", c.c_char_p)
        self._fn("speech_last_error", c.c_char_p)
        self._fn("speech_last_error_option", c.c_char_p)
        self._fn("speech_model_info_open", c.c_int, c.c_char_p, pp)
        self._fn("speech_model_get_info", c.c_int, p, pp)
        self._fn("speech_model_info_json", c.c_char_p, p)
        self._fn("speech_model_info_free", None, p)
        self._fn("speech_load_params_new", c.c_int, pp)
        self._fn("speech_load_params_set_device", c.c_int, p, c.c_char_p)
        self._fn("speech_load_params_set_threads", c.c_int, p, c.c_int)
        self._fn("speech_load_params_set_warmup", c.c_int, p, c.c_int)
        self._fn("speech_load_params_free", None, p)
        self._fn("speech_model_load", c.c_int, c.c_char_p, p, pp)
        self._fn("speech_model_free", None, p)
        self._fn("speech_voice_add", c.c_int, p, c.c_char_p, c.c_char_p)
        self._fn("speech_voice_params_new", c.c_int, pp)
        self._fn("speech_voice_params_free", None, p)
        self._fn("speech_voice_params_add_reference", c.c_int, p, c.c_char_p)
        self._fn("speech_voice_params_set_transcript", c.c_int, p, c.c_char_p)
        self._fn("speech_voice_make_from", c.c_int, c.c_char_p, p, c.c_char_p, p)
        self._fn("speech_request_new", c.c_int, p, pp)
        self._fn("speech_request_free", None, p)
        self._fn("speech_request_cancel", None, p)
        self._fn("speech_request_set_text", c.c_int, p, c.c_char_p)
        self._fn("speech_option_from_name", c.c_int, c.c_char_p, c.POINTER(c.c_int))
        self._fn("speech_request_set_string", c.c_int, p, c.c_int, c.c_char_p)
        self._fn("speech_request_set_int", c.c_int, p, c.c_int, c.c_int64)
        self._fn("speech_request_set_float", c.c_int, p, c.c_int, c.c_double)
        self._fn("speech_request_set_bool", c.c_int, p, c.c_int, c.c_int)
        self._fn("speech_synthesize", c.c_int, p, p, p)
        self._fn("speech_request_result", p, p)
        self._fn("speech_result_stop", c.c_int, p)
        self._fn("speech_stop_name", c.c_char_p, c.c_int)
        self._fn("speech_result_seed", c.c_int64, p)
        self._fn("speech_result_samples", c.c_uint64, p)

    def _check(self, status: int) -> None:
        if status == 0:
            return
        message = self.dll.speech_last_error()
        option = self.dll.speech_last_error_option()
        raise SpeechError(status, message.decode("utf-8", "replace") if message else f"speech status {status}",
                          option.decode("utf-8", "replace") if option else "")

    def _read_info(self, fn: object, *args: object) -> dict:
        info = c.c_void_p()
        self._check(fn(*args, c.byref(info)))
        try:
            return json.loads(self.dll.speech_model_info_json(info))
        finally:
            self.dll.speech_model_info_free(info)

    def load(self) -> None:
        with self._lock:
            if self._model.value:
                return
            params = c.c_void_p()
            self._check(self.dll.speech_load_params_new(c.byref(params)))
            try:
                self._check(self.dll.speech_load_params_set_device(params, _utf8(self.device)))
                self._check(self.dll.speech_load_params_set_threads(params, self.threads))
                # Match speech serve: a short native warmup compiles the Vulkan graphs.
                self._check(self.dll.speech_load_params_set_warmup(params, 1))
                with reserve_nvidia_vram(self.reserve_vram_mib if self.device == "Vulkan0" else 0):
                    self._check(self.dll.speech_model_load(_utf8(self.model_path), params, c.byref(self._model)))
            finally:
                self.dll.speech_load_params_free(params)

    def close(self) -> None:
        with self._lock:
            if self._model.value:
                self.dll.speech_model_free(self._model)
                self._model = c.c_void_p()

    def info(self) -> dict:
        with self._lock:
            if not self._model.value:
                return self.file_info
            return self._read_info(self.dll.speech_model_get_info, self._model)

    def add_voice(self, name: str, path: Path) -> None:
        with self._lock:
            if not self._model.value:
                raise RuntimeError("model not loaded")
            self._check(self.dll.speech_voice_add(self._model, _utf8(name), _utf8(path)))

    def make_voice(self, reference_path: Path, transcript: str, output_path: Path) -> None:
        """Encode one speaker-0 reference and its exact words on the CPU."""
        voice = c.c_void_p()
        load = c.c_void_p()
        self._check(self.dll.speech_voice_params_new(c.byref(voice)))
        try:
            self._check(self.dll.speech_voice_params_add_reference(voice, _utf8(reference_path)))
            self._check(self.dll.speech_voice_params_set_transcript(voice, _utf8(transcript)))
            self._check(self.dll.speech_load_params_new(c.byref(load)))
            try:
                self._check(self.dll.speech_load_params_set_device(load, b"cpu"))
                self._check(self.dll.speech_load_params_set_threads(load, self.threads))
                self._check(self.dll.speech_voice_make_from(
                    _utf8(self.model_path), voice, _utf8(output_path), load
                ))
            finally:
                self.dll.speech_load_params_free(load)
        finally:
            self.dll.speech_voice_params_free(voice)

    def synthesize(self, text: str, options: dict, on_pcm: Callable[[bytes], None],
                   cancellation: CancellationSignal | None = None) -> dict:
        """Call the real decoder; `on_pcm` runs synchronously from the native audio callback."""
        with self._lock:
            if not self._model.value:
                raise RuntimeError("model not loaded")
            if cancellation is not None and cancellation.is_set():
                return {"samples": 0, "stop": "cancelled", "seed": options["seed"]}
            request = c.c_void_p()
            self._check(self.dll.speech_request_new(self._model, c.byref(request)))
            cancel_done = threading.Event()
            cancel_thread: threading.Thread | None = None
            try:
                self._check(self.dll.speech_request_set_text(request, _utf8(text)))
                for name, value in options.items():
                    option = c.c_int()
                    self._check(self.dll.speech_option_from_name(_utf8(name), c.byref(option)))
                    if isinstance(value, str):
                        status = self.dll.speech_request_set_string(request, option, _utf8(value))
                    elif isinstance(value, bool):
                        status = self.dll.speech_request_set_bool(request, option, int(value))
                    elif isinstance(value, int):
                        status = self.dll.speech_request_set_int(request, option, value)
                    elif isinstance(value, float):
                        status = self.dll.speech_request_set_float(request, option, value)
                    else:
                        raise ValueError(f"unsupported option type: {name}")
                    self._check(status)
                callback_error: list[Exception] = []
                count = 0

                @c.CFUNCTYPE(c.c_int, c.POINTER(c.c_float), c.c_size_t, c.c_void_p)
                def callback(samples: object, size: int, _user: object) -> int:
                    nonlocal count
                    try:
                        pcm = array("h", (
                            max(-32768, min(32767, int(float(samples[i]) * 32768)))
                            for i in range(size)
                        ))
                        on_pcm(pcm.tobytes())
                        count += size
                        return 0
                    except Exception as exc:
                        callback_error.append(exc)
                        return 1

                if cancellation is not None:
                    def cancel_when_disconnected() -> None:
                        while not cancel_done.wait(0.05):
                            if cancellation.is_set():
                                self.dll.speech_request_cancel(request)
                                return

                    cancel_thread = threading.Thread(target=cancel_when_disconnected,
                                                     name="drama3-native-cancel", daemon=True)
                    cancel_thread.start()
                    if cancellation.is_set():
                        self.dll.speech_request_cancel(request)
                status = self.dll.speech_synthesize(request, callback, None)
                if callback_error:
                    raise callback_error[0]
                if status != 1:
                    self._check(status)
                result = self.dll.speech_request_result(request)
                if not result:
                    raise RuntimeError("native synthesis returned no result")
                stop = self.dll.speech_stop_name(self.dll.speech_result_stop(result))
                native_count = self.dll.speech_result_samples(result)
                if native_count != count:
                    raise RuntimeError(f"native sample count {native_count} differs from delivered {count}")
                return {"samples": count, "stop": stop.decode(), "seed": self.dll.speech_result_seed(result)}
            finally:
                cancel_done.set()
                if cancel_thread is not None:
                    cancel_thread.join()
                self.dll.speech_request_free(request)
