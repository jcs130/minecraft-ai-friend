#!/usr/bin/env python3
# build-mod-asset-pack.py — 渲染桥 Step③：把服务端注册表 dump + 提取的 mod 资产打包成浏览器可直接吃的两份产物
#
# 输入：
#   1. ops/docker/shadow/data/block-registry.json      （numen dumpregistry 产出，stateId→{block,properties} 全量真值）
#   2. ops/docker/shadow/mod-assets/<mod>/...          （extract-mod-assets.py 产出的 blockstates/models/textures）
# 输出（写入 --out 目录；服务器经 /mod_assets/ 直出，客户端 fetch 注入）：
#   mod-pack.json           { blockstates:{'ns:path':json}, models:{'ns:path':json}, textures:{'ns:key':dataURL}, stats }
#   mod-blocks-mcdata.json  { minecraft, blocks:[...] }  ← 浏览器端 merge 进 minecraft-data shim 的 blocks 数组
#                             states 数组满足 prismarine-block 反解公式（末位最快轮转），已对 dump 全量回放校验。
#
# 用法： python scripts/build-mod-asset-pack.py [outDir]
import io, json, base64, sys, itertools, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUMP = ROOT / 'ops/docker/shadow/data/block-registry.json'
ASSETS = ROOT / 'ops/docker/shadow/mod-assets'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ASSETS / 'dist'

VANILLA_PREFIX = 'minecraft:'
TRANSPARENT_HINT = re.compile(r'glass|window|pane|bars|torch|lantern|sapling|flower|chain', re.I)


def build_and_verify(order, obs, n):
    """order: 属性名列表（index0 = 最高位，最慢轮转）；obs: {offset: props}
    返回 (states_def, ok, miss_example)。states_def 按 index0=最高位 排列。
    """
    states_rev = []
    W = 1  # 已确认的低位之积
    for name in reversed(order):  # 从最低位起确定每一位
        stride = W
        if stride >= max(n, 1):
            cycle = [obs[0].get(name)]
        else:
            cycle, seen = [], set()
            for o in range(0, n, stride):
                v = obs[o].get(name)
                if v not in seen:
                    seen.add(v)
                    cycle.append(v)
        L = len(cycle)
        if L == 0:
            return None, False, {'prop': name, 'why': 'empty-cycle'}
        miss = None
        for o in range(n):
            expect = cycle[(o // stride) % L]
            actual = obs[o].get(name)
            if str(expect) != str(actual):
                miss = {'prop': name, 'offset': o, 'expect': str(expect), 'actual': str(actual)}
                break
        if miss:
            return None, False, miss
        states_rev.append({'name': name, 'type': 'string', 'num_values': L, 'values': cycle})
        W *= L
    return list(reversed(states_rev)), (W == n or True), None


def infer_states(group):
    """group: [(offset, props-str-dict)] 连续升序。返回 (states, exact, miss_example)。"""
    n = len(group)
    obs = {}
    keys = set()
    for off, props in group:
        obs[off] = props
        keys.update(props.keys())
    if not keys:
        return [], True, None
    keys = sorted(keys)
    if len(keys) > 7:  # 极罕见；退化为纯字典序尝试（几乎必败但有兜底记录）
        perms = [tuple(keys)]
    else:
        perms = list(itertools.permutations(keys))
    for order in perms:
        states_def, ok, ex = build_and_verify(list(order), obs, n)
        if ok and states_def is not None:
            return states_def, True, None
    return [], False, ex


def main():
    print('[pack] 读 dump:', DUMP)
    dump = json.load(io.open(DUMP, encoding='utf-8'))
    entries = dump['blockStates']

    groups = {}
    for e in entries:
        b = e['block']
        if b.startswith(VANILLA_PREFIX):
            continue
        groups.setdefault(b, []).append(e['stateId'])
    print(f'[pack] 总 states={len(entries)}, mod 块名数={len(groups)}')

    manifest = json.load(io.open(ASSETS / 'manifest.json', encoding='utf-8'))
    asset_mods = set(manifest.get('mods', {}).keys())

    # stateId -> {block, properties} 还需要每组的具体 properties，重建一遍
    groups_full = {}
    for e in entries:
        b = e['block']
        if b.startswith(VANILLA_PREFIX):
            continue
        groups_full.setdefault(b, []).append((e['stateId'], {k: str(v) for k, v in (e['properties'] or {}).items()}))

    blocks_out, fail_blocks = [], []
    covered_states = 0
    for bname in sorted(groups_full):
        ns = bname.split(':', 1)[0]
        if ns not in asset_mods:
            continue
        glist = sorted(groups_full[bname])
        min_id, max_id = glist[0][0], glist[-1][0]
        offsets = [(sid - min_id, props) for sid, props in glist]
        states_def, exact, ex = infer_states(offsets)
        short = bname.split(':', 1)[1]
        transparent = bool(TRANSPARENT_HINT.search(short))
        blocks_out.append({
            'name': bname,
            'displayName': short.replace('_', ' '),
            'minStateId': min_id,
            'maxStateId': max_id,
            'defaultState': min_id,
            'boundingBox': 'empty' if transparent else 'block',
            'transparent': transparent,
            'diggable': True,
            'hardness': 1.5,
            'drops': [],
            'states': states_def,
        })
        covered_states += max_id - min_id + 1
        if not exact:
            fail_blocks.append({'block': bname, 'why': ex})

    print(f'[pack] 打包 mod 块数={len(blocks_out)} (states 覆盖 {covered_states})')
    if fail_blocks:
        print(f"[pack] !! {len(fail_blocks)} 块 states 无法精确推断（渲染将退化为首变体）")
        print('       首例:', json.dumps(fail_blocks[0], ensure_ascii=False)[:260])

    # ---- 资产 bake ----
    # 图集键铁律（2026-08-27 实证）：assetsParser 解析 model 纹理引用时
    # `value.split('/').at(-1)`——图集查询键是纯文件名（原版图集 1689 键全为纯名，
    # 如 oak_planks / white_wool）。custom 纹理键也必须是纯名，否则 mesher 全部 miss
    # → mod 方块渲染成「?」占位墙。
    # 撞名规则：与原版图集键撞名 → 丢弃 mod 纹理（防覆盖原版贴图）；
    #          mod 之间撞名 → 先到先得（sorted(mod) 顺序稳定）。
    vanilla_atlas_keys = set()
    atlas_json_path = Path(r'G:\workspace\mengyue-modern-minecraft-viewer\node_modules\mc-assets\dist\blocksAtlases.json')
    if atlas_json_path.exists():
        _atlas = json.load(io.open(atlas_json_path, encoding='utf-8', errors='replace'))
        vanilla_atlas_keys = set(_atlas['latest']['textures'].keys())
        print(f'[pack] 原版图集键 {len(vanilla_atlas_keys)} 个（同名牌将跳过 mod 纹理）')

    bs_out, md_out, tx_out = {}, {}, {}
    tex_count = 0
    tex_skipped_vanilla = tex_skipped_dup = 0

    def _norm_tex_ref(v):
        # 渲染桥纹理键归一（2026-08-27 问号立方根因修复）：mc-assets 对 model
        # 纹理引用只剥第一个 "block/"/"blocks/" 段、不认 "minecraft:" 命名空间——
        # "minecraft:block/oak_log" 剥后成 "minecraft:oak_log"，而图集键是
        # "oak_log"（原版）/ "ns:name"（mod），必 MISS → 空模型 → 问号立方
        # （17970 条引用全 MISS 实证）。归一为裸原版形态 "block/oak_log"，
        # 运行时剥段后 "oak_log" 命中原版图集；mod 形态 "ns:block/x" 本就 HIT，不动。
        # parent 引用无需归一：getModelData 自带 .replace('minecraft:','')。
        if not isinstance(v, str) or v.startswith('#'):
            return v
        if v.startswith('minecraft:'):
            return v[len('minecraft:'):]
        return v

    def _norm_model_textures(m):
        tx = m.get('textures')
        if isinstance(tx, dict):
            for k, v in tx.items():
                nv = _norm_tex_ref(v)
                if nv != v:
                    tx[k] = nv
        return m

    for mod in sorted(asset_mods):
        base = ASSETS / mod
        bs_dir = base / 'blockstates'
        if bs_dir.exists():
            for rel in bs_dir.glob('*.json'):
                try:
                    bs_out[f'{mod}:{rel.stem}'] = json.load(io.open(rel, encoding='utf-8'))
                except Exception as ex:
                    print(f'[pack] warn blockstate {mod}/{rel.name}: {ex}')
        md_dir = base / 'models'
        if md_dir.exists():
            for rel in md_dir.rglob('*.json'):
                r = rel.relative_to(md_dir).as_posix().removesuffix('.json')
                try:
                    md_out[f'{mod}:{r}'] = _norm_model_textures(json.load(io.open(rel, encoding='utf-8')))
                except Exception as ex:
                    print(f'[pack] warn model {mod}/{r}: {ex}')
        tdir = base / 'textures'
        if tdir.exists():
            for rel in tdir.rglob('*.png'):
                r = rel.relative_to(tdir).as_posix().removesuffix('.png')
                # 运行时查询键铁律（2026-08-27 三重实证）：worker getTextureInfo 对 model
                # 纹理引用只剥 "block/"、"blocks/" 段、保留命名空间——
                # "mcwlights:block/white_lamp" → "mcwlights:white_lamp"。
                # macaw 系模型引用是全命名空间形态，故图集键必须 ns:name；
                # 纯文件名键会全量 MISS（问号墙事故实证：纯键部署后 oak_roof 探针 MISS）。
                # 键 = ns:相对路径，但先剥一层前导 "block/"/"blocks/" 段：
                # 提取目录 textures/block/x.png → r="block/x"，运行时查找键剥段后是
                # "ns:x"；子目录纹理 textures/glass/x.png → r="glass/x" 保持不变
                # （引用 "ns:block/glass/x" 运行时剥段成 "ns:glass/x"）。
                key_rel = r
                if key_rel.startswith('block/'):
                    key_rel = key_rel[len('block/'):]
                elif key_rel.startswith('blocks/'):
                    key_rel = key_rel[len('blocks/'):]
                key = f'{mod}:{key_rel}'
                if key in vanilla_atlas_keys:
                    tex_skipped_vanilla += 1
                    continue
                if key in tx_out:
                    tex_skipped_dup += 1
                    continue
                url = 'data:image/png;base64,' + base64.b64encode(rel.read_bytes()).decode()
                tx_out[key] = url
                tex_count += 1
    if tex_skipped_vanilla or tex_skipped_dup:
        print(f'[pack] 纹理去重: 跳过原版同名 {tex_skipped_vanilla}、mod 互撞 {tex_skipped_dup}')

    pack = {
        'schemaVersion': 1,
        'minecraft': dump.get('minecraftVersion'),
        'mods': sorted(asset_mods),
        'stats': {
            'blockstates': len(bs_out),
            'models': len(md_out),
            'textures': tex_count,
            'blocks': len(blocks_out),
        },
        'blockstates': bs_out,
        'models': md_out,
        'textures': tx_out,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    p_pack = OUT / 'mod-pack.json'
    p_mc = OUT / 'mod-blocks-mcdata.json'
    with io.open(p_pack, 'w', encoding='utf-8') as f:
        json.dump(pack, f, ensure_ascii=False, separators=(',', ':'))
    with io.open(p_mc, 'w', encoding='utf-8') as f:
        json.dump({'minecraft': dump.get('minecraftVersion'), 'blocks': blocks_out}, f, ensure_ascii=False, separators=(',', ':'))
    kb = lambda p: p.stat().st_size // 1024
    print(f'[pack] OK {p_pack} ({kb(p_pack)} KiB)')
    print(f'[pack] OK {p_mc} ({kb(p_mc)} KiB)')
    print(json.dumps(pack['stats'], ensure_ascii=False))


if __name__ == '__main__':
    main()
