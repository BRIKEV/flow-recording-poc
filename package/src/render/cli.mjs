#!/usr/bin/env node
// flow-recording's CLI: turns the recordings of a test run into what a reviewer reads.
//
// PUBLIC API (what the user touches):
//   flow-recording <recording.json | recordings dir> [--config flow.config.mjs]
//   flow.config.mjs  optional, in the app's root: curation rules, see curate.mjs
//
// For each recording (.flow/recordings/<test>.json, written by the runner integration) it
// writes <test>.raw.txt (every span) and <test>.story.txt (curated), and prints the
// stories. Coverage gaps go first. The rest of render/ is internal:
//   spans.mjs     what every span gives us, and the spans as a tree
//   curate.mjs    which spans and logs make it into the story
//   describe.mjs  what each one says (span kind → message)
//   payload.mjs   JSON bodies, short          sql.mjs   SQL as data
//   layout.mjs    the story: actors, arrows, indentation
//   raw.mjs       the uncurated tree          coverage.mjs   libraries that produced nothing
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coverageWarning } from './coverage.mjs';
import { story } from './layout.mjs';
import { raw } from './raw.mjs';
import { tree } from './spans.mjs';

const args = process.argv.slice(2);
const configFlag = args.indexOf('--config');
const configPath = configFlag >= 0 ? args.splice(configFlag, 2)[1] : 'flow.config.mjs';
const config = existsSync(configPath) ? (await import(pathToFileURL(resolve(configPath)).href)).default : {};

const target = args[0];
const recordingsDir = statSync(target).isDirectory() ? target : dirname(target);
const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith('.json')).sort().map((f) => join(target, f))
  : [target];

const warning = coverageWarning(join(recordingsDir, '..', 'coverage'));
const warningFile = join(recordingsDir, '..', 'coverage.txt');
if (warning) {
  writeFileSync(warningFile, warning + '\n');
  console.log(warning + '\n');
} else rmSync(warningFile, { force: true }); // from an earlier run

for (const file of files) {
  const spans = JSON.parse(readFileSync(file, 'utf8'));
  if (!tree(spans).root) continue; // not a test recording
  const base = file.replace(/\.json$/, '');
  writeFileSync(`${base}.raw.txt`, raw(spans) + '\n');
  const text = story(spans, config);
  writeFileSync(`${base}.story.txt`, text + '\n');
  console.log(text + '\n');
}
