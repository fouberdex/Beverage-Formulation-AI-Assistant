# Diagnostic des rejets de preuve

La trace diagnostique est séparée de la réponse RAG en huit sections. Elle ne doit
jamais être copiée dans `RagAnswer.answer` ni affichée dans l'interface de production.

## Modes et confidentialité

Le journal opérationnel est écrit sur le poste qui exécute Streamlit, pas dans le
notebook Kaggle. Par défaut, `question_text` et `query_text` sont absents : seuls
leurs SHA-256 sont conservés. Aucun texte intégral de chunk, token ou secret n'est
journalisé. Le fichier est limité à 25 Mo, avec cinq sauvegardes et une purge des
sauvegardes après 30 jours.

La commande explicite suivante reproduit le plan de requêtes de production, mais
ne génère pas la réponse finale :

```powershell
python -m beverage_rag.cli diagnose "question" --config config/beverages-20k-gpu.yaml
```

Elle peut appeler Qwen uniquement si la production aurait utilisé la décomposition
LLM. Les sous-requêtes originales, canoniques, décomposées, équilibrées par source
et de nouvelle tentative sont toutes identifiées par `query_kind`. Cette sortie
locale contient les requêtes en clair par défaut. Sur une machine partagée ou
temporaire, utiliser `--redact-query-text` et ne pas employer `--output`.

## Champs de requête

- `hybrid_candidate_count` : passages retournés par la recherche hybride avant reranking.
- `reranked_count` : passages de cette voie encore visibles dans la sortie rerankée.
- `best_reranker_score` : meilleur score continu disponible pour cette voie.
- `reranker_threshold` : seuil appliqué par la politique de preuve.
- `reranker_margin` : score moins seuil; négatif signifie sous le seuil.
- `independent_sources` : documents ou familles de brevets indépendants au-dessus du seuil de support.
- `score_basis` : précise si le score vient du reranking fusionné ou d'une requête mécanistique dédiée.
- `top_candidates` : identifiants, titres publics et scores; jamais le texte intégral.

## Champs de mécanisme

- `mechanism_match` : au moins un passage satisfait la règle causale canonique.
- `matching_chunks` : nombre de passages qui satisfont cette règle.
- `calculated_score` : score déterministe combinant reranker et indépendance des sources.
- `proof_margin` : score calculé moins seuil minimal de preuve modérée.
- `source_deficit` : sources obtenues moins sources exigées.
- `blocking_condition` : condition précise ayant empêché l'éligibilité.

Les catégories sont `no_candidates`, `far_below_threshold`, `near_threshold`,
`above_threshold_no_mechanism_match` et `eligible`. La marge initiale de quasi-succès
est 0,05, mais chaque écart continu est conservé afin de la recalibrer sur sa
distribution réelle.

## Mécanismes non répertoriés

La taxonomie n'est pas une liste fermée des questions autorisées. Lorsqu'aucun
mécanisme canonique ne correspond à la question, le pipeline génère des requêtes
techniques, puis vérifie chaque cause produite contre ses propres passages cités avec
le cross-encoder. La trace porte alors `query_kind: dynamic_claim_verification` et
`score_basis: claim_specific_cross_encoder`.

Le niveau de preuve reste déterministe : même seuil reranker, même décompte de sources
indépendantes et même formule que pour un mécanisme canonique. Une cause dynamique sous
le seuil est retirée individuellement; elle ne supprime pas les autres causes soutenues.

## Taxonomie et annotations

`config/mechanism-taxonomy.yaml` est gelé en version 1 pour la première calibration.
Chaque question annotée doit utiliser une famille de cette taxonomie. Toute évolution
exige une nouvelle version et la revue des annotations. Le minimum exploratoire est
60 questions équilibrées; la cible est 120 à 150, avec 20 % réservés à la validation.

Le format attendu est donné par `eval/corpus-coverage-template.yaml`. L'évaluation se
lance avec :

```powershell
python eval/evaluate_corpus_coverage.py eval/questions-annotees.yaml
```

Elle produit les cas individuels, les traces JSONL, la distribution complète des
marges, leurs quantiles et un balayage des seuils. Elle ne modifie jamais la config.

## Règle de décision préenregistrée

Sur le jeu de calibration, seuls les seuils dont le taux de publication sans
couverture est inférieur ou égal à 5 % sont admissibles. Parmi eux, retenir celui
qui minimise le taux de lacune lorsque le corpus couvre réellement le sujet. En cas
d'égalité, retenir le seuil le plus élevé, donc le plus prudent.

Le seuil choisi est évalué une seule fois sur les 20 % de validation, sans nouveau
réglage. Si la contrainte de sécurité échoue sur cette réserve, aucun seuil n'est
déployé : il faut augmenter le jeu annoté ou revoir retrieval/taxonomie. La décision
finale reste une revue humaine explicite; le script ne réécrit jamais
`evidence-policy.yaml`.

La reformulation automatique demeure désactivée dans `config/diagnostics.yaml` tant
que cette première évaluation n'a pas été examinée.
