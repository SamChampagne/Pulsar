// Pure, browser-safe. No Node imports.
//
// Human-facing catalog of the business events Pulsar emits. It documents the
// webhook subscription surface (`Integration.config.events[]`): every type here
// is persisted by `DomainEventsService.emit` and bridged to the outbound
// webhook outbox. Kept in sync by hand with the `domainEvents.emit(...)` call
// sites — `event-catalog.spec.ts` guards duplicates and `DOMAIN_EVENT_TYPES`
// coverage.
import { moduleOfEventType, type FlowModule } from '../analytics/flow';
import { DOMAIN_EVENT_TYPES } from './policies';

export interface DomainEventCatalogEntry {
  /** Event type, as it appears in `Integration.config.events[]`. */
  type: string;
  /** Owning module — derived from `moduleOfEventType` (rule 37, single source of truth). */
  module: FlowModule;
  /** FR description shown in the integrations studio. */
  description: string;
  /** Representative `data` payload (field names match what the emitter sends). */
  example: Record<string, unknown>;
}

interface CatalogSeed {
  type: string;
  description: string;
  example: Record<string, unknown>;
}

const SEEDS: CatalogSeed[] = [
  // --- Transportation ------------------------------------------------------
  {
    type: DOMAIN_EVENT_TYPES.TRANSPORT_ORDER_PLANNED,
    description: 'Une commande de transport est planifiée et éclatée en expéditions.',
    example: { orderId: 'ord_1', orderNumber: 'TO-000123', shipmentCount: 2 },
  },
  {
    type: DOMAIN_EVENT_TYPES.TRANSPORT_ORDER_COMPLETED,
    description: "Une commande de transport issue d'une commande de vente est complétée.",
    example: {
      transportOrderId: 'ord_1',
      sourceSalesOrderId: 'so_1',
      sourceFulfillmentKey: 'so_1:1',
      customerId: 'cus_1',
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.LOAD_DISPATCHED,
    description: 'Un load est réparti à un transporteur et part en exécution.',
    example: { loadId: 'ld_1', loadNumber: 'LD-000045', carrierId: 'car_1' },
  },
  {
    type: DOMAIN_EVENT_TYPES.LOAD_COMPLETED,
    description: 'Un load est livré et clôturé.',
    example: { loadId: 'ld_1', loadNumber: 'LD-000045', carrierId: 'car_1' },
  },
  {
    type: DOMAIN_EVENT_TYPES.STOP_DELAYED,
    description: 'Un arrêt a dépassé sa fenêtre horaire (détection de retard).',
    example: {
      stopId: 'stp_1',
      loadId: 'ld_1',
      deadline: '2026-09-17T14:00:00.000Z',
      minutesLate: 75,
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.TENDER_DECLINED,
    description: 'Un transporteur a refusé une offre de tender.',
    example: {
      loadId: 'ld_1',
      loadNumber: 'LD-000045',
      carrierId: 'car_1',
      tenderId: 'tnd_1',
      declineReason: 'Aucun équipement disponible',
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.TENDER_EXPIRED,
    description: 'Une offre de tender a expiré sans réponse du transporteur.',
    example: { loadId: 'ld_1', loadNumber: 'LD-000045', carrierId: 'car_1', tenderId: 'tnd_1' },
  },
  {
    type: DOMAIN_EVENT_TYPES.DRIVER_EXCEPTION,
    description:
      'Un chauffeur a signalé une exception (dommage, retard, refus, autre) depuis le lien public.',
    example: {
      loadId: 'ld_1',
      loadNumber: 'LD-000045',
      shipmentId: 'shp_1',
      stopId: 'stp_1',
      kind: 'DAMAGE',
      note: 'Palette endommagée au chargement',
      bucket: '2026-09-17T14:00',
    },
  },

  // --- Customer portal -----------------------------------------------------
  {
    type: DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST,
    description: 'Un client a déposé une demande de changement depuis le portail.',
    example: {
      subject: { type: 'transport-order', id: 'ord_1' },
      changeRequestId: 'pcr_1',
      kind: 'RESCHEDULE',
      note: 'Livraison souhaitée vendredi',
      customerName: 'Acme Foods',
      orderNumber: 'TO-000123',
      bucket: '2026-09-17T14:00',
    },
  },

  // --- Billing -------------------------------------------------------------
  {
    type: DOMAIN_EVENT_TYPES.CARRIER_INVOICE_RECEIVED,
    description: 'Une facture transporteur entrante a été enregistrée (freight audit).',
    example: { invoiceId: 'ici_1', carrierId: 'car_1' },
  },

  // --- Fleet ---------------------------------------------------------------
  {
    type: DOMAIN_EVENT_TYPES.FLEET_ASSET_MAINTENANCE,
    description: 'Un actif de flotte passe en maintenance (bon de travail ouvert).',
    example: {
      assetKind: 'vehicle',
      assetId: 'veh_1',
      unitNumber: 'T-104',
      woId: 'wo_1',
      woType: 'CORRECTIVE',
      description: 'Freins avant',
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.FLEET_MAINTENANCE_DUE,
    description: 'Un entretien planifié arrive à échéance (date ou kilométrage).',
    example: {
      scheduleId: 'sch_1',
      name: 'Vidange 20 000 km',
      assetKind: 'vehicle',
      assetId: 'veh_1',
      assetLabel: 'T-104',
      status: 'DUE',
      nextDueDate: '2026-09-20',
      nextDueKm: 220000,
    },
  },

  // --- WMS -----------------------------------------------------------------
  {
    type: DOMAIN_EVENT_TYPES.WMS_RECEIPT_POSTED,
    description: "Une réception d'entrepôt est postée (stock entré).",
    example: { receiptId: 'rc_1', number: 'RC-000012' },
  },
  {
    type: DOMAIN_EVENT_TYPES.WMS_PICK_COMPLETED,
    description: 'Une préparation liée à une expédition est complétée.',
    example: {
      shipmentId: 'shp_1',
      shipmentNumber: 'SH-000077',
      pickOrderId: 'pk_1',
      pickOrderNumber: 'PK-000031',
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.WMS_ITEM_BELOW_MIN,
    description: 'Un article est passé sous son point de réapprovisionnement.',
    example: {
      itemId: 'itm_1',
      sku: 'SKU-001',
      name: 'Boîte 40x30',
      onHand: 12,
      reorderPoint: 50,
      suggestedQty: 88,
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.WMS_CYCLE_COUNT_VARIANCE,
    description: "Un comptage cyclique révèle un écart d'inventaire.",
    example: {
      cycleCountId: 'cc_1',
      number: 'CC-000004',
      binCode: 'A-01-02',
      variances: [{ sku: 'SKU-001', expected: 100, counted: 94 }],
    },
  },

  // --- Yard ----------------------------------------------------------------
  {
    type: DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_IN,
    description: "Une visite de cour est enregistrée à l'arrivée.",
    example: {
      visitId: 'yv_1',
      visitNumber: 'YV-000021',
      locationId: 'loc_1',
      trailerLabel: 'R-880',
      trailerId: 'trl_1',
      carrierId: 'car_1',
      direction: 'INBOUND',
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_OUT,
    description: 'Une visite de cour est sortie de la cour.',
    example: { visitId: 'yv_1', visitNumber: 'YV-000021' },
  },
  {
    type: DOMAIN_EVENT_TYPES.YARD_VISIT_DETENTION,
    description: "Une visite dépasse le temps d'attente gratuit (détention).",
    example: {
      visitId: 'yv_1',
      visitNumber: 'YV-000021',
      trailerLabel: 'R-880',
      dwellMinutes: 240,
      detentionMinutes: 120,
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.YARD_APPOINTMENT_LATE,
    description: 'Un rendez-vous de quai est en retard.',
    example: { appointmentId: 'da_1', number: 'DA-000009', minutesLate: 35 },
  },

  // --- CRM -----------------------------------------------------------------
  {
    type: DOMAIN_EVENT_TYPES.CRM_DEAL_STALE,
    description: 'Une opportunité est sans activité depuis trop longtemps.',
    example: { dealId: 'dl_1', companyId: 'cmp_1', stage: 'PROPOSAL', daysSinceActivity: 21 },
  },
  {
    type: DOMAIN_EVENT_TYPES.CRM_FOLLOWUP_DUE,
    description: 'Une relance CRM planifiée est échue.',
    example: {
      activityId: 'act_1',
      dealId: 'dl_1',
      companyId: 'cmp_1',
      dueAt: '2026-09-17T13:00:00.000Z',
    },
  },
  {
    type: DOMAIN_EVENT_TYPES.CRM_SALES_ORDER_TRANSPORT_REQUESTED,
    description: 'Une commande de vente a déclenché une commande de transport (pont CRM → TMS).',
    example: {
      salesOrderId: 'so_1',
      transportOrderId: 'ord_1',
      fulfillmentKey: 'so_1:1',
      customerId: 'cus_1',
    },
  },
  {
    type: 'crm.deal.won',
    description: 'Une opportunité est gagnée.',
    example: { dealId: 'dl_1', companyId: 'cmp_1' },
  },
  {
    type: 'crm.sales_order.confirmed',
    description: 'Une commande de vente est confirmée.',
    example: { salesOrderId: 'so_1', companyId: 'cmp_1', customerId: 'cus_1' },
  },
  {
    type: 'crm.sales_order.invoiced',
    description: 'Une commande de vente est facturée.',
    example: { salesOrderId: 'so_1', companyId: 'cmp_1', customerId: 'cus_1' },
  },
  {
    type: 'crm.email.received',
    description: 'Un courriel entrant est rattaché à un fil CRM.',
    example: { messageId: '<abc@mail.example.com>', from: 'client@example.com' },
  },

  // --- Core / connect / sites ---------------------------------------------
  {
    type: 'connect.import-batch.completed',
    description: 'Un import CSV est terminé (lignes importées / en échec).',
    example: {
      target: 'customers',
      number: 'IB-000007',
      status: 'COMPLETED',
      importedRows: 42,
      failedRows: 0,
      totalRows: 42,
    },
  },
  {
    type: 'connect.carrier-invoice.ingested',
    description: 'Une facture transporteur est entrée par le canal connect (PDF/courriel).',
    example: { invoiceId: 'ici_1', inboundMessageId: 'inb_1', carrierId: 'car_1' },
  },
  {
    type: 'sites.lead.captured',
    description: "Un formulaire d'une page de destination publique a généré un lead.",
    example: { landingPageId: 'lp_1', slug: 'transport-express' },
  },
];

export const DOMAIN_EVENT_CATALOG: DomainEventCatalogEntry[] = SEEDS.map((seed) => ({
  type: seed.type,
  module: moduleOfEventType(seed.type),
  description: seed.description,
  example: seed.example,
}));

export function domainEventCatalogEntry(type: string): DomainEventCatalogEntry | undefined {
  return DOMAIN_EVENT_CATALOG.find((entry) => entry.type === type);
}
