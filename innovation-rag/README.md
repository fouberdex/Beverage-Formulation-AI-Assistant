# Veille Brevets & Publications — BeverageDzAI

Pilote RAG autonome consacré à l'innovation dans les boissons gazeuses. Il ingère uniquement
des sources publiques, les normalise en JSONL, crée un index hybride local dans Qdrant et
interroge un modèle open-weight servi par Ollama ou vLLM. Il n'utilise aucune donnée interne
et n'effectue aucun fine-tuning.

Le module est isolé de l'application Node.js/React principale. Ses entrées, dépendances et
commandes restent dans `innovation-rag/`.

## Architecture

```text
config YAML
    │
    ├── BigQuery Google Patents ─┐
    ├── OpenAlex ────────────────┤
    ├── Semantic Scholar ────────┼─> data/raw/*/documents.jsonl
    └── PubMed (optionnel) ──────┘
                                      │
                                      v
                       nettoyage + chunking par section
                                      │
                                      v
                         data/processed/chunks.jsonl
                                      │
                         BGE-M3 dense + BM25 sparse
                                      │
                                      v
                            Qdrant local + fusion RRF
                                      │
                                      v
                    LlamaIndex + Ollama/vLLM + citations
                                      │
                                      v
                             CLI ou interface Streamlit
```

LlamaIndex fournit la frontière d'orchestration documentaire (`TextNode` et
`NodeWithScore`). Qdrant est utilisé directement pour conserver le contrôle sur les deux
vecteurs nommés, le filtrage des métadonnées et la fusion RRF. Cette approche est plus
simple à auditer qu'une chaîne d'agents généraliste et garde chaque étape exécutable seule.

## Prérequis

- Python 3.11 ou 3.12 recommandé. Python 3.14 peut ne pas encore être pris en charge par
  PyTorch et les bibliothèques d'embeddings.
- Qdrant local ou accessible sur le réseau interne.
- Ollama ou vLLM avec un modèle open-weight déjà téléchargé.
- Pour les brevets : un projet Google Cloud autorisé à interroger le dataset public
  `patents-public-data` et des identifiants Google Application Default Credentials.
- Accès Internet uniquement pendant l'ingestion et le premier téléchargement des modèles.
  Le prétraitement, l'indexation après téléchargement et les questions peuvent fonctionner
  hors ligne.

BigQuery peut facturer les octets analysés au-delà de son quota gratuit. Le connecteur fixe
`maximum_bytes_billed`, à 5 Go par défaut, pour faire échouer une requête trop coûteuse au
lieu de la lancer silencieusement. Modifier `BIGQUERY_MAX_BYTES_BILLED` en connaissance de
cause.

## Installation

Depuis `innovation-rag/` :

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[all]"
Copy-Item .env.example .env
```

Pour ne travailler que sur l'ingestion HTTP et le prétraitement :

```powershell
pip install -e ".[dev]"
```

Les ensembles facultatifs sont `bigquery`, `indexing`, `rag`, `app` et `dev`.

## Configuration du périmètre

Tous les paramètres métier se trouvent dans `config/soda.yaml`. Les quatre thèmes initiaux
sont les conservateurs/stabilité, les édulcorants, la carbonatation et les arômes. Pour
changer de pilote, copier ce fichier et modifier :

- `scope.domain` et `scope.themes` pour les expressions de recherche ;
- `scope.languages`, `date_from` et `date_to` ;
- `scope.patents.countries`, `ipc_prefixes` et `cpc_prefixes` ;
- les limites par source ;
- les modèles dense, sparse et génératif.

Le code ne contient aucun mot-clé métier fixe. Valider un fichier avant ingestion :

```powershell
beverage-rag validate-config --config config/soda.yaml
```

Les secrets et paramètres propres à la machine viennent de l'environnement. `.env` est lu
automatiquement, n'est jamais versionné et ne doit contenir aucune donnée documentaire.

## 1. Ingestion

Chaque source peut être exécutée séparément :

```powershell
beverage-rag ingest --source openalex --limit 100
beverage-rag ingest --source semantic_scholar --limit 100
beverage-rag ingest --source patents --limit 100
beverage-rag ingest --source pubmed --limit 50
```

Ou lancer les sources activées dans le YAML, dans la limite totale du pilote :

```powershell
beverage-rag ingest --source all --limit 300
```

Les sorties sont atomiques : `data/raw/<source>/documents.jsonl`. Un manifeste dans
`data/manifests/` indique la configuration, la limite demandée, le nombre obtenu et la date.
Relancer une source remplace son fichier, ce qui évite les doublons. Les identifiants sont
déterministes.

### Accès réseau et authentification

| Source | Réseau | Secret obligatoire | Contenu pilote |
|---|---:|---:|---|
| Google Patents/BigQuery | Oui | Identifiants GCP + projet | résumé, revendications, description, IPC/CPC |
| OpenAlex | Oui | Non | métadonnées OA et abstract reconstruit |
| Semantic Scholar | Oui | Non, clé recommandée | recherche bulk paginée, abstract et lien PDF OA |
| PubMed E-utilities | Oui | Non, clé facultative | abstract structuré et identifiants publics |

`OPENALEX_EMAIL` identifie poliment le client. `SEMANTIC_SCHOLAR_API_KEY` donne un quota
individuel et `NCBI_API_KEY` augmente éventuellement les quotas. Le pilote ne télécharge pas
et ne parse pas automatiquement les PDF OA : OpenAlex et Semantic Scholar fournissent donc
principalement les abstracts, avec le lien public vers le texte intégral lorsqu'il existe.

## 2. Prétraitement

```powershell
beverage-rag preprocess
```

Les brevets sont séparés en résumé, revendications individuelles et description. Les
publications conservent leurs sections existantes et détectent les titres Methods, Results,
Discussion et Conclusion lorsqu'un texte structuré est disponible. Chaque chunk conserve
le numéro de publication, DOI, titre, source, URL, date, pays, langue et classes IPC/CPC.

La taille est exprimée en mots, sans tokenizer propriétaire. Le fichier d'échange est
`data/processed/chunks/chunks.jsonl`.

## 3. Qdrant et index hybride

Démarrer Qdrant selon la procédure de l'organisation, par exemple avec l'image officielle
sur une machine de développement :

```powershell
docker run --name beverage-qdrant -p 6333:6333 -v qdrant_beverage:/qdrant/storage qdrant/qdrant
```

Puis :

```powershell
beverage-rag index
```

### Accélération GPU avec Google Colab

Pour un corpus volumineux sur une machine locale sans CUDA, ouvrir
`notebooks/beverage_rag_gpu_embeddings_colab.ipynb` dans Google Colab. Activer un runtime
GPU, puis exécuter les cellules dans l'ordre. Envoyer uniquement
`data/processed/chunks/chunks-20k.jsonl` — jamais `.env` ni une clé de service Google.

Après téléchargement et extraction de l'archive produite par Colab, importer les vecteurs
denses et calculer BM25 localement :

```powershell
beverage-rag index-precomputed `
  --embeddings data/precomputed/dense_embeddings_bge_m3.npy `
  --manifest data/precomputed/dense_embeddings_manifest.json `
  --config config/beverages-20k.yaml `
  --recreate
```

L'importeur valide le modèle, la dimension, le nombre de chunks et leur ordre avant toute
écriture dans Qdrant.

Le modèle dense par défaut est `BAAI/bge-m3`; le sparse est `Qdrant/bm25`. Les résultats
sont fusionnés par Reciprocal Rank Fusion. Une réindexation normale fait des upserts sans
supprimer la collection. La suppression n'est effectuée que sur demande explicite :

```powershell
beverage-rag index --recreate
```

## 4. Génération locale

Exemple Ollama :

```powershell
ollama pull qwen2.5:14b-instruct
ollama serve
beverage-rag ask "Quelles stratégies améliorent la stabilité aromatique d'un soda ?"
```

Pour vLLM, régler `generation.provider: vllm`, son modèle et son URL dans le YAML. Le prompt
impose une citation `[S1]`, `[S2]`, etc. Les citations affichées sont construites à partir des
métadonnées récupérées, jamais inventées par le modèle. Pour un brevet, le libellé est le
numéro de publication ; pour un article, le DOI est préféré puis le titre.

Si aucun passage pertinent n'est retrouvé, le LLM n'est pas appelé.

## 5. Démonstration Streamlit

```powershell
streamlit run app/streamlit_app.py
```

L'interface montre la réponse, les références, la section, le score hybride et le lien vers
la source publique.

## Pipeline pilote complet

Après configuration de BigQuery, Qdrant et Ollama :

```powershell
.\scripts\run_pilot.ps1 -Config config/soda.yaml -Limit 300
```

Ou :

```powershell
beverage-rag run-pipeline --limit 300
```

Le corpus pilote est produit localement par ces commandes afin de garantir sa provenance et
sa fraîcheur. Les fichiers JSONL téléchargés sont volontairement ignorés par Git. Aucun faux
document n'est fourni lorsque l'environnement n'a pas d'accès réseau.

## Tests

```powershell
pytest
```

Les tests couvrent la configuration, la normalisation OpenAlex, la paramétrisation SQL, le
nettoyage, le chunking par type, le format JSONL et la correspondance citations/sources. Ils
n'appellent aucun service externe et leurs identifiants sont explicitement marqués
`TEST-ONLY`.

## Format d'échange

Un document brut contient notamment :

```json
{
  "id": "identifiant-déterministe",
  "source": "openalex",
  "document_type": "publication",
  "external_id": "W…",
  "title": "…",
  "publication_date": "2025-01-01",
  "doi": "10.…",
  "url": "https://…",
  "sections": {"abstract": "…"},
  "metadata": {}
}
```

Un chunk ajoute `document_id`, `section`, `position`, `text` et recopie les métadonnées
requises pour citer la source sans nouvelle requête réseau.

## Limites connues

- La recherche BigQuery plein texte peut analyser un volume important malgré les filtres ;
  conserver une limite d'octets stricte et utiliser le cache de requête.
- Les connecteurs OpenAlex et Semantic Scholar indexent l'abstract, pas le contenu PDF. Un
  extracteur PDF OA avec contrôle de licence serait l'extension suivante.
- Les classes IPC/CPC et mots-clés réduisent le bruit mais ne constituent pas une taxonomie
  exhaustive des sodas.
- BM25 et BGE-M3 doivent être évalués sur un jeu de questions métier avant d'ajuster les
  poids, le nombre de candidats ou un reranker.
- Une publication de brevet n'implique ni validité juridique, ni liberté d'exploitation.
  Les réponses ne remplacent pas une analyse scientifique ou juridique.

## Prochaines étapes

1. Construire un jeu d'évaluation annoté (pertinence, fidélité, couverture des citations).
2. Ajouter le téléchargement et l'extraction contrôlés des PDF réellement open access.
3. Ajouter un reranker multilingue local si la précision du top-k est insuffisante.
4. Étendre progressivement la configuration à d'autres catégories de boissons.
5. Envisager LoRA/QLoRA uniquement si l'évaluation montre une limite persistante du RAG.
