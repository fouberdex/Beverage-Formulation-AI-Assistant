# Contrôles généralisés de formulation

Le pipeline distingue désormais un symptôme, un mécanisme causal et son
applicabilité à la formulation décrite.

## Preuve causale

- `physical_precipitation_turbidity` sert à déclencher la recherche, mais ne peut
  plus être publié comme cause.
- Une cause doit correspondre à un mécanisme canonique éligible.
- Le titre et le passage sont vérifiés ensemble.
- Les groupes `question_entity_groups` empêchent d'appliquer une preuve
  pectine-protéine à une formulation qui ne mentionne ni pectine ni protéine, ou
  une précipitation de citrate de calcium sans source de calcium déclarée.
- Un symptôme large déclenche plusieurs pistes ciblées via `satisfied_by`, puis
  seuls les passages qui satisfont un mécanisme applicable et le seuil configuré
  sont envoyés au modèle.

## Sécurité des actions

Les règles de `config/chemistry-rules.yaml` retirent notamment :

- l'ajout de carbonate de calcium en présence d'acide citrique ;
- la réduction d'un conservateur sans validation microbiologique ;
- la réduction de l'acidité ou l'augmentation du pH lorsqu'elles peuvent modifier
  le goût ou l'efficacité du système conservateur.

La présence conjointe de benzoate et d'ascorbate produit automatiquement un point
de vigilance séparé. Ce signal n'est pas présenté comme la cause du trouble : il
impose une vérification analytique et réglementaire indépendante.

## Format et transparence

Le quality gate exige les quatre tableaux Markdown avec leurs colonnes exactes et
refuse les en-têtes fusionnés. L'interface indique séparément :

- toute valeur numérique du tableau de données doit être retrouvée dans le passage
  cité ; sinon la génération est rejetée puis révisée une seule fois ;
- la colonne `Portée` doit décrire la matrice et les conditions de l'étude et ne
  peut pas être une copie de la valeur ;

- le nombre total de passages récupérés ;
- le nombre de preuves retenues ;
- le meilleur score du reranker ;
- les tentatives de retrieval et de génération ;
- si Qwen a réellement été appelé ;
- les candidats rejetés, qui restent visibles mais ne soutiennent pas la réponse.

Une indisponibilité du tunnel Kaggle n'est jamais transformée en « lacune du
corpus » : le pipeline affiche une erreur explicite indiquant que le reranker ou
Qwen est inaccessible. Une lacune n'est produite qu'après une recherche Qdrant et
un reranking effectivement réalisés.
