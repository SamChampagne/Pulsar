# Phase 8 — Fermer la ligne MVP : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter la spec [2026-06-11-phase8-mvp-line-design.md](../specs/2026-06-11-phase8-mvp-line-design.md) : BOL PDF (pdfkit + DocumentsService + séquence BOL), mode LTL/FTL/PARCEL filtrant le rating, moteur d'exceptions (cron retards → event DELAYED + Notification tenant, dédup `(stopId, deadline)`).

**Architecture:** Trois volets indépendants branchés sur l'existant : le BOL réutilise Documents/sequences/driver-token ; le mode est une colonne + un filtre dans les deux requêtes de rating ; les exceptions réutilisent le pattern cron des tenders et branchent enfin le modèle `Notification` (rendu nullable côté user pour les alertes tenant).

**Tech stack:** NestJS + Prisma, `pdfkit`, SvelteKit, vitest/jest/supertest. Branche : `phase-8`.

**Décision de plan (notifications tenant)** : `Notification.userId` devient **nullable** (migration) ; une notification tenant (`userId: null`) est visible de tous les utilisateurs du tenant (`listMine` → `OR: [{ userId }, { userId: null }]`) et **« lu par un = lu pour tous »** (un seul `readAt` — v1 assumé : une alerte de retard est « prise » par quelqu'un ; le ciblage par utilisateur viendra avec les préférences, hors périmètre).

---

## Carte des fichiers

| Fichier | Rôle |
| ------- | ---- |
| `packages/shared/src/enums/transportation.ts` | + `TransportMode` |
| `packages/shared/src/planning/mode.ts` (+ tests) | `suggestMode(totalWeightKg)` (seuils 30 kg / 4 000 kg) |
| `packages/database/prisma/schema.prisma` + migration | `mode` sur TransportOrder/Load (défaut FTL) + Rate (nullable) ; `Notification.userId` nullable |
| `apps/api/src/prisma/sequences.service.ts` | + clé `bol` → `BOL` |
| `apps/api/src/modules/transportation/bol/*` (nouveau) | `buildBolData`, `renderBol` (pdfkit), `BolService` |
| `loads.controller.ts` | `POST :id/bol` ; `GET :id/documents` (si pas déjà couvert par /documents) |
| `public/public-links.service.ts` + controller | `GET /public/driver/:token/bol` (stream via jeton) |
| `transport-orders` + `loads` DTO/services | champ `mode`, héritage, `modeWarning` |
| `rating/rating.service.ts` | filtres mode (rateOptions + rateOrder) |
| `core/notifications/*` | userId nullable, notify tenant-wide, list OR |
| `transportation/exceptions/delay-detection.service.ts` (nouveau) | Cron + `tick()` + dédup `(stopId, deadline)` |
| Web : orders/portal forms, loads detail, header layout, driver page, rates page | sélecteurs/badges mode + hint, cloche notifications, section Documents + bouton BOL, lien BOL chauffeur |
| `apps/api/test/phase8-mvp-line.e2e-spec.ts` | Suite e2e |
| Docs | Mise à jour finale |

---

### Task 1 : Shared — `TransportMode` + `suggestMode` (TDD)

**Files:** `packages/shared/src/enums/transportation.ts`, `packages/shared/src/planning/mode.ts`, `packages/shared/src/planning/__tests__/mode.spec.ts`, `packages/shared/src/index.ts`

- [ ] **Step 1 : Tests (échec)** — `mode.spec.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { TransportMode } from '../../enums/transportation';
import { suggestMode } from '../mode';

describe('suggestMode — non-binding weight-threshold hint', () => {
  it('suggests PARCEL up to 30 kg, LTL up to 4000 kg, FTL beyond', () => {
    expect(suggestMode(10)).toBe(TransportMode.PARCEL);
    expect(suggestMode(30)).toBe(TransportMode.PARCEL);
    expect(suggestMode(31)).toBe(TransportMode.LTL);
    expect(suggestMode(4000)).toBe(TransportMode.LTL);
    expect(suggestMode(4001)).toBe(TransportMode.FTL);
  });
  it('returns null when weight is unknown', () => {
    expect(suggestMode(null)).toBeNull();
    expect(suggestMode(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2 : Implémenter** — enum dans `enums/transportation.ts` :

```ts
/** Shipping mode. Mirrored in schema.prisma. Default FTL. */
export enum TransportMode {
  FTL = 'FTL',
  LTL = 'LTL',
  PARCEL = 'PARCEL',
}
```

`planning/mode.ts` :

```ts
import { TransportMode } from '../enums/transportation';

/** v1 thresholds — constants, parameterizable later (spec: assumed gap vs audit §4). */
export const PARCEL_MAX_KG = 30;
export const LTL_MAX_KG = 4000;

/** Non-binding mode hint from the total weight. Null when the weight is unknown. */
export function suggestMode(totalWeightKg: number | null | undefined): TransportMode | null {
  if (totalWeightKg == null) return null;
  if (totalWeightKg <= PARCEL_MAX_KG) return TransportMode.PARCEL;
  if (totalWeightKg <= LTL_MAX_KG) return TransportMode.LTL;
  return TransportMode.FTL;
}
```

Export `./planning/mode` dans index.ts.

- [ ] **Step 3 :** `pnpm --filter @pulsar/shared test` PASS ; build ; `pnpm typecheck`. Commit `feat(shared): TransportMode enum + non-binding suggestMode hint`.

---

### Task 2 : Prisma — colonnes mode + Notification.userId nullable + séquence BOL

**Files:** `packages/database/prisma/schema.prisma`, migration, `apps/api/src/prisma/sequences.service.ts`

- [ ] **Step 1 : Schéma** — enum miroir `TransportMode { FTL LTL PARCEL }` ; `TransportOrder.mode TransportMode @default(FTL)` ; `Load.mode TransportMode @default(FTL)` ; `Rate.mode TransportMode?` (commentaire : `// null = applies to all modes`). `Notification.userId String?` + relation `user User?` (commentaire : `// null = tenant-wide notification (e.g. delay alerts); read-by-one = read-for-all (v1)`).
- [ ] **Step 2 : Migration** — additive (2 ADD COLUMN défaut 'FTL', 1 nullable, ALTER userId DROP NOT NULL) ; générer/écrire selon le précédent 7.x ; appliquer ; drift exit 0 ; `pnpm --filter @pulsar/database build`. ⚠️ `Notification.userId` : la FK existante a `onDelete: Cascade` — la garder sur la colonne nullable.
- [ ] **Step 3 : Séquence** — `SequenceKey` + `'bol'`, `PREFIXES` + `'bol': 'BOL'`.
- [ ] **Step 4 :** typecheck (le notify() existant exige userId — il reste compatible : champ devenu optionnel dans le modèle, le service actuel le passe toujours). Commit `feat(db): transport mode columns, tenant-wide notifications (nullable userId), BOL sequence`.

---

### Task 3 : API — mode (DTOs, héritage, filtres rating, warning)

**Files:** `transport-orders/dto` + service, `loads/dto/load.dto.ts` + `loads.service.ts`, `shipments.service.ts`, `rating/rating.service.ts` (+ spec), portail (`portal.controller/service`)

- [ ] **Step 1 : DTOs** — `CreateTransportOrderDto` + `@IsOptional() @IsEnum(TransportMode) mode?: TransportMode;` (update hérite via PartialType ; modifiable en DRAFT seulement — la garde existante `Only DRAFT orders can be edited` suffit). Portail : même champ optionnel. `AssignLoadResourcesDto` + `mode?` (changer le mode d'un load OPEN/PLANNED). `CreateRateDto` + `mode?` (le tarif ; null = tous modes).
- [ ] **Step 2 : Héritage + warning** — `shipments.service.assignToLoad` : si le load est vierge (aucun shipment avant celui-ci) ET que le mode du load est resté au défaut, hériter le mode de l'ordre du shipment (`load.update({ mode })` dans la transaction existante). Si le load a déjà un mode ≠ mode de l'ordre du shipment → la réponse gagne `modeWarning: { loadMode, orderMode }` (non bloquant ; structure simple, le front l'affiche). NOTE : « resté au défaut » — heuristique v1 : hériter seulement quand le load n'a AUCUN shipment (premier assign) ; sinon comparer et warner.
- [ ] **Step 3 : Filtres rating** — `rateOptions` : le `where` des tarifs gagne `OR: [{ mode: null }, { mode: load.mode }]` (ajouter `mode` au select du load) ; `rateOrder` : idem avec `order.mode`. Mettre à jour `rating.service.spec.ts` si des fixtures sont impactées (non attendu — les filtres sont en SQL).
- [ ] **Step 4 :** typecheck + tests. Commit `feat(api): transport mode — order/load/rate columns wired, rating filters by mode, non-blocking assign warning`.

---

### Task 4 : BOL — service pdfkit + endpoints

**Files:** `apps/api/package.json` (+ `pdfkit`, `@types/pdfkit`), `transportation/bol/bol-data.ts` (+ spec), `transportation/bol/bol-render.ts`, `transportation/bol/bol.service.ts`, `loads.controller.ts`, `transportation.module.ts`, `public/public-links.service.ts` + son controller

- [ ] **Step 1 :** `pnpm --filter <api> add pdfkit` + `add -D @types/pdfkit`.
- [ ] **Step 2 : `buildBolData` TDD** — `bol-data.ts` exporte `BolData` (interface : bolNumber, generatedAt, carrier {name, scac?}, driverName?, equipment {vehicle?, trailer?}, shipper {name, address, city}, consignee {...}, lines [{shipmentNumber, orderNumber, customerReference?, weightKg?, palletCount?}], totals {weightKg, units}, notes?, conditions string) et `buildBolData(load, bolNumber): BolData` — fonction PURE prenant le load déjà chargé (avec includes route.stops.location, shipments.transportOrder, carrier, driver, vehicle, trailer). Spec jest : fixture de load complet → chaque champ vérifié ; expéditeur = location du premier PICKUP, destinataire = dernière DELIVERY ; totaux sommés ; `conditions` contient « Received in apparent good order ».
- [ ] **Step 3 : `renderBol(data): Buffer`** — `bol-render.ts`, pdfkit pur : en-tête (BOL n°, date, transporteur/SCAC, chauffeur, équipements), blocs expéditeur/destinataire, table des lignes (n° shipment, ordre, réf client, poids, palettes), ligne TOTAUX, **trois blocs de signature** (cadres : « Shipper signature / date », « Driver signature — received at pickup / date », « Consignee signature — received at delivery / date » + 2 lignes « Exceptions / damages noted: ») et la mention de conditions en pied. Retourne un Buffer (collecter les chunks du stream pdfkit). Test léger : le buffer commence par `%PDF` et fait > 1 ko.
- [ ] **Step 4 : `BolService.generate(tenantId, userId, loadId)`** — charge le load (tenant-scopé, includes nécessaires) ; 400 si status ∉ {DISPATCHED, IN_TRANSIT, COMPLETED} ; `bolNumber = sequences.nextNumber(tenantId, 'bol')` ; `buildBolData` → `renderBol` → `documents.upload(tenantId, { entityType: 'bill-of-lading', entityId: loadId, fileName: `${bolNumber}.pdf`, mimeType: 'application/pdf', body, uploadedById: userId })` (vérifier la signature exacte d'UploadDocumentInput) ; audit CREATE `bill-of-lading` ; retourne le document.
- [ ] **Step 5 : Endpoints** — `loads.controller` : `POST :id/bol` (`EXECUTION_MANAGE`) ; `GET :id/documents` → `documents.listForEntity(tenantId, 'bill-of-lading', id)` (PLANNING_READ) — si un endpoint Documents générique couvre déjà ce listage (vérifier `documents.controller.ts`), l'utiliser côté web au lieu d'en créer un. Public driver : dans `public-links.service`, méthode `driverBol(token)` → résout le load par `driverToken`, prend le DERNIER document `bill-of-lading`, retourne le stream (réutiliser la mécanique download de DocumentsService — ajouter si besoin une méthode `downloadByKey` interne) ; controller public : `GET /public/driver/:token/bol` → stream `application/pdf`, 404 si token invalide/aucun BOL. JAMAIS d'id de document dans le payload driver (règle 10).
- [ ] **Step 6 :** module registration ; typecheck + tests. Commit `feat(api): bill of lading — pdfkit render with signature blocks, BOL sequence, driver-token download`.

---

### Task 5 : Exceptions — détection de retard + notifications tenant

**Files:** `core/notifications/notifications.service.ts` + controller, `transportation/exceptions/delay-detection.service.ts` (+ spec), `transportation.module.ts`

- [ ] **Step 1 : Notifications tenant-wide** — `NotifyInput.userId` devient optionnel ; `notify()` écrit `userId: input.userId ?? null`. `listMine` → `where: { tenantId, OR: [{ userId }, { userId: null }], ... }`. `markRead` → `findFirst({ where: { id, tenantId, OR: [{ userId }, { userId: null }] } })` (l'appartenance TENANT est le contrôle ; une notification tenant est marquée lue pour tous — commentaire expliquant le choix v1).
- [ ] **Step 2 : DelayDetectionService TDD** — la partie pure d'abord : exporter `isLate(stop: { plannedArrivalEarly: Date|null; plannedArrivalLate: Date|null; actualArrivalAt: Date|null }, now: Date): { late: boolean; deadline: Date|null }` — deadline = `plannedArrivalLate ?? plannedArrivalEarly` ; late quand deadline non null, dépassée, et pas d'arrivée réelle. Spec jest : 4 cas (à l'heure, en retard sur Late, en retard sur Early seul, arrivé = jamais late).
- [ ] **Step 3 : Le service** :

```ts
@Injectable()
export class DelayDetectionService {
  private readonly logger = new Logger(DelayDetectionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // Same cadence/pattern as TenderExpiryService (read it for the exact decorator usage).
  @Cron(CronExpression.EVERY_5_MINUTES)
  async detect(): Promise<void> { await this.tick(new Date()); }

  /** Public + injectable clock so the e2e drives it directly. Idempotent (dedup below). */
  async tick(now: Date): Promise<number> {
    const stops = await this.prisma.stop.findMany({
      where: {
        actualArrivalAt: null,
        OR: [
          { plannedArrivalLate: { lt: now } },
          { plannedArrivalLate: null, plannedArrivalEarly: { lt: now } },
        ],
        route: { load: { status: { in: [LoadStatus.DISPATCHED, LoadStatus.IN_TRANSIT] } } },
      },
      include: {
        location: { select: { name: true } },
        route: { select: { tenantId: true, load: { select: { id: true, loadNumber: true } } } },
      },
    });

    let created = 0;
    for (const stop of stops) {
      const deadline = (stop.plannedArrivalLate ?? stop.plannedArrivalEarly)!;
      // Dedup on (stopId, deadline): a replanned-then-missed window re-alerts (spec).
      const existing = await this.prisma.trackingEvent.findFirst({
        where: {
          stopId: stop.id,
          type: TrackingEventType.DELAYED,
          payload: { path: ['deadline'], equals: deadline.toISOString() },
        },
      });
      if (existing) continue;

      const tenantId = stop.route.tenantId;
      const load = stop.route.load;
      const minutesLate = Math.round((now.getTime() - deadline.getTime()) / 60_000);
      await this.prisma.trackingEvent.create({
        data: {
          tenantId,
          type: TrackingEventType.DELAYED,
          loadId: load.id,
          stopId: stop.id,
          shipmentId: stop.shipmentId,
          message: `Stop ${stop.location.name} is ${minutesLate} min late (planned by ${deadline.toISOString()})`,
          payload: { stopId: stop.id, deadline: deadline.toISOString(), minutesLate },
        },
      });
      await this.notifications.notify({
        tenantId,
        title: `Load ${load.loadNumber} delayed`,
        body: `Stop ${stop.location.name} is ${minutesLate} min past its arrival window.`,
        level: NotificationLevel.WARNING,
        payload: { loadId: load.id, stopId: stop.id, deadline: deadline.toISOString() },
      });
      created++;
    }
    return created;
  }
}
```
⚠️ Vérifications obligatoires avant d'écrire : (1) les valeurs réelles de `NotificationLevel` dans shared (WARNING existe-t-il ? sinon le niveau le plus proche) ; (2) le filtre Json Prisma `payload.path` est PostgreSQL-correct (`path: ['deadline']`) ; (3) `TrackingEvent.payload` existe bien (oui — schéma §10 audit) ; (4) le decorator @Cron : importer de `@nestjs/schedule` comme TenderExpiryService — le ScheduleModule est déjà enregistré (les tenders l'utilisent). (5) `stop.route` expose `tenantId` (le modèle Route a tenantId) et la relation stop→route existe avec ce nom.
- [ ] **Step 4 :** Enregistrer dans le module ; typecheck + tests. Commit `feat(api): delay detection cron — DELAYED events + tenant notifications, dedup on (stop, deadline)`.

---

### Task 6 : Web — mode, cloche, documents/BOL, chauffeur

**Files:** `transport-orders/+page.svelte`, `portal/[token]/+page.svelte`, `transport-orders/[id]/+page.svelte`, `loads/+page.svelte`, `loads/[id]/+page.svelte`, `rates/+page.svelte`, `(app)/+layout.svelte`, `driver/[token]/+page.svelte`

- [ ] **Step 1 : Mode** — formulaires ordre + portail : `<select>` mode (FTL/LTL/PARCEL, défaut FTL) + hint « Suggested: LTL » live quand le poids saisi change (dupliquer les seuils en littéral est interdit : importer `suggestMode` de `@pulsar/shared` — le web importe déjà ce package). Badges mode sur listes/détails ordre + load ; page Rates : select mode (vide = tous modes) + colonne. Affichage du `modeWarning` de l'assignation (toast warning, pattern existant).
- [ ] **Step 2 : Cloche notifications** — dans `(app)/+layout.svelte` : icône cloche dans la sidebar/header avec badge du compte non-lues (`GET /notifications?unread=true`, polling 60 s via `setInterval` dans un `$effect` avec cleanup), panneau déroulant listant titre/corps/date + bouton « Mark read » (`POST /notifications/:id/read`). Sobre — suivre les idiomes CSS existants.
- [ ] **Step 3 : Load detail** — section « Documents » (GET des documents `bill-of-lading` du load — selon l'endpoint retenu en Task 4) : liste (nom, date, télécharger via l'endpoint documents existant) + bouton « Generate BOL » (visible DISPATCHED+, POST :id/bol, toast + refresh). Badge « Delayed » en tête quand un event DELAYED existe dans la timeline sans arrivée postérieure (calcul local depuis les events déjà chargés).
- [ ] **Step 4 : Driver page** — lien « Download BOL » pointant `GET /public/driver/:token/bol` (ancre simple, target _blank ; masquer si 404 — tenter un HEAD ou afficher toujours et laisser le 404 parler : afficher toujours, c'est plus simple, avec un libellé « (if generated) » — choisir l'option simple).
- [ ] **Step 5 :** `pnpm typecheck && pnpm build`. Commit `feat(web): mode selectors with suggested hint, notification bell, load documents + BOL, driver BOL link`.

---

### Task 7 : Suite e2e phase 8

**Files:** Create `apps/api/test/phase8-mvp-line.e2e-spec.ts`

- [ ] **Step 1 : Écrire la suite** (squelette standard, suffixe unique, helper deliver/dispatch réutilisé des suites précédentes) :
  1. **Mode filtre le rating** : tarif client/transporteur avec `mode: 'LTL'` + tarif sans mode ; load FTL → rate-options ne contient PAS le tarif LTL, contient le sans-mode ; ordre LTL → `rateOrder` (via billable preview) ne prend pas un tarif FTL.
  2. **Héritage + warning** : ordre LTL → premier assign sur load vierge → le load devient LTL ; second shipment d'un ordre FTL → réponse porte `modeWarning`.
  3. **BOL** : avant dispatch → 400 ; après dispatch → 201, document `bill-of-lading` listé, download interne 200 `application/pdf` (body commence par `%PDF`) ; `GET /public/driver/:token/bol` → 200 pdf ; token révoqué → 404.
  4. **Exceptions** : load dispatché avec route dont le stop a `plannedArrivalLate` dans le passé → appeler `tick(new Date())` directement (`app.get(DelayDetectionService)`) → 1 créé ; event DELAYED présent dans la timeline + notification listée (`GET /notifications`) ; second tick → 0 créé ; **replanifier la fenêtre du stop à une autre borne passée** (rebuild route) → tick → 1 NOUVEAU (l'angle mort) ; marquer la notification lue → disparait du filtre unread.
- [ ] **Step 2 :** Suite seule → itérer (statuts observés font foi ; bug réel → BLOCKED) ; puis `pnpm test:e2e` complet → toutes suites vertes ; `pnpm test`, `pnpm typecheck`.
- [ ] **Step 3 : Commit** `test(e2e): phase 8 — mode-filtered rating, BOL lifecycle incl. driver token, delay detection with replan re-alert`.

---

### Task 8 : Docs + gates finaux

**Files:** `TODO.md`, `ROADMAP.md`, `docs/etat-du-projet.md`, `docs/data-model.md`, `docs/collaboration.md`, `docs/audit-tms-2026-06-10.md` (annotations)

- [ ] **Step 1 :** RÈGLE : documenter depuis le code, compter pour vrai. TODO/ROADMAP : phase 8 cochée. etat-du-projet : ligne phase 8, chiffres réels, **« la ligne MVP de l'audit est fermée »**, prochaine session → décision stratégique (pilote client vs différenciateurs 19.x — ne pas trancher dans la doc, présenter les deux). data-model : TransportMode (+ règle null = tous modes), Notification nullable userId (read-by-one), BOL (séquence, entityType). collaboration.md : endpoint public driver BOL. **audit-tms** : annoter §4 (« mode = dimension livrée phase 8 ; arbitrage à seuils non couvert »), §9 (« BOL livré phase 8 »), §10 (« moteur de retard simple livré phase 8 »).
- [ ] **Step 2 :** Gates `pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e` → tout vert ou BLOCKED.
- [ ] **Step 3 : Commit** `docs: phase 8 shipped — audit MVP line closed (BOL, modes, exceptions)`.
