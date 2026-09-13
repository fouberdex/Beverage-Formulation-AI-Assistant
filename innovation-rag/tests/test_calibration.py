from scripts.calibrate_evidence_thresholds import metrics


def test_calibration_metrics_require_mechanism_match() -> None:
    records = [
        {"reranker_score": 0.90, "mechanism_match": False, "relevant": False},
        {"reranker_score": 0.80, "mechanism_match": True, "relevant": True},
        {"reranker_score": 0.50, "mechanism_match": True, "relevant": False},
    ]

    result = metrics(records, threshold=0.60)

    assert result["precision"] == 1.0
    assert result["recall"] == 1.0
    assert result["false_positive"] == 0
