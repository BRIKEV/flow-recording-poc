import { EntityManager } from '@mikro-orm/postgresql';
import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Post } from '@nestjs/common';
import { Note } from './note.entity';
import { SlackClient } from './slack.client';

// No business logic on purpose: each endpoint is just a flow across the boundaries
@Controller('notes')
export class NotesController {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(SlackClient) private readonly slack: SlackClient,
  ) {}

  // endpoint → slack users.info → db insert → slack chat.postMessage
  @Post()
  @HttpCode(201)
  async create(@Body() body: { user: string; text: string }) {
    const author = await this.slack.userName(body.user);
    if (!author) throw new NotFoundException(`Unknown Slack user ${body.user}`);

    const note = this.em.create(Note, { author, text: body.text });
    await this.em.flush();

    await this.slack.postMessage(`${author} wrote: ${body.text}`);
    return note;
  }

  // endpoint → db select
  @Get()
  list() {
    return this.em.find(Note, {}, { orderBy: { id: 'asc' } });
  }
}
