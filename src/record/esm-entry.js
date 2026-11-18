// Fix for Vitest + OTel ESM instrumentation (test only).
//
// The problem: Vitest imports every dependency by its absolute path
// (/…/node_modules/pino/pino.js), not by its name. OTel's ESM hook (import-in-the-middle)
// then sees "a file inside pino" instead of "pino", and an instrumentation that replaces
// a package's export (pino's does) never patches it. pg or amqplib are not affected:
// their instrumentations patch prototypes, not the export.
//
// The fix: when Vitest imports a package's main entry by path, resolve it by the package
// name instead, as the app's own `import 'pino'` would. It knows no library. It only
// matters when the app registers OTel's ESM hook (module.registerHooks, Node >= 22.22.3 /
// 24.11.1), which is the standard OTel setup for an app that imports as ESM.
import module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function resolvePackageEntriesByName() {
  if (typeof module.registerHooks !== 'function') return;
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const path = specifier.startsWith('file://') ? fileURLToPath(specifier) : specifier;
      // /…/node_modules/<name>/<file>, <name> possibly scoped (@scope/name)
      const m = path.startsWith('/') && path.match(/^(.*\/node_modules\/)((?:@[^/]+\/)?[^/]+)\/.+$/);
      // Leave alone require(), and the ESM hook's own import of the original module (from its
      // wrapper, `…?iitm=true`), or the wrapper would import itself
      const fromHook = context.parentURL?.includes('iitm');
      if (!m || fromHook || context.conditions?.includes('require')) return nextResolve(specifier, context);
      const [, dir, name] = m;
      try {
        // Is this file what `import '<name>'` gives? Then import it by name.
        const entry = nextResolve(name, { ...context, parentURL: pathToFileURL(dir).href });
        if (entry.url.split('?')[0] === pathToFileURL(path).href) return entry;
      } catch {
        // no main entry for `import`: leave the path as it is
      }
      return nextResolve(specifier, context);
    },
  });
}
