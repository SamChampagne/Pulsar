import { assertProductionSecrets } from './boot-checks';

describe('assertProductionSecrets', () => {
  it('does nothing outside production', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertProductionSecrets({})).not.toThrow();
  });

  it('refuses to boot in production with the default platform password', () => {
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production', PLATFORM_ADMIN_PASSWORD: 'admin123' }),
    ).toThrow(/PLATFORM_ADMIN_PASSWORD/);
  });

  it('refuses to boot in production without a platform password', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'production' })).toThrow(
      /PLATFORM_ADMIN_PASSWORD/,
    );
  });

  it('refuses production with the published example secrets (.env.example / CI)', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        PLATFORM_ADMIN_PASSWORD: 'S0lid-P@ss',
        ENCRYPTION_KEY: 'q8mB3dT9rV2xU5nC7sE4hG1jL0aF3kM8oP4wY6zI1tQ=',
      }),
    ).toThrow(/ENCRYPTION_KEY/);
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        PLATFORM_ADMIN_PASSWORD: 'S0lid-P@ss',
        JWT_SECRET: 'change-me-in-production',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('boots in production with real secrets', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        PLATFORM_ADMIN_PASSWORD: 'S0lid-P@ss',
        JWT_SECRET: 'a-real-secret',
        ENCRYPTION_KEY: 'someRealBase64Key/Generated/ByOps0000000000=',
      }),
    ).not.toThrow();
  });
});
