import { defineConfig } from '@mikro-orm/postgresql';
import { NoteSchema } from './note.entity';

export const ormOptions = (clientUrl: string) => defineConfig({ clientUrl, entities: [NoteSchema] });
