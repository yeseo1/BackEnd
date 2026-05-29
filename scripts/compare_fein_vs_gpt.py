#!/usr/bin/env python3
import argparse
import csv
import json
import os
import random
import ssl
import statistics
import subprocess
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from urllib import error, request


LABEL_FILE_PREFIX_MAP = {
    "EMOTION": "Emotion",
    "FACT": "Fact",
    "INTERPRETATION": "Interpretation",
    "NEED": "Need",
}

LABELS = ["FACT", "EMOTION", "INTERPRETATION", "NEED"]
ENCODINGS = ["utf-8-sig", "utf-8", "cp949", "euc-kr"]
KOREAN_LABEL_MAP = {
    "사실": "FACT",
    "감정": "EMOTION",
    "해석": "INTERPRETATION",
    "욕구": "NEED",
    "필요": "NEED",
}
SHORT_LABEL_MAP = {
    "F": "FACT",
    "E": "EMOTION",
    "I": "INTERPRETATION",
    "N": "NEED",
}


def read_csv_flexible(path: Path):
    last_error = None
    for encoding in ENCODINGS:
        try:
            with path.open("r", encoding=encoding, newline="") as f:
                return list(csv.DictReader(f))
        except Exception as exc:
            last_error = exc
    raise last_error


def discover_label_files(data_dir: Path, prefix: str):
    matched = []
    for path in data_dir.iterdir():
        if not path.is_file():
            continue
        stem = path.stem
        if stem == prefix or stem.startswith(f"{prefix}_"):
            if path.suffix.lower() == ".csv":
                matched.append(path)

    def sort_key(path: Path):
        stem = path.stem
        if stem == prefix:
            return (0, path.name.lower())
        try:
            return (int(stem.split("_", 1)[1]), path.name.lower())
        except Exception:
            return (9999, path.name.lower())

    return sorted(matched, key=sort_key)


def load_dataset(data_dir: Path):
    rows = []
    seen = set()

    for label, prefix in LABEL_FILE_PREFIX_MAP.items():
        files = discover_label_files(data_dir, prefix)
        if not files:
            raise FileNotFoundError(f"Missing dataset files for {prefix}")

        for path in files:
            for row in read_csv_flexible(path):
                text = (row.get("문장") or "").strip()
                if not text:
                    continue
                key = (text, label)
                if key in seen:
                    continue
                seen.add(key)
                rows.append(
                    {
                        "text": text,
                        "label": label,
                        "source_file": path.name,
                    }
                )

    return rows


def load_eval_csv(path: Path):
    rows = []
    for row in read_csv_flexible(path):
        text = (row.get("text") or row.get("문장") or "").strip()
        label = normalize_label(
            row.get("label") or row.get("라벨") or row.get("정답라벨") or ""
        )

        if not text or label == "UNKNOWN":
            continue

        rows.append(
            {
                "text": text,
                "label": label,
                "source_file": path.name,
            }
        )

    return rows


def build_test_subset(rows, sample_per_label: int, seed: int):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["label"]].append(row)

    randomizer = random.Random(seed)
    selected = []

    for label in LABELS:
        candidates = list(grouped[label])
        randomizer.shuffle(candidates)

        # Approximate a small holdout by sampling from shuffled candidates.
        take = min(sample_per_label, len(candidates))
        selected.extend(candidates[:take])

    randomizer.shuffle(selected)
    return selected


def chunked(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def normalize_label(raw: str):
    if not raw:
        return "UNKNOWN"

    cleaned = raw.strip().upper()
    if cleaned in LABELS:
        return cleaned

    if cleaned in SHORT_LABEL_MAP:
        return SHORT_LABEL_MAP[cleaned]

    for label in LABELS:
        if label in cleaned:
            return label

    for korean, mapped in KOREAN_LABEL_MAP.items():
        if korean in raw:
            return mapped

    return "UNKNOWN"


def post_json(url: str, payload: dict, headers=None, ssl_context=None):
    req = request.Request(
        url,
        method="POST",
        headers={"Content-Type": "application/json", **(headers or {})},
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    )

    with request.urlopen(req, timeout=120, context=ssl_context) as resp:
        return json.loads(resp.read().decode("utf-8"))


def classify_with_model_server(base_url: str, text: str):
    started = time.perf_counter()
    response = post_json(
        f"{base_url.rstrip('/')}/internal/fein/classify",
        {"statements": [text]},
    )
    elapsed_ms = (time.perf_counter() - started) * 1000
    result = response["data"]["results"][0]
    return {
        "label": normalize_label(result.get("label")),
        "confidence": result.get("confidence"),
        "latency_ms": elapsed_ms,
        "raw": result,
    }


def classify_with_model_server_batch(base_url: str, texts):
    started = time.perf_counter()
    response = post_json(
        f"{base_url.rstrip('/')}/internal/fein/classify",
        {"statements": texts},
    )
    elapsed_ms = (time.perf_counter() - started) * 1000
    results = response["data"]["results"]
    if len(results) != len(texts):
        raise RuntimeError(
            f"MODEL_LABEL_COUNT_MISMATCH expected={len(texts)} got={len(results)}"
        )

    per_item_latency = elapsed_ms / len(texts) if texts else 0.0
    normalized = []
    for result in results:
        normalized.append(
            {
                "label": normalize_label(result.get("label")),
                "confidence": result.get("confidence"),
                "latency_ms": per_item_latency,
                "raw": result,
            }
        )
    return normalized


def classify_with_gpt_batch(api_key: str, model: str, texts):
    prompt = (
        "아래 한국어 문장들을 FEIN 네 가지 중 하나로 분류하세요.\n"
        "가능한 라벨: FACT, EMOTION, INTERPRETATION, NEED\n"
        "반드시 영문 대문자 라벨만 사용하세요.\n"
        "반드시 JSON 객체 하나만 반환하세요.\n"
        "형식은 {\"labels\":[\"FACT\",\"EMOTION\",...]} 이어야 하며,\n"
        "labels 배열 길이는 입력 문장 수와 정확히 같아야 하고 순서도 입력과 같아야 합니다.\n\n"
        "문장 목록:\n"
        + "\n".join(f"{i+1}. {text}" for i, text in enumerate(texts))
    )

    started = time.perf_counter()
    js_code = """
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await client.chat.completions.create({
  model: process.env.GPT_MODEL,
  temperature: 0,
  response_format: { type: 'json_object' },
  messages: [
    {
      role: 'system',
      content:
        '당신은 한국어 갈등 문장을 FEIN 체계로 분류하는 분류기다. 반드시 JSON으로만 답하고, labels 배열에 FACT, EMOTION, INTERPRETATION, NEED 중 영문 대문자 라벨만 넣는다.',
    },
    {
      role: 'user',
      content: process.env.GPT_PROMPT,
    },
  ],
});

const content = response.choices?.[0]?.message?.content || '{}';
const parsed = JSON.parse(content);

console.log(JSON.stringify({
  labels: parsed.labels || [],
  usage: response.usage || {},
}));
"""
    env = os.environ.copy()
    env["OPENAI_API_KEY"] = api_key
    env["GPT_MODEL"] = model
    env["GPT_PROMPT"] = prompt

    try:
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", js_code],
            capture_output=True,
            text=True,
            env=env,
            check=True,
            timeout=120,
        )
        response = json.loads(completed.stdout.strip())
        elapsed_ms = (time.perf_counter() - started) * 1000
        usage = response.get("usage", {})
        raw_labels = response.get("labels") or []

        if len(raw_labels) != len(texts):
            raise RuntimeError(
                f"GPT_LABEL_COUNT_MISMATCH expected={len(texts)} got={len(raw_labels)}"
            )
    except Exception:
        if len(texts) == 1:
            raise

        midpoint = max(1, len(texts) // 2)
        left = classify_with_gpt_batch(api_key, model, texts[:midpoint])
        right = classify_with_gpt_batch(api_key, model, texts[midpoint:])

        return {
            "results": left["results"] + right["results"],
            "usage": {
                "prompt_tokens": left["usage"].get("prompt_tokens", 0)
                + right["usage"].get("prompt_tokens", 0),
                "completion_tokens": left["usage"].get("completion_tokens", 0)
                + right["usage"].get("completion_tokens", 0),
                "total_tokens": left["usage"].get("total_tokens", 0)
                + right["usage"].get("total_tokens", 0),
            },
            "batch_latency_ms": left["batch_latency_ms"] + right["batch_latency_ms"],
        }

    per_item_latency = elapsed_ms / len(texts) if texts else 0.0
    results = []
    for raw_label in raw_labels:
        results.append(
            {
                "label": normalize_label(str(raw_label)),
                "latency_ms": per_item_latency,
                "raw_text": str(raw_label),
            }
        )

    return {
        "results": results,
        "usage": usage,
        "batch_latency_ms": elapsed_ms,
    }


def compute_metrics(rows, prediction_key: str):
    confusion = {
        true_label: {pred_label: 0 for pred_label in LABELS + ["UNKNOWN"]}
        for true_label in LABELS
    }

    total = len(rows)
    correct = 0

    for row in rows:
        true_label = row["label"]
        pred_label = row[prediction_key]["label"]
        confusion[true_label][pred_label] += 1
        if pred_label == true_label:
            correct += 1

    per_label = {}
    f1_values = []
    precision_values = []
    recall_values = []

    for label in LABELS:
        tp = confusion[label][label]
        fp = sum(confusion[other][label] for other in LABELS if other != label)
        fn = sum(
            count for pred, count in confusion[label].items() if pred != label
        )

        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall)
            else 0.0
        )

        per_label[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": sum(confusion[label].values()),
        }
        precision_values.append(precision)
        recall_values.append(recall)
        f1_values.append(f1)

    return {
        "accuracy": correct / total if total else 0.0,
        "macro_precision": sum(precision_values) / len(precision_values),
        "macro_recall": sum(recall_values) / len(recall_values),
        "macro_f1": sum(f1_values) / len(f1_values),
        "per_label": per_label,
        "confusion": confusion,
    }


def summarize_latency(rows, prediction_key: str):
    latencies = [row[prediction_key]["latency_ms"] for row in rows]
    return {
        "avg_ms": statistics.mean(latencies) if latencies else 0.0,
        "median_ms": statistics.median(latencies) if latencies else 0.0,
        "max_ms": max(latencies) if latencies else 0.0,
        "min_ms": min(latencies) if latencies else 0.0,
    }


def summarize_gpt_usage(rows):
    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0

    for row in rows:
        usage = row["gpt"].get("usage") or {}
        prompt_tokens += usage.get("prompt_tokens", 0)
        completion_tokens += usage.get("completion_tokens", 0)
        total_tokens += usage.get("total_tokens", 0)

    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }


def print_metric_table(title: str, metrics: dict):
    print(f"\n[{title}]")
    print(
        f"Accuracy={metrics['accuracy']:.4f} "
        f"MacroPrecision={metrics['macro_precision']:.4f} "
        f"MacroRecall={metrics['macro_recall']:.4f} "
        f"MacroF1={metrics['macro_f1']:.4f}"
    )
    for label in LABELS:
        label_metrics = metrics["per_label"][label]
        print(
            f"- {label:<15} "
            f"P={label_metrics['precision']:.4f} "
            f"R={label_metrics['recall']:.4f} "
            f"F1={label_metrics['f1']:.4f} "
            f"support={label_metrics['support']}"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-dir",
        default="/Users/leejunsang/Desktop/3-2/캡스톤2/데이터셋",
    )
    parser.add_argument("--sample-per-label", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--model-server-url",
        default=os.environ.get("FEIN_MODEL_BASE_URL", "http://127.0.0.1:8000"),
    )
    parser.add_argument(
        "--gpt-model",
        default=os.environ.get("OPENAI_ANALYSIS_MODEL", "gpt-5.1-mini"),
    )
    parser.add_argument(
        "--output-dir",
        default="/Users/leejunsang/Desktop/Capstone2/artifacts/experiments",
    )
    parser.add_argument(
        "--eval-csv",
        default="",
        help="Path to a prepared evaluation CSV with text/label columns.",
    )
    parser.add_argument(
        "--insecure-openai",
        action="store_true",
        help="Disable SSL certificate verification for OpenAI requests in local experiments.",
    )
    parser.add_argument("--gpt-batch-size", type=int, default=1)
    parser.add_argument("--model-batch-size", type=int, default=1)
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required")

    dataset_dir = Path(args.dataset_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.eval_csv:
        subset = load_eval_csv(Path(args.eval_csv))
        rows = subset
    else:
        rows = load_dataset(dataset_dir)
        subset = build_test_subset(rows, args.sample_per_label, args.seed)

    print(f"Loaded dataset rows: {len(rows)}")
    print(f"Pilot evaluation subset: {len(subset)}")
    print(f"Label distribution: {dict(Counter(row['label'] for row in subset))}")

    results = []
    gpt_usage_batches = []

    for index, row in enumerate(subset, start=1):
        print(f"[{index}/{len(subset)}] {row['label']} | {row['text'][:60]}")
        results.append({**row})

    for batch in chunked(results, max(1, args.model_batch_size)):
        model_batch = classify_with_model_server_batch(
            args.model_server_url,
            [row["text"] for row in batch],
        )
        for row, model_pred in zip(batch, model_batch):
            row["model"] = model_pred

    for batch in chunked(results, max(1, args.gpt_batch_size)):
        gpt_batch = classify_with_gpt_batch(
            api_key,
            args.gpt_model,
            [row["text"] for row in batch],
        )
        gpt_usage_batches.append(gpt_batch["usage"])

        for row, gpt_pred in zip(batch, gpt_batch["results"]):
            row["gpt"] = gpt_pred

    model_metrics = compute_metrics(results, "model")
    gpt_metrics = compute_metrics(results, "gpt")
    model_latency = summarize_latency(results, "model")
    gpt_latency = summarize_latency(results, "gpt")
    for row, batch_usage in zip(
        [row for row in results if "gpt" in row],
        [None] * len(results),
    ):
        row["gpt"]["usage"] = {}

    gpt_usage = {
        "prompt_tokens": sum(item.get("prompt_tokens", 0) for item in gpt_usage_batches),
        "completion_tokens": sum(
            item.get("completion_tokens", 0) for item in gpt_usage_batches
        ),
        "total_tokens": sum(item.get("total_tokens", 0) for item in gpt_usage_batches),
    }

    print_metric_table("Custom FEIN Model", model_metrics)
    print_metric_table("GPT Classifier", gpt_metrics)

    print("\n[Latency]")
    print(f"- Model avg={model_latency['avg_ms']:.2f}ms median={model_latency['median_ms']:.2f}ms")
    print(f"- GPT   avg={gpt_latency['avg_ms']:.2f}ms median={gpt_latency['median_ms']:.2f}ms")

    print("\n[GPT Token Usage]")
    print(json.dumps(gpt_usage, ensure_ascii=False, indent=2))

    output = {
        "created_at": datetime.now().isoformat(),
        "config": {
            "dataset_dir": str(dataset_dir),
            "sample_per_label": args.sample_per_label,
            "seed": args.seed,
            "model_server_url": args.model_server_url,
            "gpt_model": args.gpt_model,
        },
        "summary": {
            "sample_size": len(results),
            "label_distribution": dict(Counter(row["label"] for row in results)),
            "model_metrics": model_metrics,
            "gpt_metrics": gpt_metrics,
            "model_latency": model_latency,
            "gpt_latency": gpt_latency,
            "gpt_usage": gpt_usage,
        },
        "results": results,
    }

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = output_dir / f"fein_vs_gpt_{timestamp}.json"
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nSaved report: {output_path}")


if __name__ == "__main__":
    main()
