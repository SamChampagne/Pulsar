# CRM — carnet autonome et engagement des commandes (E1b.5)

## Constat et périmètre

Suite du programme enterprise, exigences CL01/CL03/CL07 et CR02–CR03 partiellement
couvertes, pas closes. La société CRM ne possédait pas de carnet versionné et la commande
n’avait aucune copie de coordonnées. Son workflow relisait le statut avant le verrou et
l’édition pouvait modifier la devise après confirmation. Ces constats sont corrigés ici.

CRM seul suffit : aucun module Transport, Clients, Catalogue ou Facturation requis.
Le carnet existant est étendu à un troisième propriétaire exclusif `CrmCompany` :
Customer **ou** BusinessPartner **ou** CrmCompany, vérifié par XOR SQL et FK composite tenant.
Aucune fiche n’est fusionnée ou créée dans un autre registre. Un lien Customer existant
reste distinct du propriétaire de la copie CRM. Les contacts CRM de prospection ne sont
pas migrés dans ce carnet et ne confèrent aucune autorité commerciale ou portail.

## Contrats

- `crm/companies/:id/directory` : lectures, révisions append-only, clés de reprise
  tenant/acteur/corps. Droits `crm.read` et, pour écrire, `crm.manage`. Les anciennes
  empreintes de reprise des carnets Customer/BusinessPartner restent identiques.
- `crm/sales-orders/:id/coordinates` : GET revue; PATCH avec `expectedUpdatedAt`, motif
  et les trois sélections explicites (identifiant/version ou null). Résolution serveur,
  tenant/société/type/activité/validité contrôlés. Société PROSPECT ou ACTIVE admise;
  INACTIVE refusée. Aucun code société inventé : `owner.code` est vide.
- Ordre des verrous : business tenant, puis ligne tenant commune aux lignes/MRP.
  La confirmation relit la commande après verrou, contrôle la version attendue et
  `canTransitionSalesOrder`, revalide le carnet/l’identité puis fige dans le même CAS.
  Les writers de société ne prenant pas le verrou business, un verrou partagé de ligne
  protège la lecture de l’identité au gel. L’adresse valide utilise la date civile du
  fuseau business capturé, pas le fuseau d’affichage personnel.
- Une copie exige la version à confirmation et édition de métadonnées; les clients UI
  transmettent la version à toutes les transitions. Les anciennes intégrations sans
  copie restent compatibles. Après réponse perdue : lecture avant toute nouvelle action,
  pas de transition rejouée automatiquement ni de nouvelle clé de carnet improvisée.
- Les edits de lignes avancent la version parent. La devise est immuable hors DRAFT;
  avec des lignes, il faut les retirer pour changer de devise. Aucune conversion
  implicite des prix. La création d’une ligne relit la devise sous le verrou.
- Notes/responsable restent des métadonnées éditables à version contrôlée si copie;
  cela ne réécrit pas le snapshot. Un responsable fourni est un utilisateur interne actif
  du tenant, pas un compte de service. Annuler ne supprime pas une copie déjà figée.

## Parcours et interface

Société → **Adresses et contacts du carnet**; commande → **Coordonnées** → **Carnet de la
société** sans quitter le dossier. Composants Pulsar existants, drawer et sélecteur paginé.
Sélection/adresse à revoir et mutation en cours empêchent une confirmation involontaire.
Après réponse incertaine, un bouton de vérification relit l’état enregistré.
Les vues desktop/mobile, la lecture seule et le tutoriel sont vérifiés dans la recette.
Tutoriel CRM en six étapes métier, première ouverture par utilisateur uniquement;
aucun nouveau bouton permanent ni réinitialisation des parcours déjà vus.

## Effets aval et limites

La copie ne remplit ni Location, BOL, email, facture, demande MRP ou droits portail.
Le workflow CRM émet ses événements existants; les politiques configurées continuent à
réagir selon leurs règles. Les validations Fabrication/Transport/Facturation restent
requises. Aucun nouveau pouvoir agent, envoi externe, stock ou montant recalculé ici.
Les commandes historiques restent sans copie; aucune tentative de reconstruire leur passé.
Le CRM reste sans avenants commerciaux, PDF canonique, multi-payeur ni rapprochement
transversal des identités. La propagation revue et les commandes fournisseurs sont la suite.

## Déploiement et preuves

Migration additive `20260924050000_crm_order_coordinates`, puis génération Prisma,
builds Shared/Database/API/Web. Requiert la chaîne précédente de migrations E1.
Recette uniquement sur `pulsar_enduser_20260921`; aucun `.env` ou environnement distant modifié.
Tests ciblés : `crm-order-coordinates.e2e-spec.ts`, `crm-sales-orders.e2e-spec.ts`,
`module-autonomy.e2e-spec.ts`, et `crm-order-coordinates.spec.ts` côté navigateur.
Les résultats exacts sont consignés dans l’état du projet une fois exécutés.

Recette du 24 septembre : 10 nouveaux scénarios HTTP, 48 d’autonomie, 7 commandes CRM
historiques et 66 ponts Transport/MRP, soit 131 tests distincts réussis (rejeux exclus).
935 tests Shared, 686 API unitaires, 129 Web et deux parcours Chromium réussis.
Captures desktop/mobile inspectées; première visite puis non-réapparition du tutoriel
vérifiées sur le lecteur dédié. Le parcours couvre aussi l’écriture réellement commise
suivie d’une réponse interrompue, pour coordonnées puis confirmation, sans double POST.
Builds complets réussis; Svelte : 0 erreur, 12 avertissements préexistants hors lot.
