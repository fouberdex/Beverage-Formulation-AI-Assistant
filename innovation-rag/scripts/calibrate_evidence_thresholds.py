from __future__ import annotations

import argparse
import json
from pathlib import Path


def metrics(records: list[dict], threshold: float) -> dict[str, float | int]:
    predicted = [
        bool(record["mechanism_match"]) and float(record["reranker_score"]) >= threshold
        for record in records
    ]
    expected = [bool(record["relevant"]) for record in records]
    true_positive = sum(prediction and target for prediction, target in zip(predicted, expected, strict=True))
    false_positive = sum(prediction and not target for prediction, target in zip(predicted, expected, strict=True))
    false_negative = sum(not prediction and target for prediction, target in zip(predicted, expected, strict=True))
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
    recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
    return {
        "threshold": threshold,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "true_positive": true_positive,
        "false_positive": false_positive,
        "false_negative": false_negative,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calibre un seuil reranker sur des paires question/chunk annotées."
    )
    parser.add_argument("input", type=Path, help="JSONL d'annotations manuelles")
    parser.add_argument("--target-precision", type=float, default=0.95)
    args = parser.parse_args()
    records = [
        json.loads(line)
        for line in args.input.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not records:
        raise SystemExit("Le fichier d'annotations est vide.")
    candidates = [metrics(records, step / 100) for step in range(30, 96)]
    acceptable = [
        item for item in candidates if item["precision"] >= args.target_precision
    ]
    if not acceptable:
        raise SystemExit(
            f"Aucun seuil n'atteint la précision cible de {args.target_precision:.0%}."
        )
    selected = max(
        acceptable,
        key=lambda item: (item["recall"], -item["threshold"]),
    )
    print(json.dumps({"records": len(records), "selected": selected}, indent=2))


if __name__ == "__main__":
    main()
