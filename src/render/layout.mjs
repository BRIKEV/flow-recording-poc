// The story's layout: actors, arrows, indentation, parallel calls and ×N. What each line
// says comes from describe.mjs; which lines exist, from curate.mjs.
import { CLIENT, tree } from './spans.mjs';
import { decide, shownLog } from './curate.mjs';
import { describeLog, describeSpan } from './describe.mjs';

// The story: the trace as a sequence of messages between actors, in the order they
// happened. Whatever happens inside the app is indented under the message that entered
// it, and the answer comes back on its own line after it. Identical consecutive lines
// fold into ×N.
export function story(spans, config) {
  const { root, kids } = tree(spans);
  const sut = config.sut ?? 'app';
  const name = (peer) => config.peers?.[peer] ?? peer;
  const lines = []; // { indent, head, text }
  const say = (indent, from, arrow, to, text) => lines.push({ indent, head: [from, arrow, to], text });

  // Kept children of a span; a flattened span is replaced by its own kept children. A
  // flattened test client call hands its bodies to the server span it reached.
  // The span's own logs come in among them, by the order they were written.
  const visible = (s, inherited) =>
    [
      ...kids(s).flatMap((k) => {
        const action = decide(k, kids(k), config);
        if (action === 'hide') return [];
        if (action === 'show') return [{ span: k, order: k.order, end: k.endOrder, d: describeSpan(k, inherited) }];
        const bodies = { request: k.attributes['flow.request.body'], response: k.attributes['flow.response.body'] };
        return visible(k, k.kind === CLIENT ? bodies : undefined);
      }),
      ...(s.logs ?? []).filter((l) => shownLog(l, config)).map((l) => ({ order: l.order, end: l.order, d: describeLog(l) })),
    ].sort((a, b) => a.order - b.order);

  // A call with nothing under it, the kind that can be shown as one of a parallel group
  const leafCall = (item) => item.d.type === 'call' && !visible(item.span).length;

  const one = ({ span: k, d }, actor, indent) => {
    // Lines inside start under the receiving actor's name
    const inner = indent + actor.length + 3;
    if (d.type === 'log') say(indent, actor, '·', d.level, d.text);
    else if (d.type === 'enter' || (d.type === 'step' && actor !== sut)) {
      say(indent, actor, '→', sut, d.text);
      walk(k, sut, inner);
      if (d.result) say(indent, actor, '←', sut, d.result);
    } else if (d.type === 'consume') {
      say(indent, name(d.peer), '⇢', sut, d.text);
      walk(k, sut, indent + name(d.peer).length + 3);
    } else if (d.type === 'publish') {
      say(indent, actor, '⇢', name(d.peer), d.text);
      walk(k, actor, inner);
    } else if (d.type === 'call') {
      say(indent, actor, '→', name(d.peer), d.text);
      walk(k, actor, inner);
      if (d.result) say(indent, actor, '←', name(d.peer), d.result);
    } else {
      say(indent, actor, '', '', d.text); // a step of the app
      walk(k, actor, inner);
    }
  };

  // Calls that ran in parallel (each started before an earlier one ended): all the
  // requests, bracketed, then the answers in the order the calls started.
  const parallel = (group, actor, indent) => {
    const width = Math.max(...group.map((g) => g.d.text.length));
    group.forEach((g, i) => {
      const mark = i === 0 ? '┐ in parallel' : i === group.length - 1 ? '┘' : '│';
      say(indent, actor, '→', name(g.d.peer), `${g.d.text.padEnd(width)}  ${mark}`);
    });
    for (const g of group) if (g.d.result) say(indent, actor, '←', name(g.d.peer), g.d.result);
  };

  const walk = (s, actor, indent, inherited) => {
    const items = visible(s, inherited);
    for (let i = 0; i < items.length; ) {
      let j = i + 1;
      let end = items[i].end;
      while (leafCall(items[i]) && j < items.length && leafCall(items[j]) && items[j].order < end) {
        end = Math.max(end, items[j].end);
        j++;
      }
      if (j - i > 1) parallel(items.slice(i, j), actor, indent);
      else one(items[i], actor, indent);
      i = j;
    }
  };
  walk(root, 'test', 2, undefined);

  // Line up the text after "from → to" across the story
  const width = Math.max(0, ...lines.map((l) => l.head[2].length));
  const rendered = lines.map(({ indent, head: [from, arrow, to], text }) => {
    const head = arrow ? `${from} ${arrow} ${to.padEnd(width)}` : `${from} ${''.padEnd(width + 2)}`;
    return `${' '.repeat(indent)}${head}  ${text}`;
  });
  const folded = [];
  for (const r of rendered) {
    const prev = folded.at(-1);
    if (prev && prev.text === r) prev.times++;
    else folded.push({ text: r, times: 1 });
  }

  const state = root.attributes['flow.test.state'];
  const suite = root.attributes['flow.test.suite'];
  const header = `${state === 'pass' ? '✔' : state === 'fail' ? '✘' : '·'} ${suite ? `${suite} › ` : ''}${root.name}`;
  // A test with nothing to show says so, instead of a bare header that reads like a bug
  if (!folded.length) return `${header}\n  (no flow: the test made no call the instrumentation sees)`;
  return [header, ...folded.map((f) => (f.times > 1 ? `${f.text} ×${f.times}` : f.text))].join('\n');
}
