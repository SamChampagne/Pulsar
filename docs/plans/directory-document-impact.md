# Carnet — usages et impact sur les documents (E1b.7)

## Périmètre et parcours

Suite du programme enterprise, CL01/CL03/CL07 partiellement fondés, pas clos.
Le carnet et les copies documentaires existaient; il fallait ouvrir chaque dossier
pour découvrir les usages d’une adresse/contact. Ce lot ajoute une lecture inverse.

Carnet → **Documents liés** sur une entrée → type de document et périmètre →
**Ouvrir … dans un nouvel onglet**. Le carnet et son éventuel dossier parent restent
ouverts. Les devis Services disposent maintenant du lien direct `?quoteId=…`.
Les autres liens utilisent les destinations existantes : facture `?statement=…`,
achat `?orderId=…`, détail de commande Transport/CRM.

Deux vues volontairement distinctes :

- **Brouillons à vérifier** : DRAFT ayant choisi explicitement cette entrée. Chaque
  usage indique version choisie et écart de version/validité. « Entrée à jour » ne
  signifie jamais que l’identité, toutes les coordonnées ou tout le document sont validés.
- **Copies engagées · historique** : document non DRAFT avec copie réellement figée,
  y compris payé, terminé, clôturé ou annulé après engagement. Aucun avertissement de
  version courante n’est présenté comme une correction obligatoire de ce passé.

La liste n’est pas une simulation d’une modification encore non enregistrée. Elle
lit l’état courant, avant ou après une édition du carnet. La version suivante ne
s’applique jamais automatiquement à un document; ouvrir le brouillon et revoir les
choix dans son workflow reste obligatoire.

## Contrat API et autorité

`GET <façade-carnet>/:ownerId/directory/:id/impact`

Filtres fermés : `source`, `scope=DRAFT|FROZEN`, `page`, `pageSize` (1–100).
Le type par défaut est le premier type autorisé avec des résultats dans le périmètre,
sinon le premier autorisé. Pagination par type, total exact pour ce type; ordre
`updatedAt desc, id asc`. Les pages peuvent évoluer entre deux requêtes concurrentes.

Sources actuelles :

| Identité du carnet | Documents              | Module et droit de lecture requis en plus du carnet |
| ------------------ | ---------------------- | --------------------------------------------------- |
| Customer           | Factures clients       | billing + billing.customer-invoices.read            |
| Customer           | Commandes Transport    | transportation + transportation.orders.read         |
| BusinessPartner    | Devis Services         | services + services.read                            |
| BusinessPartner    | Commandes fournisseurs | purchasing + purchasing.read                        |
| CrmCompany         | Commandes CRM          | crm + crm.read                                      |

La façade impose d’abord son module et sa permission de lecture. Chaque source est
ensuite filtrée côté serveur par modules activés et permissions du JWT. Aucun compteur,
nom, lien ou nombre de documents masqués n’est exposé. Un type explicitement demandé
mais indisponible est refusé par 403, sans révéler la présence de documents.
Les limites de rafraîchissement JWT/cache des modules restent celles de la plateforme.

Le tenant vient exclusivement du JWT. Le parent et l’entrée sont vérifiés, puis chaque
requête exige à la fois la FK réelle du document, le propriétaire/type du snapshot,
son schéma v1 et l’identifiant d’entrée dans un de ses rôles. Une même entrée utilisée
en facturation et livraison produit un document, avec deux usages, pas deux documents.
Un lien CRM → Customer ou BusinessPartner → Customer ne traverse jamais cette frontière.

La projection ne renvoie que numéro, statut, lien, version/date du document, rôles,
versions choisies et explication d’écart. Ni adresses privées, notes, montants, lignes,
identité d’acteur ni snapshots complets. `directoryEntryImpact` réutilise le contrôle
pur existant `reviewDocumentCoordinates` sur cette entrée seulement.

Entrée, compteurs et page partagent une transaction de lecture REPEATABLE READ; aucune
écriture, tâche, événement, audit de mutation, recalcul ou outil agent n’est ajouté.
Pas de registre matérialisé, migration ou backfill. Les données de chaque type sont
filtrées en base; une seule page de copies est chargée pour la projection, jamais tout
l’historique en mémoire. Pas de qualification de charge à grande échelle dans ce lot.

## Interface et documentation

Les composants Pulsar existants, typographie, couleurs et panneau du carnet sont
conservés. L’action se replie dans ce panneau, sans nouvelle application ou empilement
de dialogue. États chargement, erreur avec reprise, zéro résultat et aucune source
accessible sont explicites; filtres et pagination sont utilisables au clavier/mobile.

Documentation intégrée mise à jour dans Clients, Services, Achats, Transport,
Facturation et CRM. Leurs étapes de tutoriel existantes sont enrichies avec leur
vocabulaire métier, sans nouvelle séquence générique ni remise à zéro de progression.

## Limites et prochaine étape

Un résultat vide ne prouve pas une absence d’usage global. Ne sont pas recensés :
documents sans capture, captures annulées sans engagement, adresses principales,
PDF d’avoirs/factures, emails, Locations, commandes matières MRP, affiliations portail,
autres identités ou modules non autorisés. Aucune déduction par nom, code ou courriel.
Ce périmètre est rappelé dans l’écran et ne constitue pas une validation de conformité.

Prochain lot : **rapprochement humain des identités Customer/BusinessPartner/CrmCompany**,
en inspectant d’abord les liens existants, sans fusion automatique, sans droits hérités
ni réécriture historique. Les quatre rôles donneur d’ordre/livré/facturé/payeur,
l’identité/adresse acheteur et les sorties commerciales restantes demeurent ouverts.

## Recette locale

Base isolée `pulsar_enduser_20260921`; `.env` intact. Aucun push, PR, déploiement,
email réel ou modification de l’environnement distant. API de test sur 3100, Web 5173.

Tests : `directory-impact.spec.ts` (Shared), `directory-impact.e2e-spec.ts` (HTTP)
et `apps/web/e2e/directory-impact.spec.ts` (Chromium), avec régressions coordonnées
CRM/fournisseurs, autonomie et fondations métier. Les fixtures HTTP de lecture sont
explicites; le parcours navigateur construit et engage une vraie commande via les API.
Résultats du 2026-09-24 :

- 940 tests Shared, 686 unitaires API et 130 Web réussis.
- 115 tests HTTP sur cinq suites : impact du carnet (11), coordonnées fournisseurs (9),
  fondations métier (37), autonomie des modules (48) et coordonnées CRM (10).
- Sept parcours Chromium : trois nouveaux (reprise après erreur, droits limités,
  ouverture exacte du devis), quatre régressions Achats/CRM avec tutoriels de première visite.
- Captures desktop/mobile inspectées; aucun débordement horizontal à 390 px.
- Builds Shared/API/Web réussis; vérification Svelte sans erreur, douze avertissements
  préexistants dans cinq fichiers. Vérification des espaces Git propre.

Aucune nouvelle migration : les 117 migrations existantes restent celles de la base isolée.
Ces contrôles ne constituent pas une qualification de charge ni une recette sur le serveur OVH.
