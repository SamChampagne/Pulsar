# Courriel bidirectionnel + threads CRM — Design

**Date:** 2026-06-24
**Statut:** approuvé (design), prêt pour plan d'implémentation
**Module:** CRM (`MODULE_KEYS.CRM`) + core/email

## Objectif

Transformer le CRM en **cockpit commercial bidirectionnel** : recevoir les emails entrants,
les regrouper en **threads** rattachés aux contacts/companies/deals, et permettre la réponse
(humaine et agent) au même endroit que l'envoi. C'est le premier des trois chantiers
(courriel → docs intelligents → CRM enrichi) qui doivent relier CRM/courriel/documents.

L'envoi existe déjà (outbox durable `MailService`, retry, templates, config SMTP chiffrée par
tenant, drafting IA). **Le gap comblé ici : la réception et le threading.**

## Décisions arrêtées (brainstorming)

1. **Réception** : abstraction `InboundEmailDriver` — `ImapPollDriver` maintenant, `WebhookDriver`
   branchable plus tard sans retoucher le modèle Thread.
2. **Threading** : headers RFC (`Message-ID`/`In-Reply-To`/`References`) en premier, sinon match
   de l'email expéditeur sur `CrmContact.email`.
3. **Modèle** : on **réutilise** `EmailMessage` (+ `direction`, `threadId`, headers) plutôt qu'un
   modèle inbound séparé — cohérent avec l'outbox existant, rétro-compatible.
4. **Expéditeur inconnu** : thread `UNLINKED` triable à la main (pas de contact fantôme auto-créé).
5. **Agent v1** : lecture (READ) + brouillon de réponse proposé via `ProposedAction` (envoi
   SENSITIVE déjà gouverné). Pas d'auto-création de contact silencieuse.
6. **Dev/e2e** : `LogInboundDriver` + endpoint dev-only `POST /emails/_simulate-inbound` pour
   injecter un inbound sans serveur IMAP (CI).

## Architecture

### 1. Couche réception (`core/email/inbound`)

- **`InboundEmailDriver`** (interface) : `fetchNew(config): Promise<RawInboundEmail[]>` où
  `RawInboundEmail = { from, to, subject, html, text, messageId, inReplyTo, references[],
  receivedAt, attachments[] }`.
  - **`ImapPollDriver`** : connexion IMAP via `imapflow`, `SEARCH UNSEEN`, fetch, parse MIME via
    `mailparser`, marque `\Seen`. Timeout court, best-effort.
  - **`LogInboundDriver`** (driver `log`) : no-op en cron ; alimenté par l'endpoint de simulation.
  - **`WebhookDriver`** : hors périmètre v1, mais l'interface est conçue pour l'accueillir.
- **`TenantEmailConfig`** (modèle existant) étendu :
  `imapHost?, imapPort?, imapSecure (bool), imapUsername?, imapPasswordEnc? (chiffré CryptoService,
  règle 25), inboundActive (bool, default false), lastPollAt?, lastPollOk?`. Projection publique
  masque `imapPasswordEnc` → expose `hasImapPassword: boolean` (comme le SMTP existant).
- **`InboundEmailService`** : cron (ex. `EVERY_5_MINUTES`) qui itère les tenants `inboundActive`,
  appelle le driver, et passe chaque message à `InboundIngestService`. **Best-effort, ne throw
  jamais, isolé par tenant** (un tenant qui échoue n'affecte pas les autres) — même contrat que
  `MailService`. Met à jour `lastPollAt/lastPollOk`.

### 2. Ingestion + threading (`InboundIngestService` + pur `@pulsar/shared/crm`)

Helpers **purs** (testables, browser-safe) dans `packages/shared/src/crm` :
- `normalizeSubject(subject): string` — strip `re:`/`fw:`/`fwd:` (récursif), trim, lowercase.
- `resolveThreadDecision(input): { kind: 'existing'|'new-linked'|'new-unlinked', ... }` —
  logique pure de décision à partir de : headers du message, set de `messageId` connus du tenant,
  match contact résolu côté service. Le service fournit les données (lookups DB), le pur décide.

`InboundIngestService.ingest(tenantId, raw)` (transaction) :
1. **Idempotence** : si `raw.messageId` existe déjà en `EmailMessage` (tenant) → skip.
2. **Threading** :
   - a. `inReplyTo`/`references` matche un `EmailMessage.messageId` du tenant → réutilise son
     `threadId`.
   - b. sinon `from` matche `CrmContact.email` (tenant, insensible à la casse) → thread ouvert du
     contact au même `subjectNorm`, sinon **nouveau thread `LINKED`** (contactId + companyId hérités).
   - c. sinon **nouveau thread `UNLINKED`**.
3. Crée l'`EmailMessage` `direction=INBOUND, status=RECEIVED, threadId, messageId, inReplyTo,
   references, fromAddress`.
4. **Pièces jointes** → `DocumentsService.upload` (entityType `email-inbound`), liées via
   `EmailAttachment` (règle 12).
5. Met à jour le thread (`lastMessageAt`, `messageCount`).
6. **Audit** (`AuditLogsService.log`, règle 6) sur création de thread et sur rattachement contact.
7. **Émet un `DomainEvent`** `crm.email.received` (best-effort) → permet réactions/Workbench
   ultérieurs (hors périmètre v1 mais le hook est posé).

### 3. Sortants chaînés (`MailService`)

- À l'enqueue, **générer et persister un `Message-ID`** (`<uuid@domaine-tenant>`), `direction=OUTBOUND`.
- Si l'envoi appartient à un thread, `threadId` est renseigné et `inReplyTo`/`references` chaînent
  le dernier message entrant. **Aucune régression** sur les appels existants (campaigns, tenders,
  invoices, invitations) : `threadId` reste optionnel, `direction` défaut `OUTBOUND`.

### 4. Modèle de données (Prisma + mirror shared)

```
model EmailThread {
  id           String   @id @default(cuid())
  tenantId     String
  subject      String
  subjectNorm  String
  contactId    String?
  companyId    String?
  dealId       String?
  status       EmailThreadStatus @default(UNLINKED) // UNLINKED | LINKED | ARCHIVED
  lastMessageAt DateTime
  messageCount Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([tenantId, status, lastMessageAt])
  @@index([tenantId, contactId])
  @@index([tenantId, dealId])
}
```
`EmailMessage` (existant) += `threadId? @index`, `direction EmailDirection @default(OUTBOUND)`,
`messageId? @index`, `inReplyTo?`, `references?` (string), `fromAddress?`.
Enums ajoutés et **mirrorés** dans `@pulsar/shared` (règle 3) : `EmailThreadStatus`, `EmailDirection`.
Migration additive (colonnes nullable / defaults) — pas de backfill destructif.

### 5. API (`apps/api/src/modules/crm/threads.{controller,service}.ts`)

Tous `@RequireModule(MODULE_KEYS.CRM)`, tenant-scopés (règle 1), FK vérifiées (règle 9) :
- `GET /crm/threads` — `Paginated`, filtres `status`, `contactId`, `dealId`, `search` (subject) | `crm.read`
- `GET /crm/threads/:id` — thread + messages (chrono asc) + pièces jointes (presigned) | `crm.read`
- `POST /crm/threads/:id/reply` — body `{ html, subject?, attachments? }` → queue un sortant chaîné
  via `MailService` (to = email du contact / dernier expéditeur), `direction=OUTBOUND`, audit | `crm.manage`
- `POST /crm/threads/:id/link` — body `{ contactId? , createContact?: {name,email}, companyId?, dealId? }`
  → passe le thread en `LINKED`, FK vérifiées, audit (règle 6/9) | `crm.manage`
- `POST /crm/threads/:id/archive` — `status=ARCHIVED`, audit | `crm.manage`

Email-config (existant) étendu : `PUT /api/v1/email-config` accepte les champs IMAP (chiffre le
mot de passe) ; `POST /api/v1/email-config/test-inbound` teste la connexion IMAP (met à jour
`lastPollAt/lastPollOk`). Dev-only : `POST /emails/_simulate-inbound` (gated `NODE_ENV!=='production'`)
injecte un `RawInboundEmail` dans `InboundIngestService` pour démo/e2e.

### 6. Outils agent (`core/agents/tools/crm.tools.ts`, registre — règles 21–22)

- `crm_list_threads` (READ) — filtres status/contactId.
- `crm_get_thread` (READ) — thread + messages.
- `crm_reply_thread` (MUTATING → `ProposedAction`, tier SENSITIVE comme `send_email`) — réutilise
  le chemin `MailService` chaîné ; exécution réelle seulement via `ProposedActionsService.approve`.
- `crm_link_thread` (MUTATING → `ProposedAction`) — lier/créer contact.
Brouillon : l'agent utilise `draft_email` (LOW, existant) puis propose `crm_reply_thread`.
Portée = permissions ∩ modules ∩ allowlist (règle 23). Le cap montant ne s'applique pas (pas de
montant) ; les emails restent gouvernés par la file.

### 7. Web (`apps/web/src/routes/(app)/crm/inbox`)

- `/crm/inbox` : onglets **À trier (UNLINKED) / Rattachés (LINKED) / Tous**. Liste des threads
  (sujet, contact/company, dernier message, count). Vue thread = timeline de messages
  (entrant/sortant distingués), composeur de réponse (réutilise le composeur `/emails` + bouton
  « brouillon IA »), panneau de rattachement (chercher/créer contact, lier deal).
- Threads embarqués (lecture + lien « voir dans l'inbox ») sur `crm/companies/[id]`,
  `crm/contacts/[id]` (nouveau), et détail deal.
- Config IMAP ajoutée à la page de config email existante (`/emails` settings), masquant le secret.
- Pattern web standard : `$state` + `$effect` load(), client `api<T>()`, erreurs locales.

## Conformité aux hard rules

- **R1** tenant isolation : tout query threads/messages filtré `tenantId` (JWT).
- **R3** enums dans shared mirrorés dans schema.prisma, rebuild shared/database.
- **R6** audit sur thread create / link / reply / archive.
- **R9** `contactId/companyId/dealId` vérifiés (`OwnershipService`/inline) avant persistance.
- **R12** pièces jointes via `DocumentsService` (jamais le FS directement).
- **R21–23** outils agent par le registre ; MUTATING → `ProposedAction` ; portée filtrée.
- **R25** secret IMAP chiffré via `CryptoService`, jamais renvoyé en clair.
- Best-effort/isolation : cron inbound ne throw jamais, isolé par tenant (contrat `MailService`).

## Tests

- **Unit (`@pulsar/shared`)** : `normalizeSubject` (re:/fwd:/imbriqués), `resolveThreadDecision`
  (chaînage par references, match contact, unlinked, idempotence sur messageId).
- **e2e (`apps/api/test/crm-email-threads.e2e-spec.ts`)** : via `_simulate-inbound` —
  1. inbound d'un contact connu → thread LINKED ;
  2. réponse (references) → même thread, count++ ;
  3. inbound inconnu → thread UNLINKED ; `link` → LINKED ;
  4. `reply` → sortant chaîné (Message-ID/In-Reply-To corrects) en outbox ;
  5. idempotence : même `messageId` réinjecté → pas de doublon.
  Crée sa propre master-data (codes uniques, reruns sûrs). Pas d'IMAP réel en CI.

## Hors périmètre v1 (backlog)

- `WebhookDriver` inbound (Mailgun/SES) — interface prête.
- Réactions/Workbench sur `crm.email.received` (event déjà émis).
- Full-text search dans le corps des messages.
- Bounce/complaint/delivery webhooks ; archivage/purge automatique.
- Chantiers 2 (docs intelligents : OCR/extraction/classif) et 3 (CRM enrichi : timeline unifiée,
  forecasting, bulk/dédup).
