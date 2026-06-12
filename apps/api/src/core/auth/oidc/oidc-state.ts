import { CryptoService } from '../../crypto/crypto.service';

export interface OidcFlowState {
  /** PKCE code_verifier */
  verifier: string;
  nonce: string;
  issuedAt: number;
  /** Tenant slug bound at pack time — callback verifies slug matches to prevent cross-tenant replay */
  tenantSlug: string;
}

const MAX_AGE_MS = 10 * 60_000;

/**
 * The whole flow state travels inside the OAuth `state` parameter, encrypted
 * (AES-GCM): stateless server, tamper-proof (GCM auth tag), and the nonce check
 * against the ID token binds the callback to this exact authorization request.
 */
export function packOidcState(crypto: CryptoService, state: OidcFlowState): string {
  return crypto.encryptString(JSON.stringify(state));
}

export function unpackOidcState(crypto: CryptoService, raw: string): OidcFlowState {
  const state = JSON.parse(crypto.decryptString(raw)) as OidcFlowState;
  if (Date.now() - state.issuedAt > MAX_AGE_MS) {
    throw new Error('OIDC state expired');
  }
  return state;
}
