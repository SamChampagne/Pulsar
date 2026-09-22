/** Planned products, not available module implementations or working tutorials. */
export const SECTOR_ROADMAP = [
  {
    key: 'rental',
    title: 'Location',
    purpose: 'Réserver des équipements, suivre départs, retours et dommages.',
    owner:
      'Tables propres : équipements louables, réservations, contrats et inspections de retour. Identités communes explicites avec Flotte/WMS, jamais une copie cachée.',
    links:
      'Catalogue pour clients et prestations; Flotte pour maintenance; Services pour remise en état; Finance pour dépôt et facturation à concevoir.',
    flow: [
      'Définir l’équipement, sa disponibilité et son calendrier.',
      'Réserver une plage sans chevauchement puis confirmer le départ.',
      'Inspecter le retour, enregistrer les dommages et fermer la location.',
    ],
    tutorial:
      'Visite : parc → calendrier → réservation → retour. Exercice de conflit de réservation et de retour endommagé.',
    gate: 'Contrats, dépôts, signatures, tarifs et effets sur disponibilité ne sont pas implémentés. Aucun paiement ou disponibilité garanti.',
  },
  {
    key: 'pos',
    title: 'Commerce et caisse',
    purpose: 'Vendre au comptoir, suivre panier, tickets, retours et fermeture de caisse.',
    owner:
      'Tables propres : sessions de caisse, paniers, ventes, lignes et remboursements; Catalogue garde les produits, WMS les quantités.',
    links:
      'Catalogue/prix → caisse → fiscalité Finance → stock WMS. Paiements externes dans un connecteur explicite et idempotent.',
    flow: [
      'Ouvrir une session et identifier le magasin.',
      'Scanner les articles, contrôler prix/taxes et demander le paiement.',
      'Émettre le ticket, puis rapprocher la session et traiter les retours.',
    ],
    tutorial:
      'Mode bac à sable pour scan, paiement simulé clairement signalé, réponse perdue et retour; aucun encaissement réel pendant le tutoriel.',
    gate: 'Aucun terminal bancaire, paiement, ticket fiscal ou mode hors ligne livré. Les règles fiscales demandent un lot validé séparément.',
  },
  {
    key: 'restaurant',
    title: 'Restauration',
    purpose: 'Coordonner salle, commandes et production cuisine.',
    owner:
      'Tables propres : salles, tables, cartes, tickets cuisine, services et additions. Recettes métier distinctes des nomenclatures industrielles.',
    links:
      'Catalogue pour ingrédients/prestations, WMS pour approvisionnement, Cuisine pour préparation, Caisse pour encaissement futur.',
    flow: [
      'Préparer salle, carte et postes cuisine.',
      'Prendre la commande avec options et contraintes déclarées.',
      'Envoyer les tickets, suivre la préparation et clôturer l’addition via la caisse.',
    ],
    tutorial:
      'Visite : plan de salle → commande → tickets cuisine → addition; scénario d’annulation d’un plat déjà envoyé.',
    gate: 'Gestion des allergènes, sécurité alimentaire, recettes valorisées, écrans cuisine et caisse non implémentés. Aucun contrôle sanitaire garanti.',
  },
  {
    key: 'ecommerce',
    title: 'Boutique en ligne',
    purpose: 'Publier les produits et suivre les commandes web jusqu’à la livraison.',
    owner:
      'Tables propres : boutiques, publications, paniers, commandes web et remboursements. Sites reste la présentation; Catalogue la référence produit.',
    links:
      'Sites → Catalogue → commande web → paiement → WMS → Transport → portail. Réservations et disponibilité à concevoir avant vente.',
    flow: [
      'Publier une sélection de produits et ses conditions.',
      'Capturer la commande et confirmer le paiement via un connecteur.',
      'Préparer, expédier, notifier et traiter les retours.',
    ],
    tutorial:
      'Boutique de test, panier fictif, paiement bac à sable et suivi vers WMS; distinction explicite paiement/confirmation/expédition.',
    gate: 'Aucun checkout, passerelle de paiement, publication de boutique ou réservation web livré. Sites actuel n’est pas une boutique.',
  },
] as const;
