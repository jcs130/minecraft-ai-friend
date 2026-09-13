"""Build-only readiness fix for QwenPaw 2.2.0 with the default agent disabled."""
import hashlib
import importlib.metadata
import json

VERSION = '2.2.0'
SOURCE_SHA256 = '656627f256fcdb081861019139f06c00592537751b8d10252d0f73062f5b2ad1'
ANCHOR = '''        # Build result mapping
        result_map = dict(results)
        success_count = sum(1 for success in result_map.values() if success)
'''
REPLACEMENT = '''        # Build result mapping
        result_map = dict(results)
        # Qiandengji: disabled default is intentional. Publish readiness only
        # after every configured enabled agent has actually started.
        if (
            "default" not in enabled_agents
            and result_map
            and all(result_map.values())
            and on_core_ready is not None
        ):
            try:
                on_core_ready(result_map)
            except Exception:
                logger.warning(
                    "Enabled-agent ready callback failed",
                    exc_info=True,
                )
        success_count = sum(1 for success in result_map.values() if success)
'''


def patch_source(source, version):
    if version != VERSION:
        raise ValueError('Review the readiness patch before changing QwenPaw version')
    if hashlib.sha256(source.encode('utf-8')).hexdigest() != SOURCE_SHA256:
        raise ValueError('QwenPaw source differs from the reviewed 2.2.0 release')
    if source.count(ANCHOR) != 1:
        raise ValueError('QwenPaw readiness patch context is not unique')
    return source.replace(ANCHOR, REPLACEMENT, 1)


def main():
    package = importlib.metadata.distribution('qwenpaw')
    path = package.locate_file('qwenpaw/app/multi_agent_manager.py')
    source = path.read_text(encoding='utf-8')
    patched = patch_source(source, package.version)
    compile(patched, str(path), 'exec')
    temporary = path.with_name(path.name + '.qd-patch-tmp')
    temporary.write_text(patched, encoding='utf-8')
    temporary.chmod(path.stat().st_mode)
    temporary.replace(path)
    print(json.dumps({'project': 'qiandengji', 'ok': True, 'packageVersion': VERSION,
                      'patch': 'disabled-default-readiness',
                      'sourceSha256': SOURCE_SHA256,
                      'patchedSha256': hashlib.sha256(patched.encode('utf-8')).hexdigest()}))


if __name__ == '__main__':
    main()
