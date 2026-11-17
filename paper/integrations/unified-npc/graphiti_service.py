"""Read protected provider files at startup; keys never enter arguments or reports."""
import argparse
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    settings = json.loads(args.config.read_text(encoding='utf-8-sig'))
    if settings.get('schema') != 1:
        raise ValueError('graphiti_config_schema')
    route = json.loads(Path(settings['modelProviderFile']).read_text(encoding='utf-8-sig'))
    embed = json.loads(Path(settings['embeddingProviderFile']).read_text(encoding='utf-8-sig'))
    os.environ.update({
        'GRAPHITI_TELEMETRY_ENABLED': 'false',
        'AGENT_MEMORY_GRAPH_DRIVER': 'falkordb', 'AGENT_MEMORY_FALKORDB_HOST': '127.0.0.1',
        'AGENT_MEMORY_FALKORDB_PORT': str(settings['databasePort']),
        'AGENT_MEMORY_SIDECAR_HOST': '127.0.0.1', 'AGENT_MEMORY_SIDECAR_PORT': str(settings['port']),
        'AGENT_MEMORY_SIDECAR_TOKEN_ENV': 'QDJ_GRAPH_TOKEN',
        'QDJ_GRAPH_TOKEN': Path(settings['tokenFile']).read_text().strip(),
        'AGENT_MEMORY_LLM_BASE_URL': route['baseUrl'], 'AGENT_MEMORY_LLM_MODEL': settings['model'],
        'AGENT_MEMORY_LLM_SMALL_MODEL': settings['model'], 'AGENT_MEMORY_LLM_STRUCTURED_OUTPUT': 'json_object',
        'AGENT_MEMORY_LLM_API_KEY_ENV': 'QDJ_GRAPH_LLM_KEY', 'QDJ_GRAPH_LLM_KEY': route['apiKey'],
        'AGENT_MEMORY_EMBEDDER': 'openai', 'AGENT_MEMORY_EMBED_BASE_URL': embed['baseUrl'],
        'AGENT_MEMORY_EMBED_MODEL': settings['embeddingModel'], 'AGENT_MEMORY_EMBED_DIM': str(settings['embeddingDimensions']),
        'AGENT_MEMORY_EMBED_API_KEY_ENV': 'QDJ_GRAPH_EMBED_KEY', 'QDJ_GRAPH_EMBED_KEY': embed['apiKey'],
        'AGENT_MEMORY_RECEIPTS_PATH': settings['receiptsFile'],
    })
    from agent_memory_sidecar.__main__ import main as run
    run()


if __name__ == '__main__':
    main()
