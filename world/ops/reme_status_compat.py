"""Skip ReMe binding declarations in its process-local memory statistics.

ReMe retains ``Dependency`` objects in ``_binding_specs`` after resolving a
component. They are metadata, not components owned by the object graph. The
native size walker probes their ``__dict__`` and incorrectly raises the lazy
dependency's access-before-start error. Only that walker is patched; memory
search, component startup and the Dependency class keep their native behavior.
"""
import hashlib
import importlib.metadata
import inspect

VERSION = 1
QWEN_VERSION = '2.2.0'
REME_VERSION = '0.4.1.10'
SOURCE_SHA256 = '6a7cfdcd60618e2f4ade39d0c70187209722a8112e6c9af2d4d444528a388a5d'
_ANCHOR = '        if isinstance(value, BaseComponent) and value_id != root_id:\n'
_GUARD = '        if isinstance(value, Dependency):\n            return 0\n'
_MARKER = '_qiandeng_reme_status_compat'


def patch_source(source, qwen_version, reme_version):
    """Refuse upstream drift instead of silently replacing its size algorithm."""
    if (qwen_version, reme_version) != (QWEN_VERSION, REME_VERSION):
        raise ValueError('review_new_reme_status_versions')
    if hashlib.sha256(source.encode('utf-8')).hexdigest() != SOURCE_SHA256:
        raise ValueError('review_new_reme_status_source')
    if source.count(_ANCHOR) != 1:
        raise ValueError('review_new_reme_status_anchor')
    return source.replace(_ANCHOR, _GUARD + _ANCHOR, 1)


def install(runtime):
    """Called by the existing startup hook; never edits site-packages on disk."""
    if runtime not in ('game', 'operations'):
        raise ValueError('invalid_reme_status_runtime')
    qwen_version = importlib.metadata.version('qwenpaw')
    reme_version = importlib.metadata.version('reme-ai')
    if (qwen_version, reme_version) != (QWEN_VERSION, REME_VERSION):
        raise ValueError('review_new_reme_status_versions')
    from reme.components.base_component import Dependency
    from reme.steps.common import status
    original = status._component_size
    if getattr(original, _MARKER, None) == VERSION:
        return VERSION
    source = patch_source(inspect.getsource(original), qwen_version, reme_version)
    namespace = dict(original.__globals__)
    namespace['Dependency'] = Dependency
    exec(compile(source, '<qiandeng-reme-status-compat>', 'exec'), namespace)
    patched = namespace['_component_size']
    setattr(patched, _MARKER, VERSION)
    status._component_size = patched
    return VERSION
