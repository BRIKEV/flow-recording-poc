// --since: which recorded tests a change added or modified. The diff and the test source
// are plain text here; the git calls themselves are a thin wrapper (changedLines).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDiff, testBlock, touched } from '../src/render/since.mjs';

const SPEC = `import { it, describe } from 'vitest';

describe('orders', () => {
  it('creates an order', async () => {
    const res = await post('/orders', { note: 'a ) in a string' });
    expect(res.status).toBe(201);
  });

  it.each([
    ['(', 1],
    [')', 2],
  ])('rejects %s', async (text, n) => {
    // a ( in a comment
    expect(text).toMatch(/[()]\\)/);
    expect(\`\${n})\`).toBeDefined();
  });

  it('reads one', () => expect(get(1)).toBe(true));
});
`;

test('a test block runs from its line to the parenthesis that closes the call', () => {
  assert.deepEqual(testBlock(SPEC, 4), [4, 7]);
});

test('it.each is one call: the table and the test', () => {
  assert.deepEqual(testBlock(SPEC, 9), [9, 16]);
});

test('a one-line test is its own line', () => {
  assert.deepEqual(testBlock(SPEC, 18), [18, 18]);
});

test('a line with no call has no block', () => {
  assert.equal(testBlock(SPEC, 2), undefined);
});

test('the diff gives the new-side lines of each hunk, and a deletion touches both neighbours', () => {
  const diff = [
    'diff --git a/test/orders.spec.ts b/test/orders.spec.ts',
    '--- a/test/orders.spec.ts',
    '+++ b/test/orders.spec.ts',
    '@@ -5 +5 @@ describe',
    '-old',
    '+new',
    '@@ -12,2 +11,0 @@',
    '-gone',
    '-gone',
    'diff --git a/test/new.spec.ts b/test/new.spec.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/test/new.spec.ts',
    '@@ -0,0 +1,3 @@',
    '+a',
    '+b',
    '+c',
    'diff --git a/test/removed.spec.ts b/test/removed.spec.ts',
    'deleted file mode 100644',
    '--- a/test/removed.spec.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
  ].join('\n');
  const changes = parseDiff(diff);
  assert.deepEqual([...changes.get('test/orders.spec.ts')], [5, 11, 12]);
  assert.deepEqual([...changes.get('test/new.spec.ts')], [1, 2, 3]);
  assert.equal(changes.has('test/removed.spec.ts'), false);
});

test('a test is touched when a changed line falls inside it, and only then', () => {
  const read = () => SPEC;
  const changes = new Map([['test/orders.spec.ts', new Set([6])]]);
  assert.deepEqual(touched({ file: 'test/orders.spec.ts', line: 4 }, changes, read), { touched: true, exact: true });
  assert.deepEqual(touched({ file: 'test/orders.spec.ts', line: 9 }, changes, read), { touched: false, exact: true });
  assert.deepEqual(touched({ file: 'test/other.spec.ts', line: 4 }, changes, read), { touched: false, exact: true });
});

test('a change outside every test (a helper, a hook) touches none', () => {
  const changes = new Map([['test/orders.spec.ts', new Set([1, 8, 17])]]);
  for (const line of [4, 9, 18]) {
    assert.equal(touched({ file: 'test/orders.spec.ts', line }, changes, () => SPEC).touched, false);
  }
});

test('an untracked file touches all its tests', () => {
  const changes = new Map([['test/orders.spec.ts', 'all']]);
  assert.deepEqual(touched({ file: 'test/orders.spec.ts', line: 18 }, changes, () => SPEC), { touched: true, exact: true });
});

test('without a recorded line, any change to the file counts, flagged as not exact', () => {
  const changes = new Map([['test/orders.spec.ts', new Set([1])]]);
  assert.deepEqual(touched({ file: 'test/orders.spec.ts' }, changes, () => SPEC), { touched: true, exact: false });
});
