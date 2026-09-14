"""Build-only patch of the reviewed native background-task lifecycle; no server state."""
import ast
import hashlib
import importlib.metadata
import json

VERSION = '2.2.0'
SOURCE_SHA256 = 'd588541a0ab41e8233ed27b4de52efe0f9ef714b49de2494b22ddac11ecd49c3'
MARKER = 'QIANDENG_ENGINEERING_TASK_RUNTIME_VERSION = 1\n'


def patch_source(source, version):
    if version != VERSION or hashlib.sha256(source.encode()).hexdigest() != SOURCE_SHA256:
        raise ValueError('review_engineering_native_background_source')
    function = next(node for node in ast.parse(source).body
                    if isinstance(node, ast.AsyncFunctionDef) and node.name == 'post_console_chat_task')
    lines = source.splitlines(keepends=True)
    body = ''.join(lines[function.lineno - 1:function.end_lineno])
    anchor = '    task_id = f"task-{uuid.uuid4().hex[:12]}"\n'
    if body.count(anchor) != 1:
        raise ValueError('engineering_native_task_anchor_changed')
    prefix, tail = body.split(anchor)
    tail = anchor + tail
    timeout_anchor = '    async def _timeout_guard() -> None:\n        nonlocal timed_out\n'
    if tail.count(timeout_anchor) != 1 or tail.count('    bg.asyncio_task = atask\n') != 1:
        raise ValueError('engineering_native_task_lifecycle_changed')
    tail = tail.replace(timeout_anchor, timeout_anchor +
        '        if effective_timeout is None:\n            return\n', 1)
    tail = tail.replace('    bg.asyncio_task = atask\n', '    bg.asyncio_task = atask\n'
        '    if _qd_admission is not None:\n        _qd_admission.attach(atask)\n', 1)
    admission = '''    from engineering_task_runtime import admit, EngineeringBusy
    try:
        _qd_admission = admit(request_data, workspace)
    except EngineeringBusy as exc:
        raise HTTPException(status_code=409, detail=exc.detail) from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid_engineering_task_admission") from exc
    if _qd_admission is not None:
        effective_timeout = None
    try:
'''
    replacement = prefix + admission + ''.join('    ' + line if line.strip() else line for line in tail.splitlines(keepends=True))
    replacement += ('\n    finally:\n        if _qd_admission is not None:\n'
                    '            _qd_admission.release_unattached()\n')
    patched = ''.join(lines[:function.lineno - 1]) + replacement + ''.join(lines[function.end_lineno:]) + '\n' + MARKER
    compile(patched, 'qwenpaw-native-engineering-tasks', 'exec')
    return patched


def main():
    package = importlib.metadata.distribution('qwenpaw')
    path = package.locate_file('qwenpaw/app/routers/console.py')
    patched = patch_source(path.read_text('utf8'), package.version)
    temp = path.with_name(path.name + '.qd-patch-tmp')
    temp.write_text(patched, encoding='utf8')
    temp.chmod(path.stat().st_mode)
    temp.replace(path)
    print(json.dumps({'ok': True, 'patch': 'scoped-engineering-native-help', 'packageVersion': VERSION,
        'sourceSha256': SOURCE_SHA256, 'patchedSha256': hashlib.sha256(patched.encode()).hexdigest()}))


if __name__ == '__main__':
    main()
