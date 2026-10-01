import { test, expect } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';

test.use({ reducedMotion: 'reduce' });

async function setup(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pulsar.auth',
      JSON.stringify({
        accessToken: 'fixture',
        user: { id: 'u', firstName: 'Test', permissions: ['core.agents.chat'] },
        tenant: { id: 't', slug: 'fixture', enabledModules: [] },
      }),
    );
    const state = {
      tracks: [] as MediaStreamTrack[],
      reject: false,
      delay: false,
      resolve: undefined as (() => void) | undefined,
    };
    (window as any).captureFixture = state;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async (options: DisplayMediaStreamOptions) => {
        if (options.audio !== false) throw new Error('No audio permitted');
        if (state.reject) throw new DOMException('Cancelled', 'NotAllowedError');
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 320;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#163b52';
        ctx.fillRect(0, 0, 640, 320);
        ctx.fillStyle = '#fff';
        ctx.font = '24px sans-serif';
        ctx.fillText('Dossier de recette Pulsar', 32, 120);
        const stream = canvas.captureStream(30);
        state.tracks.push(...stream.getTracks());
        if (state.delay)
          await new Promise<void>((resolve) => {
            state.resolve = resolve;
          });
        return stream;
      },
    });
  });
  const sends: { body: string; contentType: string }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith('/workers'))
      return route.fulfill({
        json: [
          { id: 'a', name: 'Camille', model: 'vision-fixture', status: 'ACTIVE' },
          { id: 'b', name: 'Alex', model: 'vision-fixture', status: 'ACTIVE' },
        ],
      });
    if (path.endsWith('/agent-conversations'))
      return route.fulfill({ json: req.method() === 'POST' ? { id: 'c' } : [] });
    if (path.endsWith('/messages')) {
      sends.push({
        body: req.postDataBuffer()?.toString('latin1') ?? '',
        contentType: req.headers()['content-type'],
      });
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: text\ndata: {"text":"Image reçue dans le scénario de recette."}\n\nevent: result\ndata: {"result":{"version":1,"status":"succeeded"}}\n\nevent: end\ndata: {}\n\n',
      });
    }
    return route.fulfill({ json: path.endsWith('/preferences') ? EXPERIENCED_PREFERENCES : [] });
  });
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Assistant IA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Espace IA' });
  await expect(dialog.getByText(/vision-fixture/)).toBeVisible();
  return { dialog, sends };
}

test('image tools: optimize, preview, remove, paste, draft ownership, capture, explicit send and mobile', async ({
  page,
}, info) => {
  const { dialog, sends } = await setup(page);
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1200;
    c.getContext('2d')!.fillRect(0, 0, 2400, 1200);
    return c.toDataURL('image/png').split(',')[1];
  });
  const picker = dialog.getByLabel('Joindre des images', { exact: true });
  await picker.setInputFiles({
    name: 'preuve.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  await expect(dialog.getByRole('button', { name: 'Retirer preuve.jpg' })).toBeVisible();
  expect(sends).toHaveLength(0);
  const preview = dialog.getByRole('img', { name: 'preuve.jpg' });
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600);
  await dialog.getByLabel('Worker', { exact: true }).selectOption('b');
  await expect(dialog.getByRole('button', { name: 'Retirer preuve.jpg' })).toHaveCount(0);
  await dialog
    .getByRole('navigation', { name: 'Conversations IA' })
    .getByRole('button', { name: /Nouvelle conversation.*Camille/ })
    .click();
  await expect(dialog.getByRole('button', { name: 'Retirer preuve.jpg' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Retirer preuve.jpg' }).click();
  await picker.setInputFiles({
    name: 'script.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(dialog.getByRole('alert')).toContainText('pas de PDF/SVG');
  await dialog.getByRole('textbox', { name: 'Message au worker' }).evaluate((el, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'colle.png', { type: 'image/png' }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, data);
  await expect(dialog.getByRole('button', { name: 'Retirer colle.jpg' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Capturer l’écran' }).click();
  await expect(dialog.getByRole('button', { name: /Retirer capture-/ })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).captureFixture.tracks.every(
        (t: MediaStreamTrack) => t.readyState === 'ended',
      ),
    ),
  ).toBe(true);
  expect(sends).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('ai-images-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: info.outputPath('ai-images-desktop.png') });
  await dialog.getByRole('button', { name: 'Envoyer au worker' }).click();
  await expect(dialog.getByText('Réponse terminée')).toBeVisible();
  expect(sends).toHaveLength(1);
  expect(sends[0].contentType).toContain('multipart/form-data; boundary=');
  expect(sends[0].body).toContain('name="images"; filename="colle.jpg"');
  expect(sends[0].body).toContain('name="images"; filename="capture-');
  await expect(dialog.getByRole('button', { name: 'Copier la réponse' })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'colle.jpg' })).toBeVisible();
});

test('capture cancellation and late chooser completion release tracks without upload', async ({
  page,
}) => {
  const { dialog, sends } = await setup(page);
  await page.evaluate(() => {
    (window as any).captureFixture.reject = true;
  });
  await dialog.getByRole('button', { name: 'Capturer l’écran' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Aucune image envoyée');
  await page.evaluate(() => {
    (window as any).captureFixture.reject = false;
    (window as any).captureFixture.delay = true;
  });
  await dialog.getByRole('button', { name: 'Capturer l’écran' }).click();
  await expect(dialog.getByRole('status')).toContainText('Choisissez une fenêtre');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.evaluate(() => (window as any).captureFixture.resolve());
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).captureFixture.tracks.every(
          (t: MediaStreamTrack) => t.readyState === 'ended',
        ),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Assistant IA', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Retirer capture-/ })).toHaveCount(0);
  expect(sends).toHaveLength(0);
});

test('attachment limits, private historical preview and stop without retry', async ({ page }) => {
  const { dialog } = await setup(page);
  await dialog
    .getByLabel('Joindre des images', { exact: true })
    .setInputFiles(
      Array.from({ length: 5 }, (_, i) => ({
        name: `${i}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from('not-read'),
      })),
    );
  await expect(dialog.getByRole('alert')).toContainText('Maximum 4 images');
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  await page.route('**/agent-conversations/c/messages', async (route) => {
    started++;
    await wait;
    await route.fulfill({ contentType: 'text/event-stream', body: '' }).catch(() => {});
  });
  try {
    await dialog.getByRole('textbox', { name: 'Message au worker' }).fill('Attendre');
    await dialog.getByRole('button', { name: 'Envoyer au worker' }).click();
    await expect.poll(() => started).toBe(1);
    await dialog.getByRole('button', { name: 'Arrêter la réponse' }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Réponse arrêtée' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Arrêter la réponse' })).toHaveCount(0);
    expect(started).toBe(1);
  } finally {
    release();
  }
  await page.unroute('**/agent-conversations/c/messages');
  let imageReads = 0;
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 10;
      c.height = 10;
      return c.toDataURL().split(',')[1];
    }),
    'base64',
  );
  await page.route('**/agent-conversations', (route) =>
    route.fulfill({ json: [{ id: 'saved', agentId: 'a', title: 'Historique image' }] }),
  );
  await page.route('**/agent-conversations/saved', (route) =>
    route.fulfill({
      json: {
        messages: [
          {
            role: 'user',
            content: 'Capture privée',
            images: [{ id: 'img', fileName: 'historique.png' }],
          },
        ],
      },
    }),
  );
  await page.route('**/agent-conversations/saved/images/img', (route) => {
    imageReads++;
    expect(route.request().headers().authorization).toBe('Bearer fixture');
    return route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Assistant IA', exact: true }).click();
  await dialog.getByRole('button', { name: /Historique image/ }).click();
  await expect(dialog.getByRole('img', { name: 'historique.png' })).toBeVisible();
  expect(imageReads).toBe(1);
});
