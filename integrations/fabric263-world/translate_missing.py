"""Author a validated Chinese overlay through an explicitly configured model.

Only public vendor UI text is sent; no world, account or credential material.
Credentials enter through an environment variable and are never persisted.
Successful batches are durable and resumed by source+context digest.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.request

from localize import audit
from prepare import HERE, write_json

PLACEHOLDER = re.compile(r"%(?:\d+\$)?[-#+0,(]*\d*(?:\.\d+)?[a-zA-Z%]|\{[A-Za-z_][A-Za-z0-9_:.]*\}|§[0-9a-fk-or]|https?://[^\s<>\"\]]+|(?<![A-Za-z0-9_])[a-z0-9_.-]+:[a-z0-9_./-]+")
COMMAND = re.compile(r"/(?:quest|vq)(?:\s+(?:list|accept|claim|progress|team|abandon|journal|questmaster|tracker|autoaccept|mainquests|difficulty))?\b")
COMMAND_ROOT = re.compile(r"(?<![\w])/[a-z_][a-z0-9_:.+-]*")
EXTRA_VARIABLE = re.compile(r"@[a-z_][a-z0-9_]*|\$\{[^}]+\}|(?<!%)%[a-z_][a-z0-9_]+%(?!%)")
LATIN = re.compile(r"[A-Za-z]{3,}")
HAN = re.compile(r"[\u3400-\u9fff]")
KEEP = {"Minecraft", "NPC", "UUID", "FPS", "TPS", "Sodium", "Terralith", "Fabric", "Polymer", "GraalWeave", "Baritone", "URL", "Url", "JSON", "CPU", "GPU", "RGB", "Cobblemon"}


def tokens(text):
    return Counter(PLACEHOLDER.findall(text) + COMMAND.findall(text) + COMMAND_ROOT.findall(text) + EXTRA_VARIABLE.findall(text))


def needs_translation(text):
    if re.fullmatch(r"(?:Alt|Ctrl|Shift)(?:\s*\+\s*%s)?", text):
        return False
    words = LATIN.findall(COMMAND.sub("", PLACEHOLDER.sub("", text)))
    return bool(words) and not all(word in KEEP for word in words)


def validate(source, translation):
    if not isinstance(translation, str) or not translation.strip():
        raise ValueError("empty_or_nontext_translation")
    if tokens(source) != tokens(translation):
        raise ValueError("placeholder_or_identifier_mismatch")
    if needs_translation(source) and not HAN.search(translation):
        raise ValueError("translation_does_not_contain_chinese")
    if source.count("\n") != translation.count("\n"):
        raise ValueError("line_break_count_changed")
    return translation


def candidates(data):
    grouped = {}
    manual_file = HERE / "localization/overrides.json"
    manual = json.loads(manual_file.read_text(encoding="utf-8")) if manual_file.exists() else {}
    for namespace, values in data["namespaces"].items():
        selected = {**values["missing"], **{k: v for k, v in values["sameAsEnglish"].items() if needs_translation(v)}}
        for key in manual.get(namespace, {}):
            if key not in values["en_us"]:
                raise ValueError("Human override has no reviewed English key: " + namespace + ":" + key)
            selected[key] = values["en_us"][key]
        for key, value in selected.items():
            # Preserve literal punctuation, numbers and proper names as such.
            identity = hashlib.sha256(json.dumps([namespace, value], ensure_ascii=False).encode()).hexdigest()
            group = grouped.setdefault(identity, {"id": identity, "namespace": namespace, "text": value, "keys": []})
            group["keys"].append(key)
    return grouped


def request_batch(batch, endpoint, model, key, glossary):
    ids = {str(index): row["id"] for index, row in enumerate(batch)}
    system = ("你是 Minecraft RPG 模组的专业简体中文本地化译者。只返回 JSON 对象：每个输入 id 为键，中文译文为值。"
              "完整翻译所有标题、按钮、帮助、剧情、任务、提示和长句，不省略条件、数量或失败原因。风格自然简练，适合游戏界面。"
              "绝不改变 %s、%1$s、%d、%f、%% 等格式占位符的种类和数量，绝不改变 {name} 变量、§颜色码、URL、"
              "命名空间ID（如 minecraft:stone）、命令及参数字面量、键盘按键名。保留原有换行数量。不要插入多余的占位符。"
              "需要重新排列同种占位符时保持语义，不能改变未编号占位符的对应顺序。专有品牌、开发者名、玩家名保留。"
              "返回合法 JSON，不要 markdown、说明或原文副本。术语表：" + json.dumps(glossary, ensure_ascii=False))
    body = {"model": model, "temperature": 0.1, "max_tokens": 12000, "stream": False, "enable_thinking": False,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": json.dumps([
                {"id": str(index), "context": row["namespace"] + ":" + row["keys"][0], "text": row["text"]} for index, row in enumerate(batch)], ensure_ascii=False)}]}
    req = urllib.request.Request(endpoint.rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            raw = json.load(response)
    except urllib.error.HTTPError as error:
        # Never include request headers, private key material or entire provider replies.
        raise RuntimeError("translation_provider_http_" + str(error.code)) from None
    choice = raw["choices"][0]
    if choice.get("finish_reason") != "stop":
        raise ValueError("incomplete_model_output:" + str(choice.get("finish_reason")))
    content = choice["message"]["content"].strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content)
    translated = json.loads(content)
    if not isinstance(translated, dict) or set(translated) != set(ids):
        raise ValueError("translation_batch_ids_differ")
    translated = {ids[identity]: value for identity, value in translated.items()}
    accepted, rejected = {}, {}
    for row in batch:
        try:
            accepted[row["id"]] = validate(row["text"], translated[row["id"]])
        except ValueError as error:
            rejected[row["id"]] = {"reason": str(error), "candidate": translated[row["id"]]}
    return accepted, rejected, raw.get("usage", {})


def run(config, endpoint, model, key, batch_size=45, workers=2):
    data = audit(config)
    rows = candidates(data)
    directory = Path(config["cache"]) / "localization"
    directory.mkdir(parents=True, exist_ok=True)
    cache_path = directory / "translations.local.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {"values": {}, "rejected": {}, "batches": []}
    for identity, row in rows.items():
        if not needs_translation(row["text"]):
            cache["values"][identity] = row["text"]
        elif identity in cache["values"]:
            try:
                validate(row["text"], cache["values"][identity])
            except ValueError as error:
                cache["rejected"][identity] = {"reason": str(error), "candidate": cache["values"].pop(identity)}
    # Only accept a previous candidate after all current structural checks pass.
    for identity, rejected in list(cache["rejected"].items()):
        if identity in rows:
            try:
                cache["values"][identity] = validate(rows[identity]["text"], rejected["candidate"])
                del cache["rejected"][identity]
            except ValueError:
                pass
    overrides = HERE / "localization/overrides.json"
    if overrides.exists():
        fixed = json.loads(overrides.read_text(encoding="utf-8"))
        for identity, row in rows.items():
            chosen = [fixed.get(row["namespace"], {}).get(key) for key in row["keys"]]
            chosen = [value for value in chosen if value is not None]
            if chosen:
                if len(set(chosen)) != 1:
                    raise ValueError("Conflicting human overrides for identical source text")
                cache["values"][identity] = validate(row["text"], chosen[0])
                cache["rejected"].pop(identity, None)
    pending = [row for identity, row in rows.items() if identity not in cache["values"]]
    batches = [pending[i:i + batch_size] for i in range(0, len(pending), batch_size)]
    glossary = json.loads((HERE / "localization/glossary.json").read_text(encoding="utf-8"))
    print(json.dumps({"uniqueEntries": len(rows), "pending": len(pending), "batches": len(batches), "workers": workers}), flush=True)
    write_json(cache_path, cache)
    stop = threading.Event()

    def invoke(batch):
        if stop.is_set() or (directory / "translation.stop").exists():
            return None
        try:
            return request_batch(batch, endpoint, model, key, glossary)
        except RuntimeError as error:
            if str(error) in {"translation_provider_http_401", "translation_provider_http_403", "translation_provider_http_429"}:
                stop.set()
            raise

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(invoke, batch): batch for batch in batches}
        for future in as_completed(futures):
            batch = futures[future]
            try:
                result = future.result()
                if result is None:
                    continue
                accepted, rejected, usage = result
                cache["values"].update(accepted)
                cache["rejected"].update(rejected)
                for identity in accepted:
                    cache["rejected"].pop(identity, None)
                cache["batches"].append({"model": model, "observedAt": time.time(), "accepted": len(accepted), "rejected": len(rejected), "usage": usage})
                print(json.dumps({"accepted": len(accepted), "rejected": len(rejected), "cached": len(cache["values"]), "total": len(rows)}), flush=True)
            except Exception as error:
                # Retain a bounded diagnostic, not an exception containing provider content.
                cache["batches"].append({"model": model, "observedAt": time.time(), "failed": type(error).__name__, "reason": str(error)[:100], "ids": [row["id"] for row in batch]})
                print(json.dumps({"batchFailed": type(error).__name__, "reason": str(error)[:100]}), flush=True)
            write_json(cache_path, cache)
    missing = [identity for identity in rows if identity not in cache["values"]]
    if missing:
        print(json.dumps({"complete": False, "remaining": len(missing), "rejected": len(cache["rejected"])}), flush=True)
        return 1
    target = HERE / "localization/zh_cn"
    for namespace, values in data["namespaces"].items():
        translations = {}
        for row in rows.values():
            if row["namespace"] == namespace:
                translations.update({key: cache["values"][row["id"]] for key in row["keys"]})
        if translations:
            write_json(target / (namespace + ".json"), dict(sorted(translations.items())))
    print(json.dumps({"complete": True, "entries": sum(len(row["keys"]) for row in rows.values()), "uniqueEntries": len(rows)}), flush=True)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--key-env", default="MAW_TRANSLATE_KEY")
    parser.add_argument("--batch-size", type=int, default=45)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    config = json.loads((HERE / "deployment.local.json").read_text())
    key = os.environ.get(args.key_env)
    if not key:
        parser.error("Selected credential environment variable is missing")
    return run(config, args.base_url, args.model, key, args.batch_size, args.workers)


if __name__ == "__main__":
    raise SystemExit(main())
