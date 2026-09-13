"""Retired direct-provider probe. All generative requests belong to QwenPaw Agents."""
import json


def main():
    # Do not load the old maid provider configuration or reuse its API key.
    print(json.dumps({
        "ok": False,
        "code": "direct_provider_probe_retired",
        "submittedModelRequests": 0,
        "message": "This direct-provider test is retired. Test the configured maid task role in the project's QwenPaw console instead; model selection belongs to that Agent.",
    }, ensure_ascii=False))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
