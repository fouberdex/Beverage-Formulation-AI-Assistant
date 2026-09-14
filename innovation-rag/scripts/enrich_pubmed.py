from __future__ import annotations

import argparse
from pathlib import Path

from beverage_rag.indexing.qdrant_store import QdrantHybridStore
from beverage_rag.ingestion.pubmed import PubMedConnector
from beverage_rag.preprocessing.pipeline import chunk_document
from beverage_rag.schemas import RawDocument, read_jsonl, write_jsonl
from beverage_rag.settings import Settings


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PMIDS = [
    "25977009",  # pasteurised orange juice colour instability
    "30955619",  # mechanisms of non-enzymatic browning
    "32270878",  # fractionation and kinetic approach
    "32302128",  # influence of pH and composition
    "34596322",  # reaction pathways review
]


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch selected public PubMed abstracts, preserve them as a curated "
            "source, and upsert only their chunks into the existing Qdrant index."
        )
    )
    parser.add_argument("pmids", nargs="*", default=DEFAULT_PMIDS)
    parser.add_argument(
        "--config",
        type=Path,
        default=ROOT / "config" / "beverages-20k-gpu.yaml",
    )
    args = parser.parse_args()

    settings = Settings.load(args.config)
    fetched = list(PubMedConnector(settings).fetch_ids(args.pmids))
    if not fetched:
        raise RuntimeError("PubMed returned no usable abstract for the requested IDs")

    output = (
        settings.resolve_path(settings.preprocessing.input_dir)
        / "curated_pubmed"
        / "documents.jsonl"
    )
    existing = read_jsonl(output, RawDocument) if output.exists() else []
    merged = {document.id: document for document in existing}
    merged.update({document.id: document for document in fetched})
    write_jsonl(output, list(merged.values()))

    chunks = [
        chunk
        for document in fetched
        for chunk in chunk_document(document, settings)
    ]
    indexed = QdrantHybridStore(settings).upsert(chunks, recreate=False)
    print(
        f"{len(fetched)} documents PubMed conservés dans {output}; "
        f"{indexed} chunks ajoutés ou mis à jour sans recréer la collection."
    )


if __name__ == "__main__":
    main()
