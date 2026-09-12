from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from beverage_rag.indexing.pipeline import index_chunks, index_precomputed
from beverage_rag.ingestion.pipeline import CONNECTORS, ingest_all, ingest_source
from beverage_rag.preprocessing.pipeline import preprocess
from beverage_rag.rag.pipeline import RagPipeline
from beverage_rag.settings import Settings


app = typer.Typer(
    name="beverage-rag",
    no_args_is_help=True,
    help="Pipeline RAG local de veille brevets et publications publiques.",
)
DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "soda.yaml"
ConfigOption = Annotated[
    Path,
    typer.Option("--config", "-c", help="Fichier YAML définissant le périmètre."),
]


def load(config: Path) -> Settings:
    return Settings.load(config)


@app.command("validate-config")
def validate_config(config: ConfigOption = DEFAULT_CONFIG) -> None:
    settings = load(config)
    typer.echo(
        f"Configuration valide: {settings.scope.domain}; "
        f"{len(settings.scope.keywords)} requêtes; {settings.scope.date_from}–{settings.scope.date_to}"
    )


@app.command()
def ingest(
    source: Annotated[str, typer.Option(help="Source ou 'all'.")] = "all",
    limit: Annotated[int | None, typer.Option(help="Limite inférieure à celle du YAML.")] = None,
    config: ConfigOption = DEFAULT_CONFIG,
) -> None:
    settings = load(config)
    if source == "all":
        typer.echo(json.dumps(ingest_all(settings, limit), ensure_ascii=False, indent=2))
        return
    if source not in CONNECTORS:
        raise typer.BadParameter(f"Source attendue: all, {', '.join(CONNECTORS)}")
    path, count = ingest_source(settings, source, limit)
    typer.echo(f"{count} documents écrits dans {path}")


@app.command("preprocess")
def preprocess_command(config: ConfigOption = DEFAULT_CONFIG) -> None:
    path, count = preprocess(load(config))
    typer.echo(f"{count} chunks écrits dans {path}")


@app.command("index")
def index_command(
    recreate: Annotated[
        bool,
        typer.Option(help="Supprimer et recréer explicitement la collection Qdrant."),
    ] = False,
    config: ConfigOption = DEFAULT_CONFIG,
) -> None:
    count = index_chunks(load(config), recreate=recreate)
    typer.echo(f"{count} chunks indexés")


@app.command("index-precomputed")
def index_precomputed_command(
    embeddings: Annotated[Path, typer.Option(help="Fichier NumPy .npy généré sur GPU.")],
    manifest: Annotated[Path, typer.Option(help="Manifest JSON généré avec les vecteurs.")],
    recreate: Annotated[
        bool,
        typer.Option(help="Supprimer et recréer explicitement la collection Qdrant."),
    ] = False,
    config: ConfigOption = DEFAULT_CONFIG,
) -> None:
    count = index_precomputed(
        load(config), embeddings, manifest, recreate=recreate
    )
    typer.echo(f"{count} chunks pré-calculés indexés")


@app.command()
def ask(
    question: Annotated[str, typer.Argument(help="Question de veille innovation.")],
    source: Annotated[str | None, typer.Option(help="Filtre de source facultatif.")] = None,
    config: ConfigOption = DEFAULT_CONFIG,
) -> None:
    result = RagPipeline(load(config)).ask(question, source=source)
    typer.echo(result.answer)
    if result.sources:
        typer.echo("\nSources:")
        for item in result.sources:
            typer.echo(f"[{item.citation_id}] {item.label} — {item.title} — {item.url or 'URL indisponible'}")


@app.command("run-pipeline")
def run_pipeline(
    limit: Annotated[int | None, typer.Option(help="Limite totale du pilote.")] = None,
    recreate: Annotated[bool, typer.Option(help="Recréer la collection Qdrant.")] = False,
    config: ConfigOption = DEFAULT_CONFIG,
) -> None:
    settings = load(config)
    typer.echo(json.dumps(ingest_all(settings, limit), ensure_ascii=False, indent=2))
    _, chunk_count = preprocess(settings)
    typer.echo(f"{chunk_count} chunks préparés")
    indexed = index_chunks(settings, recreate=recreate)
    typer.echo(f"{indexed} chunks indexés")


if __name__ == "__main__":
    app()
