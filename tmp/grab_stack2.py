import sys
lines = sys.stdin.read().splitlines()
idx = [i for i, l in enumerate(lines) if '"Server thread"' in l]
if idx:
    i = idx[-1]
    print('\n'.join(lines[i:i+8]))
else:
    print('no dump found')
