import { Readable } from 'node:stream';
import { Test } from '@nestjs/testing';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import {
  AgentChatImagesService,
  validateChatImages,
  CHAT_IMAGE_BYTES,
} from './agent-chat-images.service';
import { assertGenericDocumentType } from '../documents/protected-documents';
import { AgentConversationsController } from './agent-conversations.controller';
import { AgentConversationsService } from './agent-conversations.service';
import { AgentsService } from './agents.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { HermesAcpClient } from './hermes-acp.client';
import { FakeAcpServer } from '../../../test/support/fake-acp-server';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const file = (buffer = png, mimetype = 'image/png') =>
  ({ buffer, mimetype, originalname: 'capture.png' }) as Express.Multer.File;

describe('Private chat images', () => {
  it('accepts bounded raster pixels and emits exact ACP data, never URL references', () => {
    expect(validateChatImages([file()])).toEqual([
      { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
    ]);
  });
  it.each([
    () => [file(Buffer.from('<svg/>'), 'image/svg+xml')],
    () => [file(Buffer.from('not a PNG'))],
    () => [file(Buffer.alloc(CHAT_IMAGE_BYTES + 1))],
    () => Array.from({ length: 5 }, () => file()),
    () => {
      const data = Buffer.from(png);
      data.writeUInt32BE(100000, 16);
      return [file(data)];
    },
  ])('rejects bad signatures, MIME, dimensions and limits', (input) => {
    expect(() => validateChatImages(input())).toThrow();
  });
  it('cannot use the generic document surface for chat images', () => {
    expect(() => assertGenericDocumentType('agent-chat-image')).toThrow(ForbiddenException);
  });
  it('rechecks tenant, user, conversation and message ownership on every image read', async () => {
    const db = {
      document: { findFirst: jest.fn().mockResolvedValue({ entityId: 'm' }) },
      agentMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const docs = { download: jest.fn().mockResolvedValue({ stream: Readable.from(png) }) };
    const service = new AgentChatImagesService(db as never, docs as never);
    await expect(service.download('t', 'stranger', 'c', 'image')).rejects.toThrow('introuvable');
    expect(docs.download).not.toHaveBeenCalled();
    expect(db.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'image', tenantId: 't', entityType: 'agent-chat-image' },
      }),
    );
    expect(db.agentMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'm',
          conversationId: 'c',
          conversation: { tenantId: 't', userId: 'stranger' },
        },
      }),
    );
    db.agentMessage.findFirst.mockResolvedValue({ id: 'm' } as never);
    await service.download('t', 'owner', 'c', 'image');
    expect(docs.download).toHaveBeenCalledWith('t', 'image', 'agent-chat-image');
  });
  it('cleans a partial save and marks the message unsent without model execution', async () => {
    const db = {
      agentMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'm' }), updateMany: jest.fn() },
    };
    const docs = {
      upload: jest
        .fn()
        .mockResolvedValueOnce({ id: 'i' })
        .mockRejectedValueOnce(new Error('storage')),
      remove: jest.fn(),
    };
    await expect(
      new AgentChatImagesService(db as never, docs as never).save('t', 'u', 'm', [file(), file()]),
    ).rejects.toThrow('storage');
    expect(docs.remove).toHaveBeenCalledWith('t', 'i', 'agent-chat-image');
    expect(db.agentMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm', conversation: { tenantId: 't', userId: 'u' } } }),
    );
  });
  it('negotiates image support and forwards the image block through ACP without widening tools', async () => {
    const fake = new FakeAcpServer();
    const sent = jest.spyOn(fake.clientTransport, 'send');
    const client = new HermesAcpClient(fake.clientTransport);
    const image = validateChatImages([file()]);
    await expect(client.prompt('s', 'image', image).next()).rejects.toThrow('images');
    await client.initialize();
    for await (const _ of client.prompt('s', 'look', image)) {
      /* drain */
    }
    expect(sent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'session/prompt',
        params: { sessionId: 's', prompt: [{ type: 'text', text: 'look' }, ...image] },
      }),
    );
    fake.close();
  });
});

describe('Chat image HTTP intake (real multipart interceptor)', () => {
  let app: Awaited<ReturnType<import('@nestjs/testing').TestingModule['createNestApplication']>>;
  const conversations = {
    assertOwned: jest.fn(),
    addMessage: jest.fn(),
    titleFromMessage: jest.fn(),
  };
  const images = { save: jest.fn() };
  const send = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AgentConversationsController],
      providers: [
        { provide: AgentConversationsService, useValue: conversations },
        { provide: AgentChatImagesService, useValue: images },
        {
          provide: AgentsService,
          useValue: { getOwned: async () => ({ id: 'a', status: 'ACTIVE' }) },
        },
        {
          provide: AgentRuntimeService,
          useValue: {
            isLive: () => true,
            closeSession: jest.fn(),
            sendTurn: async function* (...args: unknown[]) {
              send(...args);
              yield { type: 'result', result: { version: 1, status: 'succeeded' } };
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { tenantId: 't', id: 'u' };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    conversations.assertOwned.mockResolvedValue({ id: 'c', agentId: 'a', hermesSessionId: 's' });
    conversations.addMessage.mockResolvedValue({ id: 'm' });
  });
  afterAll(() => app.close());
  it('accepts multipart, persists images and forwards pixels (JSON text remains compatible)', async () => {
    await request(app.getHttpServer())
      .post('/agent-conversations/c/messages')
      .field('text', 'Analyse')
      .attach('images', png, 'capture.png')
      .expect(201);
    expect(images.save).toHaveBeenCalledWith('t', 'u', 'm', expect.any(Array));
    expect(send).toHaveBeenCalledWith('s', 'Analyse', validateChatImages([file()]));
    await request(app.getHttpServer())
      .post('/agent-conversations/c/messages')
      .send({ text: 'texte' })
      .expect(201);
    expect(send).toHaveBeenLastCalledWith('s', 'texte', []);
  });
  it('refuses oversized or fifth images before persistence', async () => {
    await request(app.getHttpServer())
      .post('/agent-conversations/c/messages')
      .field('text', 'Analyse')
      .attach('images', Buffer.alloc(CHAT_IMAGE_BYTES + 1), 'capture.png')
      .expect(413);
    let req = request(app.getHttpServer())
      .post('/agent-conversations/c/messages')
      .field('text', 'Analyse');
    for (let i = 0; i < 5; i++) req = req.attach('images', png, `${i}.png`);
    await req.expect(400);
    expect(conversations.addMessage).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects foreign conversations and bad files before any model call', async () => {
    conversations.assertOwned.mockRejectedValueOnce(new ForbiddenException());
    await request(app.getHttpServer())
      .post('/agent-conversations/c/messages')
      .field('text', 'Analyse')
      .attach('images', png, 'capture.png')
      .expect(403);
    await request(app.getHttpServer())
      .post('/agent-conversations/c/messages')
      .field('text', 'Analyse')
      .attach('images', Buffer.from('fake'), 'capture.png')
      .expect(400);
    expect(images.save).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
