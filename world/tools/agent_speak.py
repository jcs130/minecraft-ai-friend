#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""agent_speak.py — Agent 在游戏里说话（语音 + 文字泡泡一键）

用法：
  python agent_speak.py --entity Kirito --text "你好世界" --voice kirito
  python agent_speak.py --entity Kirito --text "只在头顶显示文字" --text-only
  python agent_speak.py --entity Kirito --text "只发语音" --voice-only

前提：
  - voice/tts 容器在跑（SVC 近大远小语音 + text_display 文字泡泡）
  - RCON 密码从容器 server.properties 读取（不硬编码）
"""
import argparse
import json
import subprocess
import sys
import time
import hashlib
import uuid as uuid_mod
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

MC = 'qiandengji-mc-1'
VOICE = 'qiandengji-voice-1'
GODVOICE = '/godvoice'


def sh(cmd, timeout=30):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout,
                       encoding='utf-8', errors='replace')
    return ((r.stdout or '') + (r.stderr or '')).replace('\x00', '')


def rcon(cmd):
    """RCON with -- for negative coords."""
    return sh(f'docker exec {MC} rcon-cli -- {cmd}')


def get_entity_pos(name):
    """Get entity position via RCON data get."""
    raw = rcon(f'data get entity {name} Pos')
    # Format: [x, y, z] as doubles
    import re
    m = re.search(r'\[([-\d.]+)[dD,\s]*([-\d.]+)[dD,\s]*([-\d.]+)[dD\s]*\]', raw)
    if m:
        return float(m.group(1)), float(m.group(2)), float(m.group(3))
    return None


def get_entity_uuid(name):
    """Get entity UUID via RCON."""
    raw = rcon(f'data get entity {name} UUID')
    # Try to extract UUID from the response
    import re
    m = re.search(r'([I;\s]*[-\d]+[,\s]*[-\d]+[,\s]*[-\d]+[,\s]*[-\d]+)', raw)
    if not m:
        return None
    # The UUID is stored as 4 ints, convert to standard format
    ints = re.findall(r'(-?\d+)', m.group(1))
    if len(ints) < 4:
        return None
    try:
        import struct
        b = b''.join(struct.pack('>i', int(x)) for x in ints[:4])
        return str(uuid_mod.UUID(bytes=b))
    except (ValueError, struct.error):
        return None


KNOWN_UUIDS = {
    'Kirito': 'd4ac9523-4962-43ed-98c5-19b49e104048',
    'Goddess': None,  # mineflayer bot, different mechanism
}


def resolve_entity(name):
    if name in KNOWN_UUIDS and KNOWN_UUIDS[name]:
        return KNOWN_UUIDS[name]
    uuid = get_entity_uuid(name)
    if uuid:
        return uuid
    print(f'⚠ 无法获取 {name} 的 UUID，尝试用已知值')
    return KNOWN_UUIDS.get(name)


def submit_speech(entity_name, entity_uuid, text, voice, dimension='minecraft:overworld'):
    """Write speech request to voice container queue."""
    key = f'{entity_name}:{time.time()}'
    speech_id = 'speech-' + hashlib.sha256((entity_uuid + '\0' + key).encode()).hexdigest()[:40]
    now_ms = int(time.time() * 1000)
    job = {
        'schema': 2, 'id': speech_id, 'entity': entity_uuid,
        'actor': entity_name, 'text': text.strip()[:160],
        'voiceId': voice, 'voiceVersion': 1, 'generation': 1,
        'dimension': dimension,
        'createdAt': now_ms, 'expiresAt': now_ms + 60000,
        'turnId': f'speak-{uuid_mod.uuid4().hex[:8]}',
    }
    # Write to temp then docker cp
    import tempfile, os
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(job, f, ensure_ascii=False)
        tmp = f.name
    sh(f'docker cp "{tmp}" {VOICE}:{GODVOICE}/speech-requests/{speech_id}.json')
    os.unlink(tmp)
    return speech_id


def spawn_text_bubble(x, y, z, text, scale=2):
    """Spawn text_display entity above position."""
    safe_text = text.replace("'", "\\'").replace('"', '\\"')[:100]
    # Calculate duration: roughly 1 word per 0.5s for Chinese
    duration = max(3, len(text) * 0.3)
    cmd = (f'summon minecraft:text_display {x:.1f} {y + 2.5:.1f} {z:.1f} '
           f'{{text:\'["{safe_text}"]\',billboard:"center",background:0.3}}')
    result = rcon(cmd)
    return 'text_display' in result.lower() or 'Summoned' in result or result.strip() == ''


def clean_text_bubbles(x, y, z, radius=5):
    """Kill text_display entities near position."""
    rcon(f'kill @e[type=text_display,distance=..{radius}]')


def main():
    parser = argparse.ArgumentParser(description='Agent speak: voice + text bubble')
    parser.add_argument('--entity', required=True, help='Entity name (e.g. Kirito)')
    parser.add_argument('--text', required=True, help='Text to speak (max 160 chars)')
    parser.add_argument('--voice', default='kirito', help='Voice ID (kirito/naruto/goddess/villager)')
    parser.add_argument('--text-only', action='store_true', help='Only show text bubble, no voice')
    parser.add_argument('--voice-only', action='store_true', help='Only voice, no text bubble')
    parser.add_argument('--duration', type=float, default=None, help='Text bubble duration (auto if not set)')
    args = parser.parse_args()

    if len(args.text) > 160:
        print('⚠ 文本超 160 字，截断')
        args.text = args.text[:160]

    # Get entity position
    pos = get_entity_pos(args.entity)
    if not pos:
        print(f'✗ 无法获取 {args.entity} 位置（可能不在线）')
        sys.exit(1)
    print(f'  位置: ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f})')

    # Voice
    if not args.text_only:
        entity_uuid = resolve_entity(args.entity)
        if entity_uuid:
            speech_id = submit_speech(args.entity, entity_uuid, args.text, args.voice)
            print(f'  语音已提交: {speech_id[:20]}… (voice={args.voice})')
        else:
            print('  ⚠ 无法解析 UUID，跳过语音')

    # Text bubble
    if not args.voice_only:
        ok = spawn_text_bubble(pos[0], pos[1], pos[2], args.text)
        if ok:
            dur = args.duration or max(3, len(args.text) * 0.3)
            print(f'  文字泡泡已召唤 ({dur:.0f}s 后消失)')
            # Schedule cleanup
            import threading
            threading.Timer(dur, lambda: clean_text_bubbles(pos[0], pos[1], pos[2])).start()
        else:
            print(f'  ⚠ 文字泡泡可能失败')

    print('✓ 完成')


if __name__ == '__main__':
    main()
