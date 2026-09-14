from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from beverage_rag.rag.pipeline import RagPipeline
from beverage_rag.settings import Settings


def load_records(path: Path) -> list[dict[str, Any]]:
    if path.suffix.casefold() == ".jsonl":
        records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    else:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        records = payload.get("questions", payload) if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise ValueError("Le fichier annoté doit contenir une liste de questions")
    normalized: list[dict[str, Any]] = []
    for record in records:
        covers = record.get("corpus_covers")
        if isinstance(covers, str):
            covers = covers.casefold().strip() in {
                "true",
                "oui",
                "corpus couvre le sujet",
                "covered",
            }
        if not isinstance(covers, bool):
            raise ValueError(f"Étiquette corpus_covers invalide pour {record.get('id')}")
        normalized.append({**record, "corpus_covers": covers})
    return normalized


def load_taxonomy(path: Path) -> set[str]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    families = payload.get("families", {})
    if not families:
        raise ValueError("La taxonomie ne contient aucune famille")
    return set(families)


def assign_splits(records: list[dict[str, Any]]) -> None:
    for label in (False, True):
        group = [item for item in records if item["corpus_covers"] is label]
        unassigned = [item for item in group if not item.get("split")]
        ordered = sorted(
            unassigned,
            key=lambda item: hashlib.sha256(str(item["id"]).encode()).hexdigest(),
        )
        validation_count = round(len(ordered) * 0.20)
        for index, item in enumerate(ordered):
            item["split"] = "validation" if index < validation_count else "calibration"


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def distribution(values: list[float]) -> dict[str, float | int | None]:
    return {
        "count": len(values),
        "min": min(values) if values else None,
        "p10": percentile(values, 0.10),
        "p25": percentile(values, 0.25),
        "median": percentile(values, 0.50),
        "p75": percentile(values, 0.75),
        "p90": percentile(values, 0.90),
        "max": max(values) if values else None,
    }


def threshold_sweep(cases: list[dict[str, Any]]) -> list[dict[str, float | int]]:
    calibration = [
        item
        for item in cases
        if item["split"] == "calibration" and item["best_reranker_score"] is not None
    ]
    rows: list[dict[str, float | int]] = []
    for step in range(101):
        threshold = step / 100
        covered = [item for item in calibration if item["corpus_covers"]]
        uncovered = [item for item in calibration if not item["corpus_covers"]]
        covered_gaps = sum(item["best_reranker_score"] < threshold for item in covered)
        unsupported_publications = sum(
            item["best_reranker_score"] >= threshold for item in uncovered
        )
        covered_gap_rate = covered_gaps / len(covered) if covered else 0.0
        unsupported_publication_rate = (
            unsupported_publications / len(uncovered) if uncovered else 0.0
        )
        rows.append(
            {
                "threshold": threshold,
                "covered_gaps": covered_gaps,
                "unsupported_publications": unsupported_publications,
                "covered_gap_rate": covered_gap_rate,
                "unsupported_publication_rate": unsupported_publication_rate,
                "preregistered_loss": covered_gap_rate
                + 2 * unsupported_publication_rate,
            }
        )
    return rows


def select_threshold(rows: list[dict[str, float | int]]) -> dict[str, float | int] | None:
    eligible = [
        row for row in rows if row["unsupported_publication_rate"] <= 0.05
    ]
    if not eligible:
        return None
    return min(
        eligible,
        key=lambda row: (
            row["covered_gap_rate"],
            -row["threshold"],
        ),
    )


def best_signals(report) -> tuple[float | None, int, float | None]:
    mechanisms = [
        mechanism
        for attempt in report.attempts
        for mechanism in attempt.mechanisms
    ]
    scores = [
        mechanism.best_reranker_score
        for mechanism in mechanisms
        if mechanism.best_reranker_score is not None
    ]
    proof_scores = [mechanism.calculated_score for mechanism in mechanisms]
    margins = [
        mechanism.reranker_margin
        for mechanism in mechanisms
        if mechanism.reranker_margin is not None
    ]
    return (
        max(scores) if scores else None,
        max(proof_scores, default=0),
        max(margins) if margins else None,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("annotations", type=Path)
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "config" / "beverages-20k-gpu.yaml",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "diagnostics" / "evaluations",
    )
    parser.add_argument(
        "--taxonomy",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "config" / "mechanism-taxonomy.yaml",
    )
    args = parser.parse_args()
    records = load_records(args.annotations)
    taxonomy = load_taxonomy(args.taxonomy)
    for record in records:
        family = record.get("mechanism_family")
        if family not in taxonomy:
            raise ValueError(
                f"Famille absente ou inconnue pour {record.get('id')}: {family!r}"
            )
    assign_splits(records)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    pipeline = RagPipeline(Settings.load(args.config))
    cases: list[dict[str, Any]] = []
    traces = []
    for record in records:
        answer = pipeline.ask(record["question"])
        trace = pipeline.last_diagnostic_report
        if trace is None:
            raise RuntimeError("Le pipeline n'a produit aucune trace diagnostique")
        best_score, proof_score, margin = best_signals(trace)
        status = answer.diagnostics.status if answer.diagnostics else "generated"
        if status == "quality_failure":
            outcome = "quality_failure"
        elif record["corpus_covers"] and status in {"no_results", "evidence_gap"}:
            outcome = "false_positive_gap"
        elif not record["corpus_covers"] and status == "generated":
            outcome = "false_negative_publication"
        else:
            outcome = "correct"
        cases.append(
            {
                "id": record["id"],
                "mechanism_family": record["mechanism_family"],
                "split": record["split"],
                "corpus_covers": record["corpus_covers"],
                "pipeline_status": status,
                "outcome": outcome,
                "best_reranker_score": best_score,
                "best_calculated_score": proof_score,
                "best_reranker_margin": margin,
                "request_id": trace.request_id,
            }
        )
        traces.append(trace)
    margins = [item["best_reranker_margin"] for item in cases if item["best_reranker_margin"] is not None]
    sweep = threshold_sweep(cases)
    recommendation = select_threshold(sweep)
    summary = {
        "run_id": run_id,
        "question_count": len(cases),
        "warnings": [
            warning
            for condition, warning in (
                (len(cases) < 60, "Moins de 60 questions: résultats exploratoires uniquement."),
                (sum(item["corpus_covers"] for item in cases) < 30, "Moins de 30 questions couvertes."),
                (sum(not item["corpus_covers"] for item in cases) < 30, "Moins de 30 questions non couvertes."),
            )
            if condition
        ],
        "outcomes": {
            name: sum(item["outcome"] == name for item in cases)
            for name in (
                "correct",
                "false_positive_gap",
                "false_negative_publication",
                "quality_failure",
            )
        },
        "reranker_margin_distribution": distribution(margins),
        "preregistered_decision_rule": {
            "constraint": "unsupported_publication_rate <= 0.05 on calibration",
            "objective": "minimize covered_gap_rate",
            "tie_break": "choose the higher threshold",
            "validation": "evaluate once on untouched 20% holdout; never retune on holdout",
        },
        "recommended_threshold_for_review": recommendation,
        "configuration_was_modified": False,
    }
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (run_dir / "threshold-sweep.json").write_text(
        json.dumps(sweep, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with (run_dir / "cases.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(cases[0]) if cases else [])
        if cases:
            writer.writeheader()
            writer.writerows(cases)
    with (run_dir / "traces.jsonl").open("w", encoding="utf-8", newline="\n") as handle:
        for trace in traces:
            handle.write(trace.model_dump_json(exclude_none=True) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Rapport écrit dans {run_dir}")


if __name__ == "__main__":
    main()
