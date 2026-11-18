// The raw view: every span of the recording, as a tree, nothing curated. For when the
// story hides something you need to see.
import { KIND, sql, tree } from './spans.mjs';

export function raw(spans) {
  const { root, kids } = tree(spans);
  const out = [];
  const walk = (s, depth) => {
    const a = s.attributes;
    const parts = [`[${KIND[s.kind]}] ${s.name}`];
    const url = a['url.full'] ?? a['url.path'];
    if (url) parts.push(String(url).replace(/:\d{4,5}\//, ':<port>/'));
    const status = a['http.response.status_code'];
    if (status) parts.push(`→ ${status}`);
    if (sql(s)) parts.push(`| ${sql(s).slice(0, 140)}`);
    if (a['flow.phase'] === 'hook') parts.push('(hook)');
    out.push('  '.repeat(depth) + parts.join(' '));
    const logs = (s.logs ?? []).map((l) => ({ order: l.order, log: l }));
    for (const k of [...kids(s), ...logs].sort((a, b) => a.order - b.order)) {
      if (!k.log) walk(k, depth + 1);
      else out.push('  '.repeat(depth + 1) + `[log] ${k.log.level} ${typeof k.log.body === 'string' ? k.log.body : JSON.stringify(k.log.body)}${k.log.phase === 'hook' ? ' (hook)' : ''}`);
    }
  };
  walk(root, 0);
  return out.join('\n');
}
