// --since <ref>: keep only the tests a change added or modified, the MVP's comment.
//
// A test is touched when a line changed since <ref> falls inside its it()/test() call,
// from the line the runner recorded (flow.test.line) to the parenthesis that closes the
// call. "Changed since <ref>" is what a PR shows: the diff from the merge-base with <ref>
// to the working tree, plus untracked files, so it works before committing too.
//
// Changes outside any test (a helper, a beforeEach) touch no test: the comment is about
// the tests the PR wrote, not every test its change can reach.
import { execFileSync } from 'node:child_process';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * Lines changed since the merge-base with `ref`, per file, with paths relative to `cwd`
 * (as the runner records flow.test.file). A new or untracked file maps to 'all'.
 * @returns {Map<string, Set<number> | 'all'>}
 */
export function changedLines(ref, cwd = process.cwd()) {
  const base = git(cwd, 'merge-base', ref, 'HEAD').trim();
  const changes = parseDiff(git(cwd, 'diff', '-U0', '--no-color', '--no-ext-diff', '--relative', base));
  for (const file of git(cwd, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
    changes.set(file, 'all');
  }
  return changes;
}

/** @returns {Map<string, Set<number> | 'all'>} */
export function parseDiff(diff) {
  const changes = new Map();
  let file;
  for (const line of diff.split('\n')) {
    let m;
    if (line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? undefined : line.slice(4).replace(/^b\//, '');
      if (file) changes.set(file, new Set());
    } else if (file && (m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/))) {
      // A new file comes as one hunk, @@ -0,0 +1,N @@: every line is marked
      const lines = changes.get(file);
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      // A pure deletion (count 0) sits between lines `start` and `start + 1`: both are touched
      if (count === 0) lines.add(start).add(start + 1);
      for (let i = 0; i < count; i++) lines.add(start + i);
    }
  }
  return changes;
}

/**
 * The lines a test call spans, from its first line to the parenthesis that closes it:
 * `it('…', async () => { … })`, and `it.each([…])('…', …)` as one call. Strings, template
 * literals, comments and regex literals are skipped, so a parenthesis in them doesn't count.
 * @returns {[number, number] | undefined}
 */
export function testBlock(source, line) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  let i = source.indexOf('(', starts[line - 1]);
  if (i < 0 || (starts[line] !== undefined && i >= starts[line])) return undefined;
  const lineOf = (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  let depth = 0;
  let prev = '('; // last significant character, to tell a regex from a division
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuoted(source, i); prev = ch; continue; }
    if (ch === '/' && /[(,=:[!&|?{};+\-*%<>~^]/.test(prev)) { i = skipRegex(source, i); prev = '/'; continue; }
    if (/\s/.test(ch)) continue;
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) {
      // it.each([…])('name', fn): the call goes on
      let j = i + 1;
      while (/\s/.test(source[j] ?? '')) j++;
      if (source[j] !== '(') return [line, lineOf(i)];
    }
    prev = ch;
  }
  return undefined;
}

function skipQuoted(s, i) {
  const quote = s[i];
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === quote) return i;
  }
  return i;
}

function skipRegex(s, i) {
  let inClass = false;
  for (i++; i < s.length && s[i] !== '\n'; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '[') inClass = true;
    else if (s[i] === ']') inClass = false;
    else if (s[i] === '/' && !inClass) return i;
  }
  return i;
}

/**
 * Whether a recorded test was touched. Without a recorded line (the runner didn't collect
 * locations), any change to its file counts, and `exact` says so.
 * @param {{ file?: string, line?: number }} test
 * @param {Map<string, Set<number> | 'all'>} changes
 * @param {(file: string) => string} read
 */
export function touched(test, changes, read) {
  const lines = test.file && changes.get(test.file);
  if (!lines) return { touched: false, exact: true };
  if (lines === 'all') return { touched: true, exact: true };
  if (!test.line) return { touched: lines.size > 0, exact: false };
  const block = testBlock(read(test.file), test.line);
  if (!block) return { touched: lines.size > 0, exact: false };
  for (const l of lines) if (l >= block[0] && l <= block[1]) return { touched: true, exact: true };
  return { touched: false, exact: true };
}
