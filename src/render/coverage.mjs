// Coverage gaps: a library the app loaded, with an OTel instrumentation installed, that
// produced nothing in any test file. Its calls (or logs) are missing from every story, so
// the CLI prints this first. The runner integration writes what it saw per test file to
// .flow/coverage/<file>.json; a library seen in any file is not a gap.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function coverageWarning(coverageDir) {
  if (!existsSync(coverageDir)) return '';
  const gaps = new Map();
  const seen = new Set();
  for (const f of readdirSync(coverageDir).filter((x) => x.endsWith('.json')).sort()) {
    for (const c of JSON.parse(readFileSync(join(coverageDir, f), 'utf8'))) {
      if (c.seen) seen.add(c.package);
      else gaps.set(c.package, c);
    }
  }
  for (const pkg of seen) gaps.delete(pkg);
  return [...gaps]
    // A logger can stay quiet for two reasons we can't tell apart from here: its
    // instrumentation didn't patch it, or the app silences it in tests (a `silent` level,
    // its framework logger turned off). Name both, so the fix is found in the right place.
    .map(([pkg, c]) => c.signal === 'logs'
      ? `⚠ ${pkg} was used but ${c.instrumentation} sent no logs: its logs are missing from these stories. Either it is not instrumented, or the app silences it in tests (a silent level, its framework logger turned off)`
      : `⚠ ${pkg} was used but ${c.instrumentation} produced no spans: its calls are missing from these stories`)
    .join('\n');
}
