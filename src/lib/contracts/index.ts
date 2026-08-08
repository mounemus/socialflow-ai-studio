/**
 * Contrats API partagés client ↔ serveur (source unique de vérité des payloads).
 *
 * Règle : chaque route qui `parse` un body doit importer son schéma d'ici, et
 * chaque composant client qui `POST` ce body doit le construire via le même
 * schéma (`schema.parse(payload)` avant `fetch`). Toute divergence de clé est
 * alors attrapée par le typage et par `tests/contracts.test.ts`.
 *
 * Extension : ajouter un fichier par domaine (`pipeline.ts`, `post.ts`, …) et
 * migrer les schémas inline des routes correspondantes.
 */
export * from './pipeline';
export * from './post';
