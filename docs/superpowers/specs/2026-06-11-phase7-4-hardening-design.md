# Phase 7.4 — Durcissements différés : design

> Validé le 2026-06-11. Quatrième et dernier chantier de la phase 7. **Liste fermée** :
> la dette de sécurité notée aux revues de la phase 6 (TODO.md « durcissements
> différés ») + deux durcissements issus des mêmes revues. Aucune fonctionnalité
> nouvelle — uniquement de la fermeture de surface.

## Les 6 items (aucune question ouverte)

### 1. MFA plateforme (TOTP + codes de récupération)

Le seul item avec de l'épaisseur. Pour les comptes `PlatformUser` uniquement (le plan
d'admin cross-tenant — surface la plus sensible) :

- `PlatformUser` gagne `totpSecret String?` (chiffré au repos via `CryptoService`
  `enc:v1`, comme les autres secrets), `mfaEnabledAt DateTime?`,
  `recoveryCodes String[]` (hachés bcrypt, à usage unique — un code consommé est
  retiré).
- **Enrôlement obligatoire à la première connexion** : `POST /platform/auth/login` d'un
  compte sans MFA retourne un token d'enrôlement court (10 min, scope `mfa-enroll`,
  inutilisable ailleurs) + l'URI `otpauth://` (secret généré serveur) ; `POST
  /platform/auth/mfa/enroll` (token d'enrôlement + premier code TOTP valide) active le
  MFA et retourne les 8 codes de récupération **une seule fois**.
- **Connexion** : credentials valides + MFA actif → le login retourne un token
  d'étape (`mfa-pending`, 5 min) ; `POST /platform/auth/mfa/verify` (token + code TOTP
  ou code de récupération) émet l'access token 12 h habituel. La stratégie
  `platform-jwt` rejette les tokens d'étape.
- Librairie : `otplib` (TOTP RFC 6238, fenêtre ±1). Tests unitaires sur
  l'enrôlement/vérification/recovery (jest, secret fixe).
- Garde-fou dev : `PLATFORM_MFA_ENFORCED=false` en dev/CI désactive l'obligation (le
  flux reste testable e2e en l'activant dans la suite).

### 2. Throttling `POST /platform/auth/login`

`@nestjs/throttler` sur le contrôleur d'auth plateforme uniquement : 5 tentatives /
minute / IP (429 au-delà). Pas de throttling global (hors périmètre).

### 3. Décorateur composite `@PlatformController()`

`= @Public() + @UseGuards(PlatformGuard)` (via `applyDecorators`). Remplace les paires
manuelles sur TOUS les contrôleurs plateforme existants — l'oubli du second décorateur
était silencieusement ouvert. Un test jest vérifie que le décorateur applique bien les
deux métadonnées.

### 4. Cache `Issuer.discover` par issuer (OIDC)

Map en mémoire `issuerUrl → { issuer, fetchedAt }`, TTL 1 h, invalidation sur erreur
d'échange (re-discover une fois puis erreur). Supprime un aller-retour réseau par login
OIDC.

### 5. Slug du tenant dans le state OIDC chiffré

Le state AES-GCM embarque `tenantSlug` ; le callback vérifie que le slug du state
correspond au tenant résolu — défense en profondeur contre le rejeu d'états entre
tenants. Test unitaire sur le mismatch (rejet).

### 6. Anti-injection CSV + transitions de facture en `updateMany` conditionnel

- **CSV** : dans l'export des factures (et tout champ libre exporté), préfixer d'un `'`
  les valeurs commençant par `= + - @ \t` (injection de formule tableur). Helper pur
  `csvSafe()` testé (jest), appliqué à l'export existant.
- **TOCTOU des transitions de facture** : remplacer les read-then-write des transitions
  buy-side (approve/pay/reconcile) par des `updateMany({ where: { id, tenantId,
  status: <attendu> } })` + vérification du `count` (la 7.3 applique déjà ce pattern
  côté sell-side ; on aligne le buy-side). Comportement identique, fenêtre fermée.

## Tests & livraison

- Jest : TOTP (enrôlement, vérification, recovery one-shot), `csvSafe`, décorateur
  composite, slug-mismatch OIDC.
- E2E : flux MFA complet (login → enroll → login+verify → accès ; recovery code
  consommé une seule fois) ; throttling (6ᵉ tentative → 429) ; non-régression des
  suites plateforme/OIDC existantes.
- 1 migration (champs PlatformUser). Branche `phase-7-4`, PR distincte.

## Hors périmètre

MFA pour les utilisateurs tenant (le SSO OIDC couvre ce besoin côté entreprise) ;
throttling global API ; rotation automatique des secrets TOTP ; WebAuthn.
