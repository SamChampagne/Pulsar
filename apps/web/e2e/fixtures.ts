import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';
export type { APIRequestContext, Locator, Page } from '@playwright/test';

/** Let pending mocked requests finish before Playwright closes the page/context. */
export const test = base.extend({
  page: async ({ page }, use) => {
    try {
      await use(page);
    } finally {
      // Do not use ignoreErrors: real handler failures must still fail the test.
      await page.unrouteAll({ behavior: 'wait' });
    }
  },
});
