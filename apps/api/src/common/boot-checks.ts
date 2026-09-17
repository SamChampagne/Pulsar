/**
 * Fail-fast production checks, run before Nest even instantiates the app.
 * Same posture as the ENCRYPTION_KEY validation in CryptoService: a
 * misconfigured production deployment must not come up at all.
 *
 * Published example values (.env.example, CI workflow) are rejected too —
 * someone WILL copy them to production one day.
 */
const PUBLISHED_EXAMPLES: Record<string, string[]> = {
  JWT_SECRET: ['change-me-in-production', 'ci-only-secret'],
  ENCRYPTION_KEY: [
    'q8mB3dT9rV2xU5nC7sE4hG1jL0aF3kM8oP4wY6zI1tQ=', // .env.example
    '1qK0pZ8Yw3mB6dT9rV2xU5nC7sE4hG1jL0aF3kM8oP4=', // CI workflow
  ],
};

export function assertProductionSecrets(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV !== 'production') return;
  const password = env.PLATFORM_ADMIN_PASSWORD;
  if (!password || password === 'admin123') {
    throw new Error(
      'PLATFORM_ADMIN_PASSWORD must be set to a non-default value in production ' +
        '(the seeded platform admin would otherwise be sign-in-able with admin123).',
    );
  }
  // Dev/CI escape hatch for loopback webhook endpoints (IntegrationsService
  // `allowPrivateUrls`). Left on in production it disables the SSRF egress
  // guard on every integration write and delivery — refuse the boot.
  if (env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true') {
    throw new Error(
      'WEBHOOK_ALLOW_PRIVATE_URLS=true is a dev/CI escape hatch and must not be set in production ' +
        '(it disables the SSRF egress guard on webhook and EDI endpoints).',
    );
  }
  for (const [name, examples] of Object.entries(PUBLISHED_EXAMPLES)) {
    const value = env[name];
    // Unset is deliberately NOT handled here: JWT_SECRET (getOrThrow) and
    // ENCRYPTION_KEY (CryptoService constructor) already abort the boot when
    // missing. This check only adds the published-example rejection layer.
    if (value && examples.includes(value)) {
      throw new Error(
        `${name} is set to a published example value (.env.example / CI) — generate a real secret for production.`,
      );
    }
  }
}
