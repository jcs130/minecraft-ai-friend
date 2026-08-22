"""云端 TTS 合成（edge-tts，微软 Edge 朗读服务）。
用法: python tts_edge_synth.py --text "你好" --voice zh-CN-XiaoxiaoNeural --rate +0% --pitch +0Hz
输出: 音频字节（MP3）写 stdout（无日志污染）。
"""
import argparse
import asyncio
import sys


async def synth(text: str, voice: str, rate: str, pitch: str) -> bytes:
    import edge_tts
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    audio = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
    return bytes(audio)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--voice", default="zh-CN-XiaoxiaoNeural")
    ap.add_argument("--rate", default="+0%")
    ap.add_argument("--pitch", default="+0Hz")
    args = ap.parse_args()
    audio = asyncio.run(synth(args.text, args.voice, args.rate, args.pitch))
    sys.stdout.buffer.write(audio)
    return 0


if __name__ == "__main__":
    sys.exit(main())
