# Calibration de la politique de preuve

Statut : seuils initiaux non encore validés sur un jeu annoté de production.

Les valeurs actives se trouvent exclusivement dans `config/evidence-policy.yaml`.
Elles ne doivent pas être interprétées comme des probabilités scientifiques.

## Définition du mécanisme

Un embedding ou un chevauchement lexical ne peut jamais valider une preuve. Un chunk
doit satisfaire une règle canonique : entités requises, phénomène observé et contexte
boisson dans une même phrase ou deux phrases adjacentes. Une liste d'ingrédients seule
ne suffit pas. Un mécanisme non classifié ne peut pas être Fort ou Modéré.

## Jeu d'évaluation

Utiliser les questions de `eval/evidence-questions.yaml` et compléter avec au moins
15 à 20 questions industrielles. Pour chaque question et sous-requête, annoter les
premiers chunks dans un JSONL comportant :

```json
{"question_id":"citrus_turbidity_gap","chunk_id":"...","reranker_score":0.71,"mechanism_match":true,"relevant":true,"annotator":"..."}
```

Les annotations doivent distinguer : pertinent, superficiellement lié, hors sujet,
et mécanisme explicitement établi. Les questions servant à la validation ne doivent
pas servir à choisir le seuil.

## Sélection des seuils

Exécuter :

```powershell
python scripts/calibrate_evidence_thresholds.py eval/evidence-annotations.jsonl --target-precision 0.95
```

Le seuil retenu doit atteindre au moins 95 % de précision pour les preuves acceptées.
Documenter ici la taille du jeu, sa date, son hash, les versions des modèles, la
précision, le rappel, les faux positifs et les faux négatifs, puis reporter les valeurs
validées dans `config/evidence-policy.yaml`.

## Valeurs initiales

- Lacune si aucun mécanisme canonique ne correspond ou si le meilleur score est `< 0.55`.
- Source convergente si son score est `>= 0.60`.
- Fort : score calculé `>= 80`, meilleur reranker `>= 0.75`, au moins deux sources indépendantes.
- Modéré : score calculé `>= 60`, meilleur reranker `>= 0.60`, au moins une source indépendante.
- Toute cause sous Modéré est retirée du diagnostic et déplacée vers les données manquantes.

## Résultats finaux

À compléter après annotation et calibration. Aucun seuil ne doit être présenté comme
validé avant cette étape.
