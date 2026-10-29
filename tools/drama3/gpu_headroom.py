"""Reserve NVIDIA memory during Drama 3 placement on a 24 GB Vulkan GPU.

speech.cpp chooses how many routed expert layers fit on Vulkan at model load.
Temporarily occupying VRAM makes it place a few more layers on the CPU; the
reservation is released before the server accepts synthesis requests.
"""

from __future__ import annotations

from contextlib import contextmanager
import ctypes as c
from collections.abc import Iterator


def _cuda_function(dll: object, name: str, *types: object) -> object:
    function = getattr(dll, name)
    function.argtypes = list(types)
    function.restype = c.c_int
    return function


@contextmanager
def reserve_nvidia_vram(mebibytes: int) -> Iterator[None]:
    """Hold a CUDA allocation on GPU 0 while speech.cpp measures free VRAM."""
    if mebibytes <= 0:
        yield
        return
    driver = c.WinDLL("nvcuda.dll")
    init = _cuda_function(driver, "cuInit", c.c_uint)
    get_device = _cuda_function(driver, "cuDeviceGet", c.POINTER(c.c_int), c.c_int)
    create = _cuda_function(driver, "cuCtxCreate_v2", c.POINTER(c.c_void_p), c.c_uint, c.c_int)
    alloc = _cuda_function(driver, "cuMemAlloc_v2", c.POINTER(c.c_uint64), c.c_size_t)
    free = _cuda_function(driver, "cuMemFree_v2", c.c_uint64)
    destroy = _cuda_function(driver, "cuCtxDestroy_v2", c.c_void_p)
    device = c.c_int()
    context = c.c_void_p()
    address = c.c_uint64()

    def check(status: int, step: str) -> None:
        if status != 0:
            raise RuntimeError(f"CUDA VRAM reservation {step} failed (CUresult {status})")

    check(init(0), "initialization")
    check(get_device(c.byref(device), 0), "device selection")
    check(create(c.byref(context), 0, device), "context creation")
    try:
        check(alloc(c.byref(address), mebibytes * 1024 * 1024), "allocation")
        yield
    finally:
        try:
            if address.value:
                check(free(address), "release")
        finally:
            check(destroy(context), "context destruction")
