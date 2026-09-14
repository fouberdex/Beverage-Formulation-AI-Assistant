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

## Calibration opérationnelle provisoire — 2026-09-13

Un test direct du service `BAAI/bge-reranker-v2-m3` déployé sur Kaggle a montré
que l'ancien seuil de lacune à 0,55 n'était pas compatible avec les scores observés :

- relation explicite « citrate de calcium → précipitation → trouble → boisson acide » : 0,42 ;
- document scientifique ciblé sur stabilité/sédimentation d'une boisson : 0,4443 ;
- documents ciblés pectine/protéine : 0,4182 à 0,5708 ;
- documents ciblés agent de trouble/émulsion : 0,5156 à 0,6396 ;
- meilleur résultat de la requête large initiale, non conforme au mécanisme : 0,0871 ;
- contrôles superficiels ou hors sujet : inférieurs à 0,01 dans le test synthétique.

Le seuil opérationnel provisoire est donc fixé à 0,40. Il ne suffit jamais seul :
la règle canonique entités + phénomène + contexte reste obligatoire. Le seuil de
niveau Modéré est aligné à 0,40 et son score calculé minimal à 44/100, soit
`0,80 × 0,40 + 0,20 × 0,60`. Les critères Fort restent inchangés.

Ce test est un smoke test de séparation, pas une validation statistique. Le jeu
annoté de production décrit ci-dessus reste obligatoire avant la démonstration finale.

## Valeurs actives

- Lacune si aucun mécanisme canonique ne correspond ou si le meilleur score est `< 0.40`.
- Source convergente si son score est `>= 0.40`.
- Fort : score calculé `>= 80`, meilleur reranker `>= 0.75`, au moins deux sources indépendantes.
- Modéré : score calculé `>= 44`, meilleur reranker `>= 0.40`, au moins une source indépendante.
- Toute cause sous Modéré est retirée du diagnostic et déplacée vers les données manquantes.

## Résultats finaux

À compléter après annotation et calibration. Aucun seuil ne doit être présenté comme
validé avant cette étape.
