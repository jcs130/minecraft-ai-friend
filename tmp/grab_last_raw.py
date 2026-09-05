import sys, re
txt = sys.stdin.read()
frames = txt.split('"Server thread"')[1:]
f = frames[-1]  # 最新帧
head = '"Server thread"' + f[:2000]
print(head[:2000])
