// Coverage: which libraries produced nothing.
//
// A boundary library (database, queue, cache, http client) the app loaded, whose OTel
// instrumentation produced no span in this test file, is a silent gap: its calls are
// missing from the stories, and nothing else would tell. Same for a logger that sent no
// logs, when the app asked for logs. This writes what it saw per test file; the CLI
// (render/coverage.mjs) warns about the libraries no file saw.
//
// Only boundaries: a framework's spans (express, nest) are flattened by the story anyway,
// and some libraries are loaded without being used (msw loads graphql). The instrumentation
// is found by OTel's naming convention: pg → @opentelemetry/instrumentation-pg.
// Limit: only CommonJS packages are seen (require.cache).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { logsWanted, seenScopes } from './processor.js';

const BOUNDARIES = new Set([
  'pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'tedious', 'oracledb', 'cassandra-driver', 'knex',
  'ioredis', 'redis', 'memcached',
  'amqplib', 'kafkajs',
  'undici', 'socket.io', 'openai',
]);
// Loggers whose instrumentation sends their logs through OTel
const LOGGERS = new Set(['pino', 'winston', 'bunyan']);

export function writeCoverage(dir, testFile) {
  const require = createRequire(join(process.cwd(), 'noop.js'));
  const packages = new Set();
  for (const file of Object.keys(require.cache)) {
    const m = file.match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m) packages.add(m[1]);
  }
  const report = [...packages].sort().flatMap((pkg) => {
    const logger = LOGGERS.has(pkg) && logsWanted();
    if (!BOUNDARIES.has(pkg) && !logger) return [];
    const instrumentation = `@opentelemetry/instrumentation-${pkg.replace(/^@/, '').replace('/', '-')}`;
    try {
      require.resolve(instrumentation);
    } catch {
      return []; // not installed: the app never meant to instrument it
    }
    return [{ package: pkg, instrumentation, signal: logger ? 'logs' : 'spans', seen: seenScopes().has(instrumentation) }];
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${basename(testFile ?? 'unknown')}.json`), JSON.stringify(report, null, 2));
}
