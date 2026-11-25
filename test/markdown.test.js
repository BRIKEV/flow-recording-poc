// The PR comment: stories always, full traces collapsed under them while they fit in
// GitHub's 65,536-character limit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comment } from '../src/render/markdown.mjs';

const story = (n, raw = `[internal] test ${n}\n  [client] pg.query`) => ({ text: `✔ test ${n}\n  test → db  select`, raw, name: `spec--test-${n}` });

test('each story comes with its full trace collapsed under it, after the intro', () => {
  const body = comment({ intro: ['Flow recording since main: 1 of 3 tests added or changed'], stories: [story(1)] });
  assert.equal(
    body,
    [
      '```text\nFlow recording since main: 1 of 3 tests added or changed\n```',
      '```text\n✔ test 1\n  test → db  select\n```',
      '<details><summary>Full trace</summary>\n\n```text\n[internal] test 1\n  [client] pg.query\n```\n\n</details>',
    ].join('\n\n'),
  );
});

test('a trace that no longer fits is named instead, and the stories all stay', () => {
  const big = 'x'.repeat(40000);
  const body = comment({ intro: [], stories: [story(1, big), story(2, big)] });
  assert.equal(body.match(/<details>/g).length, 1);
  assert.match(body, /`spec--test-2\.raw\.txt` in the artifact/);
  assert.match(body, /✔ test 2/);
  assert.ok(body.length < 65536);
});

test('when even the stories do not fit, as many as fit and the count of the rest', () => {
  const huge = { text: 'y'.repeat(25000), raw: '', name: 'n' };
  const body = comment({ intro: [], stories: [huge, huge, huge] });
  assert.equal(body.match(/y{25000}/g).length, 2);
  assert.match(body, /1 more stories, and every full trace, in the artifact/);
  assert.ok(body.length < 65536);
});
