# Local Decider configuration fix

Applies to Mapika/decider commit `a59466d`. This is a small adapter patch, not a vendored model or a new server. Keep local GPU warmup changes when applying it.

1. Back up the existing checkout and launcher; `git apply --check serve-config.patch` in the Decider checkout.
2. Copy `model_config.py` to `decider/model_config.py`, then `git apply serve-config.patch`.
3. Pin `DECIDER_REVISION` to the deployed Hugging Face commit and set `HF_HUB_CACHE` to the existing cache. Alternatively point `DECIDER_MODEL` at a complete local snapshot. Include its **matching** `decider_config.json`; do not borrow calibration from another model.
4. Restart through the existing process supervisor. `/health` must report `configLoaded`, `modelName`, revision, configuration SHA-256, effective temperatures and layout flags. `/v1/systemone` includes bounded `model_info` for decision receipts.

The loader resolves one snapshot for the engine and calibration, validates finite positive temperatures and typed flags before loading the GPU model, and fails startup when configuration is missing or invalid. It preserves explicit `DECIDER_TEMPERATURE` overrides and reports them. Schema caching stays governed by upstream configuration; this patch does not turn it on automatically.

Run `python -m unittest discover -s tests -p test_decider_config.py` from this project for isolated resolver tests. Actual service startup and inference still require the existing Decider environment and GPU. A health response verifies configuration/liveness, not game policy quality.
