import zipfile
jar = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\mods\touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'
z = zipfile.ZipFile(jar)
names = z.namelist()
# json/资源里的 chat 站点默认模板
res = [n for n in names if n.endswith(('.json', '.toml', '.txt', '.md')) and any(k in n.lower() for k in ['chat', 'llm', 'tts', 'stt', 'site'])]
print('=== resource files ===')
for n in res[:40]:
    print(n)
# class 里跟 chat site 管理相关的
cls = [n for n in names if n.endswith('.class') and ('chatsite' in n.lower() or 'ChatSite' in n or 'LLMSite' in n or 'TTSSite' in n or 'STTSite' in n)]
print('=== classes ===')
for n in cls[:40]:
    print(n)
