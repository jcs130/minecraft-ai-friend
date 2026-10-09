#!/usr/bin/env python3
"""Read Particle Studio's Java 1.20.5+ exact .mcfunction export as data, never execute it.

Outputs a JSON object (also valid YAML) to merge under skill-visuals.yml's effects.
Standard library only. No network, game command execution, eval, or live config writes.
"""
import argparse
import json
import math
from pathlib import Path
import re

SIMPLE = {'end_rod': 'END_ROD', 'cloud': 'CLOUD', 'flame': 'FLAME',
          'soul_fire_flame': 'SOUL_FIRE_FLAME', 'snowflake': 'SNOWFLAKE',
          'heart': 'HEART', 'crit': 'CRIT', 'electric_spark': 'ELECTRIC_SPARK',
          'portal': 'PORTAL', 'enchant': 'ENCHANT'}
NUM = r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?'
COMMAND = re.compile(r'execute as @a at @s run particle minecraft:([a-z_]+)(\{.*\})?'
                     r' ~(' + NUM + r')? ~(' + NUM + r')? ~(' + NUM + r')? 0 0 0 0 1(?: (?:normal|force))?$')


def vector(config, name):
    m = re.search(r'\b' + name + r':\s*\[([^\]]+)\]', config)
    if not m:
        raise ValueError('dust 缺少 ' + name)
    values = m[1].split(',')
    if len(values) != 3:
        raise ValueError('颜色需要3个分量')
    rgb = []
    for v in values:
        value = float(v.strip().rstrip('fF'))
        if not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError('颜色分量需要0..1')
        rgb.append(round(value * 255))
    return '#' + ''.join(f'{v:02X}' for v in rgb)


def convert(text, skill, max_points=32):
    if not re.fullmatch(r'[a-z_]{2,32}', skill) or not 12 <= max_points <= 64:
        raise ValueError('技能ID或点预算无效')
    # The complete upstream export contains a coarse option first. Import exact option only.
    marker = next((i for i, line in enumerate(text.splitlines())
                   if '方案二：精确复刻预览形状' in line), None)
    lines = text.splitlines()[marker + 1:] if marker is not None else text.splitlines()
    groups = {}
    for line_number, line in enumerate(lines, 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        m = COMMAND.fullmatch(line)
        if not m:
            raise ValueError(f'第{line_number}行不是精确单点粒子；选择Java1.20.6和方案二导出')
        name, cfg, *xyz = m.groups()
        point = [float(v or 0) for v in xyz]
        if any(not math.isfinite(v) or abs(v) > 8 for v in point):
            raise ValueError('坐标须在施法者周围-8..8格')
        color = end = '#FFFFFF'
        size = .75
        if name in ('dust', 'dust_color_transition'):
            if not cfg:
                raise ValueError('请选择1.20.6的SNBT dust导出')
            color = vector(cfg, 'color' if name == 'dust' else 'from_color')
            end = color if name == 'dust' else vector(cfg, 'to_color')
            scale = re.search(r'\bscale:\s*(' + NUM + r')[fF]?', cfg)
            if not scale:
                raise ValueError('缺少dust scale')
            size = float(scale[1])
            if not math.isfinite(size) or not .3 <= size <= 1.5:
                raise ValueError('dust尺寸需要0.3..1.5')
            particle = name.upper()
        elif name in SIMPLE and cfg is None:
            particle = SIMPLE[name]
        else:
            raise ValueError('不支持的1.20.6粒子或复杂参数：' + name)
        key = (particle, color, end, size)
        groups.setdefault(key, []).append(point)
        if sum(map(len, groups.values())) > 4096:
            raise ValueError('最多接受4096个输入点，请先在编辑器降低数量')
    if not 1 <= len(groups) <= 3:
        raise ValueError('需要1..3组粒子/颜色/尺寸；每组对应一个图层')
    sizes = [len(p) for p in groups.values()]
    allocations = [1] * len(sizes)
    for _ in range(min(max_points, sum(sizes)) - len(sizes)):
        available = [i for i, n in enumerate(sizes) if allocations[i] < min(n, 48)]
        if not available:
            break
        i = max(available, key=lambda i: sizes[i] / allocations[i])
        allocations[i] += 1
    layers = []
    for ((particle, color, end, size), points), count in zip(groups.items(), allocations):
        sampled = [points[min(len(points)-1, int(i * len(points) / count))] for i in range(count)]
        layers.append({'shape': 'points', 'particle': particle, 'size': size, 'color': color,
                       'color-end': end, 'spin': .2, 'expand': .15, 'lift': 0, 'points': sampled})
    effect = {'skills': [skill], 'anchor': 'caster', 'duration-ticks': 24,
              'interval-ticks': 3, 'layers': layers}
    return {skill + '_studio': effect}, sum(sizes), sum(allocations)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input', type=Path)
    p.add_argument('--skill', required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--max-points', type=int, default=32)
    a = p.parse_args()
    if not a.input.is_file():
        p.error('输入导出文件不存在，请先从粒子工坊下载.mcfunction')
    if a.input.stat().st_size > 262144:
        p.error('导出文件不得超过256 KiB')
    if a.output.exists():
        p.error('输出文件已存在，请换一个文件名避免覆盖')
    try:
        data, before, after = convert(a.input.read_text(encoding='utf-8-sig'), a.skill, a.max_points)
    except (ValueError, OSError) as e:
        p.error(str(e))
    a.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'已提取 {before} 点，均匀保留 {after} 点；将输出合入effects并移除旧的同技能绑定，再执行 mycli admin visuals reload。')


if __name__ == '__main__':
    main()
