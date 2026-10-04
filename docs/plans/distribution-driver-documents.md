# Distribution — document de tournée chauffeur sûr

Lot local du 3 octobre 2026. Complète les manifestes internes D2a et le poste
chauffeur D2b. Aucun déploiement ni appel transporteur; Transport fonctionne seul.

## Parcours utilisateur

Dans le dossier d'un chargement, **Document de tournée chauffeur** :

1. Affecter le chauffeur et préparer les expéditions, adresses, arrêts et colis.
2. Ouvrir l'aperçu. Il montre exactement les données diffusables : numéros de
   tournée/expédition, noms des ressources affectées, adresses opérationnelles,
   ordre des arrêts et codes des colis non annulés/non retournés.
3. Saisir un motif interne et confirmer **Publier au chauffeur**. Une édition DL
   immuable est créée; aucun dispatch, chargement physique ou remise n'en découle.
4. Préparer le PDF. Le chauffeur voit la dernière publication compatible avec sa
   mission active et peut télécharger ce PDF quand il est prêt. Il ne peut pas
   émettre, modifier ou générer un document lui-même.
5. Après modification d'une adresse, d'une affectation ou des colis à distribuer,
   publier une nouvelle édition. L'ancienne reste consultable en interne, mais
   n'est plus téléchargeable avec le lien chauffeur. La progression normale des
   arrêts et confirmations physiques ne périme pas une édition inchangée.

Ce document est une **feuille de tournée opérationnelle**, pas un détail commercial
des marchandises, BOL réglementaire, document douanier, signature ou POD. Les codes
listés n'attestent pas que les colis sont physiquement chargés ou livrés. Aucun
statut courant n'est imprimé comme s'il était une observation en temps réel.
Un PDF déjà téléchargé ne peut pas être retiré de l'appareil du chauffeur :
consulter la mission en ligne et remplacer les copies après une nouvelle édition.

## Données et frontières

Le snapshot est une projection fermée dédiée. Il ne reprend **jamais** un BOL ou
manifeste historique. Sont exclus : notes, motif d'émission, libellés/contenus libres
des colis, prix/coûts, carnet de contacts privés, téléphone/email du chauffeur,
IDs internes, jetons d'accès, URLs privées et chemins de stockage.

Les adresses sont celles des Locations opérationnelles et non des adresses de
facturation privées. Une revue humaine de l'aperçu reste indispensable avant
diffusion. Le BOL public historique reste refusé en 409; les manifestes D2a restent
privés, sans nouveau point d'accès public ou permission agent.

`DriverDeliveryDocument` conserve snapshot, scope d'identité privé, sourceHash,
scopeHash, snapshotHash, numéro/révision, motif interne, acteur, clé/fingerprint,
référence et hash du PDF canonique. FK tenant pour load/acteur/document; uniques
tenant/numéro, tenant/load/révision et tenant/opération UUIDv4. Trigger SQL : données
publiées immuables; seulement première liaison document/hash autorisée. Pas de backfill.

- Le sourceHash canonique couvre snapshot + scope, y compris la version Load et
  les coordonnées réellement affichées. Aperçu et émission RepeatableRead;
  verrou opération puis Load. Relecture de tout le contenu avant comparaison
  version/hash, numérotation via SequencesService et audit atomiques.
- Le scopeHash couvre identités, ressources, adresses, ordre et colis, mais ignore
  Load.updatedAt. Les états, heures de progression et détails privés n'y figurent
  pas. Une ancienne édition devient inaccessible si son contexte public change.
- Le snapshotHash lie aussi numéro, révision, date UTC, raison privée et sourceHash.
  Lecture et rendu vérifient l'intégrité, sans réinterprétation historique.
- Émission par un utilisateur humain actif (ni agent ni compte de service), avec lecture+gestion planification et
  `confirmDriverPublication=true`. Rejeu exact avant versions courantes; même
  clé avec autre acteur/corps/load refusée. Conflits SQL 40001/P2034/uniques : 409,
  aucune nouvelle tentative automatique. Aucun événement opérationnel émis.
- Aucun document nouveau après clôture, sans chauffeur ou sans expédition active.
  Une expédition suivie doit disposer d'au moins un colis à distribuer; les
  dossiers legacy sans suivi restent explicitement identifiés, sans inventer de colis.

## Canonique et lecture publique

Génération depuis le snapshot seulement, verrou de fichier distinct du Load.
DocumentsService écrit la ligne Document dans la transaction du cache canonique;
fichier et hash sont associés une seule fois. La vérification binaire s'effectue
après libération de la transaction : pool PostgreSQL d'une connexion supporté.
Le stockage binaire peut laisser un objet non référencé après rollback; aucun
chemin public ne l'expose. La gestion de ces orphelins reste de l'exploitation.

Type `driver-delivery-document-pdf` réservé au dossier : upload, listes génériques,
download, URL présignée, confirmation et suppression refusés. Métadonnées exactes
tenant/dossier/type/MIME/taille et SHA-256 vérifiés à chaque téléchargement. Un PDF
corrompu échoue sans régénération ni remplacement implicite d'une preuve.

Le lien chauffeur est une capability confidentielle. DriverAccessService verrouille
Load et revérifie jeton, tenant actif et Transport activé directement en base.
Lecture réservée à DISPATCHED/IN_TRANSIT; seule la dernière édition est candidate.
La référence HMAC est liée au jeton et au type `document`, pas un ID brut.
Le scope est recapturé avant accès. Après lecture du stockage hors transaction,
le jeton, scope, dernière édition et état sont revérifiés avant envoi des octets.
Les réponses sont no-store/no-referrer. Aucune génération publique de PDF.

## API et droits

Base interne `/api/v1/transportation/loads/:loadId/driver-documents` :

- `GET /preview` : snapshot, sourceHash, canIssue et blockers.
- `GET /` : historique paginé; `GET /:id` : copie figée (motif privé inclus).
- `POST /` : operationKey UUIDv4, expectedLoadUpdatedAt ISO, sourceHash SHA-256,
  reason 1–300 caractères sans contrôles, confirmDriverPublication=true.
- `POST /:id/file` : prépare et vérifie le PDF; `{ready:true}` seulement après contrôle.
- `GET /:id/file` : PDF déjà préparé, aucun rendu implicite.

Transport activé, `transportation.planning.read` sur lectures; lecture +
`transportation.planning.manage` pour émission et préparation.

Public `/api/v1/public/driver/:token/documents` :

- `GET /` : `{documents:[{ref,number,revision,issuedAt,ready}],message}` (au plus un).
- `GET /:ref/file` : PDF vérifié de cette publication courante seulement.

Aucun ID tenant/load/document ou motif privé dans la réponse publique.

## Limites et reprise

200 expéditions, 2 000 colis et 500 arrêts; 5 Mio de données, PDF 10 Mio.
Lettre multipage, alphabet latin Windows-1252 dont le français; scripts non pris
en charge et contrôles refusés sans translittération ou troncature silencieuse.
Un code colis n'est ni SSCC ni code transporteur tiers. Le champ « contenu »
reste dans le poste colis autorisé, pas sur cette feuille de tournée.

L'UI conserve avant envoi l'intention exacte dans sessionStorage, par tenant,
utilisateur et chargement. Aucun renvoi automatique. Après erreur, reprendre
la même clé/corps ou inspecter l'historique puis confirmer l'oubli de l'intention
locale. L'oubli n'annule pas la publication; ce n'est pas une file hors ligne durable.

Tests dédiés : `driver-documents.service.spec.ts`, `driver-document-render.spec.ts`
et `apps/api/test/driver-documents.e2e-spec.ts`; parcours UI dans
`apps/web/e2e/driver-documents.spec.ts` et `driver-documents.mobile.spec.ts`.
La suite HTTP cible uniquement
une base jetable migrée; aucune preuve locale ne vaut validation VPS/terrain.
