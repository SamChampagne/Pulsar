# Qualité ↔ lots — I2g

## Parcours livré

Depuis WMS → Articles → Lots, **Préparer un contrôle** ouvre Qualité avec le lot préchoisi.
L’utilisateur sélectionne un plan actif, crée, démarre, renseigne et termine le contrôle.
Le lot reste bloqué jusqu’à une décision humaine distincte dans WMS. Le chemin inverse
Qualité → dossier source retrouve exactement le lot, même hors de la première page.

Une inspection prend au plus une source : indépendante, réception, OF, SAV ou lot.
Le choix est immuable à la création : aucun ancien PASS n’est rattaché rétroactivement.
Le plan/critères restent copiés et immuables selon le workflow Qualité existant.

## Contrat et fraîcheur

- FK composites tenant/article/lot. La migration additive 126 ne modifie aucun contrôle historique.
- À la création : identité article/lot et dates déclarées capturées en JSON, révision de
  disposition et compteur du registre StockMovement pour ce lot, tous sites du tenant.
- Verrou business puis mutex tenant WMS, jamais l’ordre inverse. La clôture relit ce contexte
  sous les mêmes verrous. Un mouvement (y compris MOVE net zéro) ou une décision différente
  refuse la clôture : annuler l’inspection ouverte et en préparer une nouvelle.
- Le compteur est conservateur : pas de certification d’un échantillon, aucune déduction de
  stabilité physique depuis un solde inchangé. Aucune réservation de stock pendant le contrôle.
- Un FAIL ouvre une NC comme avant. PASS, FAIL et clôture de NC n’ont aucun effet sur le stock.

## Libération avec preuve facultative

Le parcours WMS autonome avec motif/compte rendu reste disponible. Quand Qualité est active,
la libération peut citer explicitement `qualityInspectionId` + `expectedInspectionUpdatedAt`.
Sous le verrou WMS : même tenant/article/lot, contrôle COMPLETED/PASS, version exacte,
révision de quarantaine actuelle et compteur de mouvements inchangé. Refus autrement.

Il n’existe pas encore de politique imposant une inspection pour toute libération, ni de
séparation obligatoire contrôleur/approbateur. Le choix manuel reste une décision explicite
d’un utilisateur habilité; ce palier ne constitue pas un dispositif de conformité réglementaire.

Décision append-only, disposition et résumé immuable du contrôle sont atomiques. Le résumé
comprend numéro/objet/plan/version/résultat/date et contexte capturé. Après libération ou
nouvelle quarantaine, ce résumé historique ne change pas. Il ne justifie pas une nouvelle
libération. Le fingerprint inclut la référence seulement si fournie; anciens fingerprints
manuels préservés. Replay exact avant version, mais après droits/modules courants.

## Droits et lectures

- LOT en Qualité exige WMS actif + wms.read pour référencer et terminer; Qualité reste gardée
  par quality.read/manage. Les données source et lotContext sont masqués sans lecture WMS.
- La citation d’une preuve exige Qualité active + quality.read, en plus des droits existants
  wms.read/manage/lots.release. Les listes et l’historique n’exposent pas la preuve structurée
  si Qualité est désactivée ou le droit manque. Les textes libres saisis restent ceux du
  module où ils ont été saisis : ne pas les traiter comme une copie protégée de la source.
- GET `wms/items/:itemId/lots/:id/quality-inspections` : contrôles propres au lot, pagination;
  `releaseEligible=true` limite aux candidats actuels. C’est une indication à la lecture,
  pas un droit acquis; le writer revérifie sous verrou.
- GET `.../affected-preparations` : PickOrder OPEN/PICKED avec lignes exactes de ce lot,
  tenant-scopé, paginé, sans sommer des unités différentes. Aucun dossier modifié.
- Le journal existant couvre les mouvements historiques et les sources Services/Fabrication
  selon leurs droits. Pas de généalogie transitive, rappel client ou propagation automatique.

## UI, reprise et limites

Panneaux progressifs Pulsar existants, pas de nouveau shell. Erreurs visibles, contexte figé
et motif d’obsolescence expliqués. Le stockage navigateur conserve avant envoi la demande
exacte de libération, clé/corps/contrôle/version; refus intermédiaire pendant reprise ne
l’efface pas. Une panne du stockage empêche l’envoi. Pas de mode hors ligne complet.

Tutoriels métiers WMS/Qualité et Documentation intégrée décrivent les liens; aucune remise
à zéro de la première visite. Aucun pouvoir IA ajouté, contrôle métrologique, signature
réglementaire, échantillonnage, quarantaine partielle, destruction ou retour fournisseur.

## Recette

HTTP isolés : liaison explicite, source masquée, fraîcheur net zéro, entrées ultérieures,
PASS/FAIL/brouillon, version et lot erronés, reprise concurrente idempotente, re-quarantaine,
historique immuable, gating actuel même au replay, préparations ouvertes et stock inchangé.
Navigateur : création → résultats → retour au lot → citation → réponse perdue → refus
intermédiaire → reprise exacte; contexte périmé; preuve masquée et affichage bureau/mobile.

Suite : revue de généalogie aval transitive et dossiers déjà servis, puis workflows distincts
de destruction/rebut et retour fournisseur. Ne jamais simuler ces opérations en libérant un lot.

## Vérifications locales — 2026-09-25

Migration 126 validée/appliquée uniquement à `pulsar_enduser_20260921`; `.env` inchangé.
249 tests HTTP sur 14 suites réussis, puis 49 ciblés rejoués après le garde partagé d’ownership.
687 tests unitaires API et 152 Web réussis. Builds Database/API/Web réussis; Svelte zéro erreur,
12 avertissements préexistants dans cinq fichiers. Aucun push, PR ni déploiement.
40 scénarios Chromium réussis, dont parcours Qualité complet, reprise après réponse perdue
puis refus temporaire, première visite Qualité d’un utilisateur neuf et régressions WMS/atelier.
Captures bureau et mobile inspectées : preuve de libération lisible et aucun débordement à 390 px.
