"""Build against the exact deployed 1.5.2 service; never edit a running tree."""
from pathlib import Path
import hashlib
import shutil
import sys

BASE_SHA = '086cae9d90b374af39929163ad70ee37cd6da49f2e722186585f331b340bd833'


def build(source, destination):
    source, destination = Path(source), Path(destination)
    original = source.read_bytes()
    if hashlib.sha256(original).hexdigest() != BASE_SHA:
        raise ValueError('Installed TTS source differs from the reviewed 1.5.2 baseline')
    text = original.decode('utf-8')
    def change(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise ValueError('Patch context missing or ambiguous: ' + old[:60])
        text = text.replace(old, new)
    change("from voice_catalog import VoiceCatalog", "from voice_catalog import VoiceCatalog, VoiceReference\nfrom managed_voices import ManagedVoiceCatalog, voice_route")
    change("VERSION = '1.5.2'", "VERSION = '1.6.0'")
    change('self.voices = VoiceCatalog(config)', 'self.voices = ManagedVoiceCatalog(config)')
    change("options['voice'] = self.voices.resolve(voice).id", "options['voice'] = self.voices.resolve(voice)")
    change('        if reference.id not in self._prompt_caches:', '        cache_key = (reference.id, reference.reference_sha256, reference.reference_text)\n        if cache_key not in self._prompt_caches:')
    change('self._prompt_caches[reference.id] = (prompt, style)', 'self._prompt_caches[cache_key] = (prompt, style)')
    change('self._prompt_caches.move_to_end(reference.id)', 'self._prompt_caches.move_to_end(cache_key)')
    change('next(vid for vid in self._prompt_caches if vid != self.voice)', 'next(vid for vid in self._prompt_caches if vid[0] != self.voice)')
    change('self._prompt_caches[self.voice] = (self.prompt_cache, self.style_cache)', 'default_reference = self.voices.resolve()\n            self._prompt_caches[(self.voice, default_reference.reference_sha256, default_reference.reference_text)] = (self.prompt_cache, self.style_cache)')
    change('self.cached_voice_ids = tuple(self._prompt_caches)', 'self.cached_voice_ids = tuple(dict.fromkeys(key[0] for key in self._prompt_caches))')
    change('return self._prompt_caches[reference.id]', 'return self._prompt_caches[cache_key]')
    change("        cache_hit = voice is None or voice in getattr(self, '_prompt_caches', {})", "        reference = self.voices.resolve(voice) if voice is not None else None\n        cache_hit = reference is None or (reference.id, reference.reference_sha256, reference.reference_text) in getattr(self, '_prompt_caches', {})")
    change("'voice_policy': 'configured-voice-catalog' if len(self.voices.references) > 1 else 'configured-reference-only'", "'voice_policy': 'lan-managed-voice-catalog'")
    change("        self.send_header('Content-Type', content_type)", "        self.send_header('Content-Type', content_type)\n        self.send_header('Access-Control-Allow-Origin', '*')")
    change('    def do_GET(self):\n', '    def do_OPTIONS(self):\n        self.send_response(204)\n        self.send_header("Access-Control-Allow-Origin", "*")\n        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")\n        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")\n        self.send_header("Content-Length", "0")\n        self.end_headers()\n\n    def do_PUT(self):\n        if not voice_route(self):\n            self.reply(404, b\'{"error":"not found"}\')\n\n    do_DELETE = do_PUT\n\n    def do_GET(self):\n        if voice_route(self):\n            return\n')
    change('    def do_POST(self):\n', '    def do_POST(self):\n        if voice_route(self):\n            return\n')
    change('voice=voice.id,\n                    observe=', 'voice=voice,\n                    observe=')
    compile(text, str(source), 'exec')
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'voxcpm2_server.py').write_text(text, encoding='utf-8', newline='\n')
    shutil.copyfile(Path(__file__).with_name('managed_voices.py'), destination / 'managed_voices.py')
    return text


if __name__ == '__main__':
    build(*sys.argv[1:3])
