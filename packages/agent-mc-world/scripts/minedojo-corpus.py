"""Offline research importer/query pilot. No MineDojo, model, network or game imports.

The input corpus retains its own license. This script does not grant rights to it.
It does not extend mc_knowledge or install references in a running Agent.
"""
import argparse
from contextlib import closing
import hashlib
import html
import json
import math
from pathlib import Path
import re
import sqlite3
import sys
import time
from urllib.parse import unquote, urlsplit

SCHEMA = 'agent-mc-reference-research/v1'
LICENSE = 'CC-BY-NC-SA-3.0'
DATASET = 'https://doi.org/10.5281/zenodo.6693745'
MAX_PAGE_BYTES = 4 * 1024 * 1024
ALIASES = {
    '面包': 'bread', '小麦': 'wheat', '钓鱼': 'fishing', '甩杆': 'fishing rod',
    '鱼竿': 'fishing rod', '鞘翅': 'elytra',
    '末影珍珠': 'ender pearl', '烧炼': 'smelting',
    '熔炉': 'furnace', '营火': 'campfire', '盾牌': 'shield', '战斗': 'combat',
    '钻石': 'diamond', '镐': 'pickaxe', '村民': 'villager', '庇护': 'shelter',
}
STOP_WORDS = {'a', 'an', 'the', 'how', 'do', 'does', 'i', 'to', 'is', 'what', 'minecraft'}


def normalize(text):
    return re.sub(r'\s+', ' ', html.unescape(str(text))).strip()


def validate_tables(tables, filename):
    def valid_bbox(value):
        return isinstance(value, list) and len(value) == 4 and all(
            isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number)
            for number in value)
    for table in tables:
        if not isinstance(table, dict) or not valid_bbox(table.get('bbox')):
            raise ValueError('Invalid Wiki table bounding box: ' + filename)
        for key in ['headers', 'cells']:
            field = table.get(key)
            if (not isinstance(field, dict) or not isinstance(field.get('text'), list)
                    or not isinstance(field.get('bboxes'), list)
                    or not all(isinstance(value, str) for value in field['text'])
                    or not all(valid_bbox(box) for box in field['bboxes'])):
                raise ValueError('Invalid Wiki table cells: ' + filename)


def read_page(path):
    if path.stat().st_size > MAX_PAGE_BYTES:
        raise ValueError('Single annotation exceeds 4 MiB: ' + path.name)
    payload = path.read_bytes()
    raw = json.loads(payload)
    if not isinstance(raw, dict) or not isinstance(raw.get('metadata'), dict):
        return None
    if not all(isinstance(raw.get(key), list) for key in ['texts', 'tables', 'images', 'sprites']):
        return None
    metadata = raw['metadata']
    url, title = metadata.get('url'), metadata.get('title')
    if not isinstance(url, str) or not isinstance(title, str) or not title:
        raise ValueError('Missing Wiki identity: ' + path.name)
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in ['minecraft.fandom.com', 'minecraft.gamepedia.com'] or parsed.username or parsed.password:
        raise ValueError('Unexpected MineDojo Wiki source URL: ' + path.name)
    if not all(isinstance(row, dict) and isinstance(row.get('text'), str) for row in raw['texts']):
        raise ValueError('Invalid Wiki text blocks: ' + path.name)
    if metadata.get('time') is not None and not isinstance(metadata['time'], str):
        raise ValueError('Invalid Wiki capture time: ' + path.name)
    validate_tables(raw['tables'], path.name)
    # Keep source order. Exact repeats can be navigation/duplicate DOM blocks;
    # no section semantics or table row relationships are inferred from geometry.
    texts = list(dict.fromkeys(text for row in raw['texts'] if (text := normalize(row['text']))))
    title = unquote(title).replace('_', ' ')
    aliases = ' '.join(key for key, value in ALIASES.items() if value in title.lower())
    return {
        'id': 'minedojo/wiki/' + hashlib.sha256(url.encode()).hexdigest()[:24],
        'url': url, 'title': title, 'aliases': aliases, 'body': '\n'.join(texts),
        'captured_at_raw': metadata.get('time'), 'sha256': hashlib.sha256(payload).hexdigest(),
        'tables': raw['tables'], 'image_count': len(raw['images']), 'text_blocks': len(texts),
    }


def build(inputs, output):
    if output.exists():
        raise ValueError('Refusing to overwrite an existing index')
    if any(not path.exists() for path in inputs):
        raise ValueError('Every input path must exist')
    paths = sorted({file.resolve() for source in inputs for file in
                    ([source] if source.is_file() else source.rglob('*.json'))})
    pages, skipped = {}, 0
    for path in paths:
        page = read_page(path)
        if page is None:
            skipped += 1
            continue
        previous = pages.get(page['id'])
        if previous and previous['sha256'] != page['sha256']:
            raise ValueError('Conflicting snapshots for the same source URL; use separate indexes')
        pages[page['id']] = page
    if not pages:
        raise ValueError('No Wiki annotations found')
    output.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(output)) as connection, connection:
        connection.executescript('''
          CREATE TABLE manifest(schema TEXT, dataset TEXT, license TEXT, version_verified INTEGER);
          CREATE TABLE pages(id TEXT UNIQUE, url TEXT, title TEXT, aliases TEXT, body TEXT,
            captured_at_raw TEXT, sha256 TEXT, tables_json TEXT, image_count INTEGER);
          CREATE VIRTUAL TABLE search USING fts5(title, aliases, body, content='pages', content_rowid='rowid');
        ''')
        connection.execute('INSERT INTO manifest VALUES(?,?,?,?)', (SCHEMA, DATASET, LICENSE, 0))
        for page in pages.values():
            connection.execute('INSERT INTO pages VALUES(?,?,?,?,?,?,?,?,?)', (
                page['id'], page['url'], page['title'], page['aliases'], page['body'],
                page['captured_at_raw'], page['sha256'], json.dumps(page['tables'], ensure_ascii=False), page['image_count']))
        connection.execute("INSERT INTO search(search) VALUES('rebuild')")
    return {'schema': SCHEMA, 'index': str(output), 'pages': len(pages), 'skippedNonWikiJson': skipped,
            'textBlocks': sum(page['text_blocks'] for page in pages.values()),
            'tablesPreserved': sum(len(page['tables']) for page in pages.values()),
            'sourceLicense': LICENSE, 'minecraftVersionVerified': False, 'liveAgentLoaded': False}


def open_index(path):
    connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    manifest = connection.execute('SELECT * FROM manifest').fetchone()
    if manifest is None or manifest['schema'] != SCHEMA or manifest['dataset'] != DATASET or manifest['license'] != LICENSE:
        connection.close()
        raise ValueError('Unsupported research index')
    return connection


def source(row):
    return {'id': row['id'], 'title': row['title'], 'url': row['url'], 'dataset': DATASET,
            'sourceLicense': LICENSE, 'capturedAtRaw': row['captured_at_raw'], 'capturedTimezone': None,
            'datasetAttribution': 'Caller-supplied local MineDojo-format files; verify original archive provenance separately.',
            'annotationSha256': row['sha256'], 'minecraftVersion': None, 'minecraftVersionVerified': False,
            'currentWorldVerified': False, 'trustedInstructions': False,
            'notice': 'Historical external reference. Recheck edition/version, current server rules and measured outcomes. '
                      'The uploader labels this corpus noncommercial/share-alike; code licensing does not cover the data.'}


def query_terms(query):
    expanded = [value for key, value in ALIASES.items() if key in query]
    words = re.findall(r'[a-z0-9]+', query.lower())
    terms = list(dict.fromkeys(word for part in expanded + words for word in part.split() if word not in STOP_WORDS))
    if not terms:
        terms = re.findall(r'[^\W_]+', query.lower(), flags=re.UNICODE)
    return terms[:24], bool(expanded)


def search(path, query, limit):
    if not query.strip() or len(query) > 200 or not 1 <= limit <= 10:
        raise ValueError('Query must contain 1..200 characters; limit must be 1..10')
    terms, expanded = query_terms(query)
    expression = ' AND '.join('"' + term.replace('"', '""') + '"' for term in terms)
    started = time.perf_counter()
    with closing(open_index(path)) as connection:
        rows = connection.execute('''SELECT p.*, snippet(search,2,'','', ' … ',40) AS excerpt,
          bm25(search,6.0,4.0,1.0) AS score FROM search JOIN pages p ON p.rowid=search.rowid
          WHERE search MATCH ? ORDER BY score, p.id LIMIT ?''', (expression, limit)).fetchall() if expression else []
    return {'schema': SCHEMA, 'retrieval': 'offline-lexical-pilot', 'queryTerms': terms,
            'aliasesExpanded': expanded, 'elapsedMs': (time.perf_counter()-started)*1000,
            'results': [{**source(row), 'excerpt': row['excerpt'][:1200]} for row in rows]}


def get(path, identity, offset, length, table_index=None, cell_offset=0):
    if not 0 <= offset <= 1000000 or not 1 <= length <= 4000 or cell_offset < 0:
        raise ValueError('Invalid bounded page request')
    with closing(open_index(path)) as connection:
        row = connection.execute('SELECT * FROM pages WHERE id=?', (identity,)).fetchone()
    if row is None:
        raise ValueError('Reference ID not found in this index')
    tables = json.loads(row['tables_json'])
    if table_index is not None:
        if not 0 <= table_index < len(tables):
            raise ValueError('Table index out of range')
        table = tables[table_index]
        cells = table.get('cells', {})
        headers = table.get('headers', {})
        text, boxes = cells.get('text', []), cells.get('bboxes', [])
        detail = {'tableIndex': table_index, 'bbox': table.get('bbox'),
                  'layout': 'source-flat-cells-with-bboxes; row/column relationships unverified',
                  'headerText': [str(value)[:256] for value in headers.get('text', [])[:16]],
                  'headerBboxes': headers.get('bboxes', [])[:16],
                  'cells': [{'index': index, 'text': str(text[index])[:256],
                             'truncated': len(str(text[index])) > 256, 'bbox': boxes[index] if index < len(boxes) else None}
                            for index in range(cell_offset, min(len(text), cell_offset+16))],
                  'totalCells': len(text), 'nextCellOffset': cell_offset+16 if cell_offset+16 < len(text) else None}
    else:
        body = row['body']
        detail = {'text': body[offset:offset+length], 'nextOffset': offset+length if offset+length < len(body) else None,
                  'tablesAvailable': len(tables), 'imagesReferenced': row['image_count'], 'imagesLoaded': False}
    return {**source(row), **detail}


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('build')
    prepare.add_argument('--inputs', nargs='+', required=True, type=Path)
    prepare.add_argument('--output', required=True, type=Path)
    lookup = commands.add_parser('search')
    lookup.add_argument('--index', required=True, type=Path)
    lookup.add_argument('--query', required=True)
    lookup.add_argument('--limit', default=5, type=int)
    read = commands.add_parser('get')
    read.add_argument('--index', required=True, type=Path)
    read.add_argument('--id', required=True)
    read.add_argument('--offset', default=0, type=int)
    read.add_argument('--length', default=2000, type=int)
    read.add_argument('--table', type=int)
    read.add_argument('--cell-offset', default=0, type=int)
    args = parser.parse_args()
    result = build(args.inputs, args.output) if args.command == 'build' else search(args.index, args.query, args.limit) if args.command == 'search' else get(args.index, args.id, args.offset, args.length, args.table, args.cell_offset)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
