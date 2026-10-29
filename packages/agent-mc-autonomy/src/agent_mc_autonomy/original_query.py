"""Validation shared by local original reads and explicit offline reconciliation."""


def original_query_error(arguments):
    if not isinstance(arguments, dict):
        return "mc_original requires an object."
    handle = arguments.get("handle")
    offset, limit = arguments.get("offset", 0), arguments.get("limit", 1000)
    if (
        not isinstance(handle, str)
        or not 1 <= len(handle) <= 1024
        or any(ord(char) < 32 for char in handle)
        or type(offset) is not int
        or offset < 0
        or type(limit) is not int
        or not 1 <= limit <= 1000
    ):
        return "mc_original requires a nonempty handle, integer offset >= 0, and integer limit 1..1000. Read longer originals using next_offset; no native request was dispatched."
    return None
