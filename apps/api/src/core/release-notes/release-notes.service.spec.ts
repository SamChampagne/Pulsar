import { ReleaseNoteKind, ReleaseNoteStatus } from '@pulsar/database';
import { ReleaseNotesService } from './release-notes.service';

function makePrisma(notes: any[]) {
  return {
    releaseNote: {
      findMany: async (args: any) => {
        let rows = notes.filter((n) => matchesWhere(n, args?.where));
        if (args?.orderBy?.publishedAt === 'desc') {
          rows = [...rows].sort(
            (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
          );
        }
        if (args?.orderBy?.createdAt === 'desc') {
          rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (typeof args?.skip === 'number') rows = rows.slice(args.skip);
        if (typeof args?.take === 'number') rows = rows.slice(0, args.take);
        return rows;
      },
      count: async (args: any) => notes.filter((n) => matchesWhere(n, args?.where)).length,
      findUnique: async ({ where }: any) => notes.find((n) => n.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const row = {
          id: `rn-${notes.length + 1}`,
          status: ReleaseNoteStatus.DRAFT,
          publishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        notes.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = notes.findIndex((n) => n.id === where.id);
        notes[idx] = { ...notes[idx], ...data };
        return notes[idx];
      },
      delete: async ({ where }: any) => {
        const idx = notes.findIndex((n) => n.id === where.id);
        const [row] = notes.splice(idx, 1);
        return row;
      },
    },
  } as any;
}

function matchesWhere(note: any, where: any): boolean {
  if (!where) return true;
  if (where.status && note.status !== where.status) return false;
  if (where.publishedAt?.gt) {
    if (!note.publishedAt || note.publishedAt.getTime() <= where.publishedAt.gt.getTime()) {
      return false;
    }
  }
  return true;
}

function makePreferences(seenAt: Date | null) {
  const calls: any[] = [];
  return {
    calls,
    service: {
      get: async () => ({ deskLayout: {}, appearance: {}, releaseNotesSeenAt: seenAt }),
      update: async (userId: string, patch: any) => {
        calls.push({ userId, patch });
        return { deskLayout: {}, appearance: {}, releaseNotesSeenAt: patch.releaseNotesSeenAt };
      },
    },
  };
}

function note(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? 'rn-1',
    title: 'Title',
    body: 'Body',
    kind: ReleaseNoteKind.FEATURE,
    version: null,
    status: ReleaseNoteStatus.PUBLISHED,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdByEmail: 'platform@pulsar.dev',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ReleaseNotesService', () => {
  it('unseenCount: null seenAt counts all PUBLISHED notes', async () => {
    const prisma = makePrisma([
      note({ id: 'rn-1', status: ReleaseNoteStatus.PUBLISHED }),
      note({ id: 'rn-2', status: ReleaseNoteStatus.PUBLISHED }),
      note({ id: 'rn-3', status: ReleaseNoteStatus.DRAFT }),
    ]);
    const prefs = makePreferences(null);
    const svc = new ReleaseNotesService(prisma, prefs.service as any);

    const result = await svc.unseenCount('user-1');

    expect(result).toEqual({ count: 2 });
  });

  it('unseenCount: with seenAt filters to publishedAt > seenAt', async () => {
    const prisma = makePrisma([
      note({ id: 'rn-1', publishedAt: new Date('2026-01-01T00:00:00Z') }),
      note({ id: 'rn-2', publishedAt: new Date('2026-02-01T00:00:00Z') }),
    ]);
    const prefs = makePreferences(new Date('2026-01-15T00:00:00Z'));
    const svc = new ReleaseNotesService(prisma, prefs.service as any);

    const result = await svc.unseenCount('user-1');

    expect(result).toEqual({ count: 1 });
  });

  it('remove: refuses (400) to delete a PUBLISHED note', async () => {
    const prisma = makePrisma([note({ id: 'rn-1', status: ReleaseNoteStatus.PUBLISHED })]);
    const prefs = makePreferences(null);
    const svc = new ReleaseNotesService(prisma, prefs.service as any);

    await expect(svc.remove('rn-1')).rejects.toMatchObject({ status: 400 });
  });

  it('publish: sets publishedAt only once (idempotent on the timestamp)', async () => {
    const fixedPublishedAt = new Date('2026-01-01T00:00:00Z');
    const prisma = makePrisma([
      note({ id: 'rn-1', status: ReleaseNoteStatus.PUBLISHED, publishedAt: fixedPublishedAt }),
    ]);
    const prefs = makePreferences(null);
    const svc = new ReleaseNotesService(prisma, prefs.service as any);

    const result = await svc.publish('rn-1');

    expect(result.publishedAt).toEqual(fixedPublishedAt);
  });

  it('publish: a DRAFT note gets a fresh publishedAt', async () => {
    const prisma = makePrisma([
      note({ id: 'rn-1', status: ReleaseNoteStatus.DRAFT, publishedAt: null }),
    ]);
    const prefs = makePreferences(null);
    const svc = new ReleaseNotesService(prisma, prefs.service as any);

    const result = await svc.publish('rn-1');

    expect(result.status).toBe(ReleaseNoteStatus.PUBLISHED);
    expect(result.publishedAt).toBeInstanceOf(Date);
  });

  it('markSeen: delegates to PreferencesService.update with a fresh Date', async () => {
    const prisma = makePrisma([]);
    const prefs = makePreferences(null);
    const svc = new ReleaseNotesService(prisma, prefs.service as any);

    const result = await svc.markSeen('user-1');

    expect(result.seenAt).toBeInstanceOf(Date);
    expect(prefs.calls).toEqual([
      { userId: 'user-1', patch: { releaseNotesSeenAt: result.seenAt } },
    ]);
  });

  it('listPublished: returns only PUBLISHED notes ordered by publishedAt desc, with bodyHtml', async () => {
    const prisma = makePrisma([
      note({ id: 'rn-1', body: 'A **bold** one', publishedAt: new Date('2026-01-01T00:00:00Z') }),
      note({ id: 'rn-2', body: 'Newer', publishedAt: new Date('2026-02-01T00:00:00Z') }),
      note({ id: 'rn-3', status: ReleaseNoteStatus.DRAFT }),
    ]);
    const prefs = makePreferences(null);
    const svc = new ReleaseNotesService(prisma, prefs.service as any);

    const result = await svc.listPublished({});

    expect(result.total).toBe(2);
    expect(result.items.map((i: { id: string }) => i.id)).toEqual(['rn-2', 'rn-1']);
    expect(result.items[1].bodyHtml).toContain('<strong>bold</strong>');
  });
});
