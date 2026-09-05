import sys
grab = False
t = 0
out = []
for line in sys.stdin:
    if '"Server thread"' in line:
        grab = True; t = 0
        out.append('==== DUMP ====')
        out.append(line.rstrip())
        continue
    if grab:
        out.append(line.rstrip())
        t += 1
        if t >= 14:
            grab = False
print('\n'.join(out[:80]))
