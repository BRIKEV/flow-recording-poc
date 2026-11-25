#!/usr/bin/env node
// flow-recording's CLI: turns the recordings of a test run into what a reviewer reads.
//
// PUBLIC API (what the user touches):
//   flow-recording <recording.json | recordings dir> [--config flow.config.mjs] [--since <git ref>]
//   --since main  print only the tests added or changed since the merge-base with main
//                 (see since.mjs); run it from the app's root, where the tests ran
//   writes .flow/stories.txt (what it prints) and .flow/comment.md (the same, with each
//   test's full trace collapsed under its story: a PR comment body, see markdown.mjs)
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
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coverageWarning } from './coverage.mjs';
import { story } from './layout.mjs';
import { comment } from './markdown.mjs';
import { raw } from './raw.mjs';
import { changedLines, touched } from './since.mjs';
import { tree } from './spans.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const configPath = flag('--config') ?? 'flow.config.mjs';
const since = flag('--since');
const config = existsSync(configPath) ? (await import(pathToFileURL(resolve(configPath)).href)).default : {};

// Names that collided get -2, -3… in run order (record/vitest.js): name, name-2, name-3
function byRunOrder(a, b) {
  const key = (f) => {
    const m = f.match(/^(.*)-(\d+)\.json$/);
    return m ? [m[1], Number(m[2])] : [f.replace(/\.json$/, ''), 1];
  };
  const [x, n] = key(a);
  const [y, k] = key(b);
  return x.localeCompare(y) || n - k;
}

const target = args[0];
const recordingsDir = statSync(target).isDirectory() ? target : dirname(target);
const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith('.json')).sort(byRunOrder).map((f) => join(target, f))
  : [target];

const out = []; // what is printed, also written to .flow/stories.txt
const print = (text) => {
  out.push(text);
  console.log(text + '\n');
};

const warning = coverageWarning(join(recordingsDir, '..', 'coverage'));
const warningFile = join(recordingsDir, '..', 'coverage.txt');
if (warning) {
  writeFileSync(warningFile, warning + '\n');
  print(warning);
} else rmSync(warningFile, { force: true }); // from an earlier run

// Every recording gets its story files; with --since, only the touched tests are printed
const changes = since ? changedLines(since) : undefined;
const sources = new Map();
const read = (f) => sources.get(f) ?? sources.set(f, existsSync(f) ? readFileSync(f, 'utf8') : '').get(f);
const stories = [];
let fileLevel = 0;
for (const file of files) {
  const spans = JSON.parse(readFileSync(file, 'utf8'));
  const { root } = tree(spans);
  if (!root) continue; // not a test recording
  const base = file.replace(/\.json$/, '');
  const trace = raw(spans);
  writeFileSync(`${base}.raw.txt`, trace + '\n');
  const text = story(spans, config);
  writeFileSync(`${base}.story.txt`, text + '\n');
  const test = { file: root.attributes['flow.test.file'], line: root.attributes['flow.test.line'] };
  if (changes) {
    const t = touched(test, changes, read);
    if (!t.touched) continue;
    if (!t.exact) fileLevel++;
  }
  stories.push({ text, raw: trace, name: basename(base), file: test.file ?? '', line: test.line ?? 0, order: stories.length });
}
// In the order they are written: by spec file, then line (it.each cases keep their run order)
stories.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.order - b.order);

if (changes) {
  const total = files.length;
  print(
    stories.length
      ? `Flow recording since ${since}: ${stories.length} of ${total} tests added or changed`
      : `Flow recording since ${since}: no test added or changed (${total} recorded)`,
  );
  if (fileLevel) {
    print(`⚠ ${fileLevel} of them picked by file, not by test: the runner recorded no test lines (Vitest: includeTaskLocation: true)`);
  }
}
const intro = [...out];
for (const { text } of stories) print(text);
writeFileSync(join(recordingsDir, '..', 'stories.txt'), out.join('\n\n') + '\n');
// The same, as a PR comment body: each story with its full trace collapsed under it
writeFileSync(join(recordingsDir, '..', 'comment.md'), comment({ intro, stories }) + '\n');
