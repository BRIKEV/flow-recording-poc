import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Note } from '../src/note.entity';
import { createSlackMock } from './support/slack-mock';

describe('notes', () => {
  const slack = createSlackMock();
  let app: INestApplication;

  beforeAll(() => slack.server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => slack.server.close());

  beforeEach(async () => {
    slack.reset();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterEach(() => app.close());

  const rows = () => app.get(EntityManager).fork().find(Note, {}, { orderBy: { id: 'asc' } });

  it('creates a note: looks up the author in Slack, stores it and announces it', async () => {
    slack.addUser('U1', 'kevin');

    const response = await request(app.getHttpServer()).post('/notes').send({ user: 'U1', text: 'hello' });

    expect(response.status).toBe(201);
    expect(await rows()).toMatchObject([{ author: 'kevin', text: 'hello' }]);
    expect(slack.posted).toEqual(['kevin wrote: hello']);
  });

  it('rejects a note from a user Slack does not know, storing and posting nothing', async () => {
    const response = await request(app.getHttpServer()).post('/notes').send({ user: 'U404', text: 'hello' });

    expect(response.status).toBe(404);
    expect(await rows()).toEqual([]);
    expect(slack.posted).toEqual([]);
  });

  it('lists the notes', async () => {
    const em = app.get(EntityManager).fork();
    em.create(Note, { author: 'kevin', text: 'first' });
    await em.flush();

    const response = await request(app.getHttpServer()).get('/notes');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject([{ author: 'kevin', text: 'first' }]);
  });
});
