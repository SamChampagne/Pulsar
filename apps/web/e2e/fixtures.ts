import { test as base, expect } from '@playwright/test';

export { expect } from '@playwright/test';
export type { APIRequestContext, Locator, Page } from '@playwright/test';

/** Let pending mocked requests finish before Playwright closes the page/context. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      // Auth init scripts also run on the deliberately empty teardown document.
      // Only that opaque-document storage failure is outside the application.
      if (
        page.url() === 'about:blank' &&
        error.message ===
          "Failed to read the 'localStorage' property from 'Window': Access is denied for this document."
      )
        return;
      pageErrors.push(`${page.url()}: ${error.message}`);
    });
    try {
      await use(page);
    } finally {
      // Do not use ignoreErrors: real handler failures must still fail the test.
      await page.unrouteAll({ behavior: 'wait' });
      expect(
        pageErrors,
        'Uncaught browser errors must not be hidden by a passing interaction',
      ).toEqual([]);
    }
  },
});
