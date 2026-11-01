import { EntitySchema } from '@mikro-orm/core';

export class Note {
  id!: number;
  author!: string;
  text!: string;
}

export const NoteSchema = new EntitySchema<Note>({
  class: Note,
  tableName: 'note',
  properties: {
    id: { type: 'integer', primary: true, autoincrement: true },
    author: { type: 'string' },
    text: { type: 'text' },
  },
});
