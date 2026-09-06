# -*- coding: utf-8 -*-
"""voice_pack_sync.py —— 女仆语音包 ↔ AI 聊天 TTS 音色联动。
女仆 SoundPackId（游戏内玩家选的语音包）→ 同步 MaidAIChat.TTSModel（AI 聊天用音色）。
效果：换了语音包的女仆，AI 聊天说话也立刻变成同一个嗓子。
幂等，可重复执行；由宿主 QwenPaw cron 每 5 分钟调用。
"""
import subprocess, sys

VOICE_MAP = {
    # 官方包（参考音抽自包内原声，放 /voices）
    'nahida': '/voices/nahida.wav',
    'xuanxuan_sound': '/voices/xuanxuan_sound.wav',
    'tangyuan_sound': '/voices/tangyuan_sound.wav',
    'zi_min': '/voices/zi_min.wav',
    'gugu_gaga': '/voices/gugu_gaga.wav',
    # 自家方舟包（v4 1.3.0，12 个）
    'ark_pepe': '/voices/ark_pepe.wav',
    'ark_bena': '/voices/ark_bena.wav',
    'ark_myrtle': '/voices/ark_myrtle.wav',
    'ark_golding': '/voices/ark_golding.wav',
    'ark_amiya': '/voices/ark_amiya.wav',
    'ark_texas': '/voices/ark_texas.wav',
    'ark_luo_xiaohei': '/voices/ark_luo_xiaohei.wav',
    'ark_yueyue': '/voices/ark_yueyue.wav',
    'ark_paopao': '/voices/ark_paopao.wav',
    'ark_kroos': '/voices/ark_kroos.wav',
    'ark_magallan': '/voices/ark_magallan.wav',
    'ark_durin': '/voices/ark_durin.wav',
    # 原版包（日文原声参考）
    'touhou_little_maid': '/voices/touhou_little_maid.wav',
}
FALLBACK = '/voices/ark_pepe.wav'  # 未知包兜底


def rcon(cmd):
    r = subprocess.run(['docker', 'exec', 'shadow-mc', 'rcon-cli', cmd],
                       capture_output=True, text=True, timeout=60)
    return (r.stdout or '') + (r.stderr or '')


def main():
    changed = 0
    for pack, voice in VOICE_MAP.items():
        out = rcon(
            f'execute as @e[type=touhou_little_maid:maid,nbt={{SoundPackId:"{pack}"}}] '
            f'run data modify entity @s MaidAIChat.TTSModel set value "{voice}"'
        )
        if 'Modified' in out:
            changed += 1
    print(f'voice_pack_sync: {changed} pack-group(s) updated at this tick')


if __name__ == '__main__':
    sys.exit(main())
