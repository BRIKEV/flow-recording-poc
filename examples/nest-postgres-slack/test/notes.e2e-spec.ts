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

  describe('crud', () => {
    const seed = async (...notes: Array<{ author: string; text: string }>) => {
      const em = app.get(EntityManager).fork();
      const created = notes.map((n) => em.create(Note, n));
      await em.flush();
      return created.map((n) => n.id);
    };

    it('gets a note by id', async () => {
      const [id] = await seed({ author: 'kevin', text: 'first' });

      const response = await request(app.getHttpServer()).get(`/notes/${id}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id, author: 'kevin', text: 'first' });
    });

    it('returns 404 for a note that does not exist', async () => {
      const response = await request(app.getHttpServer()).get('/notes/999');

      expect(response.status).toBe(404);
    });

    it('updates the text of a note', async () => {
      const [id] = await seed({ author: 'kevin', text: 'first' });

      const response = await request(app.getHttpServer()).patch(`/notes/${id}`).send({ text: 'edited' });

      expect(response.status).toBe(200);
      expect(await rows()).toMatchObject([{ id, author: 'kevin', text: 'edited' }]);
    });

    it('deletes a note and keeps the others', async () => {
      const [first, second] = await seed({ author: 'kevin', text: 'first' }, { author: 'ana', text: 'second' });

      const response = await request(app.getHttpServer()).delete(`/notes/${first}`);

      expect(response.status).toBe(204);
      expect(await rows()).toMatchObject([{ id: second, author: 'ana' }]);
    });
  });
});
