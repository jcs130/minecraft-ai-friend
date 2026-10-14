#!/usr/bin/env python3
"""Adapt official Denizen b7074's field descriptor to Paper 1.21.1 build 133.

The Spigot-compiled Handler references CraftMagicNumbers.INSTANCE as UnsafeValues.
Paper exposes the same INSTANCE as CraftMagicNumbers. JVM field resolution includes
the descriptor; Paper's package remapping alone cannot resolve this reference.
Only that constant-pool reference changes. The mapping fingerprint comparison and
all method bytecode remain intact. This does NOT make newer Denizen NMS compatible.

Input: https://ci.citizensnpcs.co/job/Denizen_Developmental/7074/artifact/target/
       Denizen-1.3.1-b7074-DEV.jar
Retain Denizen's original license and archive entries.
Use separate output, offline, and only with the pinned Paper target above.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct
import zipfile

SOURCE_SHA256 = '39fd071423735b00a21f36c8c356760b2c70b0bf2c2b7898c7238b90dd9ee37a'
CLASS = 'com/denizenscript/denizen/nms/v1_21/Handler.class'
OWNER = b'org/bukkit/craftbukkit/v1_21_R1/util/CraftMagicNumbers'
OLD = b'Lorg/bukkit/UnsafeValues;'
NEW = b'L' + OWNER + b';'


def patch_class(data):
    if data[:4] != b'\xca\xfe\xba\xbe':
        raise ValueError('Not a Java class')
    count = struct.unpack_from('>H', data, 8)[0]
    entries = [None] * count
    offsets = {}
    pos, index = 10, 1
    while index < count:
        start = pos
        tag = data[pos]
        pos += 1
        if tag == 1:
            length = struct.unpack_from('>H', data, pos)[0]
            pos += 2
            entries[index] = (tag, data[pos:pos + length])
            pos += length
        elif tag in (7, 8, 16, 19, 20):
            entries[index] = (tag, struct.unpack_from('>H', data, pos)[0])
            pos += 2
        elif tag in (9, 10, 11, 12, 17, 18):
            entries[index] = (tag, *struct.unpack_from('>HH', data, pos))
            pos += 4
        elif tag in (3, 4):
            entries[index] = (tag,)
            pos += 4
        elif tag in (5, 6):
            entries[index] = (tag,)
            pos += 8
            offsets[index] = start
            index += 1
        elif tag == 15:
            entries[index] = (tag,)
            pos += 3
        else:
            raise ValueError(f'Unsupported constant-pool tag {tag}')
        offsets[index] = start
        index += 1
    matches = []
    for entry in entries[1:]:
        if not entry or entry[0] != 9:
            continue
        owner, name_type = entries[entry[1]], entries[entry[2]]
        if (entries[owner[1]][1] == OWNER and
                entries[name_type[1]][1] == b'INSTANCE' and
                entries[name_type[2]][1] == OLD):
            matches.append(entry[2])
    if len(matches) != 1:
        raise ValueError(f'Expected one original INSTANCE field reference, got {len(matches)}')
    target = matches[0]
    references = sum(1 for e in entries if e and e[0] in (9, 10, 11, 17, 18) and e[2] == target)
    if references != 1 or count == 65535:
        raise ValueError('Descriptor is shared or constant pool is full')
    result = bytearray(data[:pos])
    struct.pack_into('>H', result, 8, count + 1)
    struct.pack_into('>H', result, offsets[target] + 3, count)
    result.extend(b'\x01' + struct.pack('>H', len(NEW)) + NEW)
    result.extend(data[pos:])
    # No method code, fingerprint, or other class member may change.
    assert result[pos + 3 + len(NEW):] == data[pos:]
    return bytes(result)


def patch_archive(source, output):
    source, output = Path(source), Path(output)
    if source.resolve() == output.resolve() or output.exists():
        raise ValueError('Output must be a new, separate file')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError('Not the pinned official Denizen 1.3.1-b7074 artifact')
    with zipfile.ZipFile(source) as original:
        names = original.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive entries')
        if any(n.upper().startswith('META-INF/') and n.upper().endswith(('.SF', '.RSA', '.DSA')) for n in names):
            raise ValueError('Cannot alter a signed archive')
        changed = patch_class(original.read(CLASS))
        with zipfile.ZipFile(output, 'x') as patched:
            for info in original.infolist():
                # ZipFile.writestr mutates ZipInfo.header_offset; never share it
                # with the source reader used for the integrity comparison.
                patched.writestr(copy.copy(info), changed if info.filename == CLASS else original.read(info))
        with zipfile.ZipFile(output) as patched:
            if patched.testzip() is not None:
                raise ValueError('Output CRC failed')
            unchanged = sum(original.read(n) == patched.read(n) for n in names if n != CLASS)
            assert unchanged == len(names) - 1
    return dict(sourceSha256=digest, outputSha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                changedEntries=[CLASS], unchangedEntries=unchanged, methodBytecodeUnchanged=True,
                target='Paper 1.21.1 build 133', productionModified=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    if args.report.exists():
        parser.error('Report exists; retain earlier attempts')
    report = patch_archive(args.source, args.output)
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
