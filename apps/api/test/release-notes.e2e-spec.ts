/**
 * E2E for "Quoi de neuf" release notes: platform authoring plane
 * (@PlatformController, platform JWT) + tenant read/seen plane (tenant JWT,
 * no permission). Prerequisites: reachable PostgreSQL with the seed applied
 * (the seeded 'release-note-welcome' note is PUBLISHED, so unseen-count for
 * any user may already be >= 1 — this suite only asserts deltas around its
 * own note, never absolute counts, except after `seen` -> 0).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

interface ReleaseNoteView {
  id: string;
  title: string;
  body: string;
  bodyHtml: string;
  kind: string;
  version: string | null;
  publishedAt: string | null;
}

describe('Release notes (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let tenantToken = '';
  let platformToken = '';
  let noteId = '';
  let baselineUnseen = 0;

  const suffix = `rn${Date.now().toString(36)}`;
  const title = `E2E Release Note ${suffix}`;
  const body = 'This drop adds a **bold** new capability for tenants.';

  const tenantAuth = () => ({ Authorization: `Bearer ${tenantToken}` });
  const platformAuth = () => ({ Authorization: `Bearer ${platformToken}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    const tenantLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    tenantToken = tenantLogin.body.accessToken;

    const platformLogin = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: 'platform@pulsar.dev', password: 'admin123' })
      .expect(200);
    platformToken = platformLogin.body.accessToken;
  });

  afterAll(async () => {
    // Defensive cleanup in case an assertion above failed mid-suite: a
    // PUBLISHED note can't be deleted directly, so unpublish first.
    if (noteId) {
      await request(http)
        .post(`/api/v1/platform/release-notes/${noteId}/unpublish`)
        .set(platformAuth())
        .catch(() => undefined);
      await request(http)
        .delete(`/api/v1/platform/release-notes/${noteId}`)
        .set(platformAuth())
        .catch(() => undefined);
    }
    await app.close();
  });

  it('platform creates a DRAFT release note', async () => {
    const res = await request(http)
      .post('/api/v1/platform/release-notes')
      .set(platformAuth())
      .send({ title, body, kind: 'FEATURE', version: suffix })
      .expect(201);
    noteId = res.body.id;
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.title).toBe(title);
  });

  it('tenant feed does not contain the draft yet', async () => {
    const res = await request(http)
      .get('/api/v1/release-notes')
      .query({ pageSize: 100 })
      .set(tenantAuth())
      .expect(200);
    const items = res.body.items as ReleaseNoteView[];
    expect(items.some((n) => n.title === title)).toBe(false);
  });

  it('captures the unseen-count baseline', async () => {
    const res = await request(http)
      .get('/api/v1/release-notes/unseen-count')
      .set(tenantAuth())
      .expect(200);
    baselineUnseen = res.body.count;
    expect(typeof baselineUnseen).toBe('number');
  });

  it('platform publishes the note', async () => {
    const res = await request(http)
      .post(`/api/v1/platform/release-notes/${noteId}/publish`)
      .set(platformAuth())
      .expect(201);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.publishedAt).toBeTruthy();
  });

  it('tenant now sees the note, with markdown bold rendered to HTML', async () => {
    const res = await request(http)
      .get('/api/v1/release-notes')
      .query({ pageSize: 100 })
      .set(tenantAuth())
      .expect(200);
    const items = res.body.items as ReleaseNoteView[];
    const found = items.find((n) => n.title === title);
    expect(found).toBeDefined();
    expect(found!.body).toBe(body);
    expect(found!.bodyHtml).toContain('<strong>');
  });

  it('unseen-count increased by exactly one', async () => {
    const res = await request(http)
      .get('/api/v1/release-notes/unseen-count')
      .set(tenantAuth())
      .expect(200);
    expect(res.body.count).toBe(baselineUnseen + 1);
  });

  it('POST /release-notes/seen resets the count to zero', async () => {
    await request(http).post('/api/v1/release-notes/seen').set(tenantAuth()).expect(200);
    const res = await request(http)
      .get('/api/v1/release-notes/unseen-count')
      .set(tenantAuth())
      .expect(200);
    expect(res.body.count).toBe(0);
  });

  it('rejects a tenant token on the platform authoring plane', async () => {
    await request(http)
      .post('/api/v1/platform/release-notes')
      .set(tenantAuth())
      .send({ title: 'nope', body: 'nope', kind: 'FEATURE' })
      .expect(401);
  });

  it('rejects a platform token on the tenant read plane', async () => {
    await request(http).get('/api/v1/release-notes').set(platformAuth()).expect(401);
  });

  it('refuses to delete a PUBLISHED note', async () => {
    await request(http)
      .delete(`/api/v1/platform/release-notes/${noteId}`)
      .set(platformAuth())
      .expect(400);
  });

  it('unpublish then delete succeeds (cleanup)', async () => {
    await request(http)
      .post(`/api/v1/platform/release-notes/${noteId}/unpublish`)
      .set(platformAuth())
      .expect(201);
    await request(http)
      .delete(`/api/v1/platform/release-notes/${noteId}`)
      .set(platformAuth())
      .expect(200);
    noteId = '';
  });
});
