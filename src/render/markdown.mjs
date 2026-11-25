// The PR comment: each story, and under it the test's full trace, collapsed.
//
// GitHub Markdown, no JS: the story in a text fence, the raw trace (every span, hooks
// included) in a <details> for the reviewer who wants to check what the story left out.
// A comment holds at most 65,536 characters: stories always go in, traces only while
// they fit, and the ones left out are named so the reviewer finds them in the artifact.

const BUDGET = 60000; // under GitHub's 65,536, leaving room for the caller's own lines

const fence = (text) => '```text\n' + text + '\n```';

/**
 * @param {{ intro: string[], stories: { text: string, raw: string, name: string }[] }} input
 *   intro: lines before the stories (the --since summary, coverage warnings)
 *   name: the recording's file name, to find its .raw.txt in the artifact
 */
export function comment({ intro, stories }) {
  const head = intro.length ? fence(intro.join('\n\n')) : '';
  const blocks = stories.map((s) => fence(s.text));
  let size = head.length + blocks.reduce((n, b) => n + b.length + 2, 0);
  if (size > BUDGET) return cut(head, blocks);

  const parts = head ? [head] : [];
  stories.forEach((s, i) => {
    parts.push(blocks[i]);
    const details = `<details><summary>Full trace</summary>\n\n${fence(s.raw)}\n\n</details>`;
    if (size + details.length + 2 <= BUDGET) {
      parts.push(details);
      size += details.length + 2;
    } else {
      parts.push(`<sub>Full trace too long for the comment: \`${s.name}.raw.txt\` in the artifact.</sub>`);
    }
  });
  return parts.join('\n\n');
}

// Even the stories alone don't fit: as many as fit, then the count of the rest
function cut(head, blocks) {
  const parts = head ? [head] : [];
  let size = head.length;
  let shown = 0;
  for (const b of blocks) {
    if (size + b.length + 2 > BUDGET) break;
    parts.push(b);
    size += b.length + 2;
    shown++;
  }
  parts.push(`<sub>${blocks.length - shown} more stories, and every full trace, in the artifact.</sub>`);
  return parts.join('\n\n');
}
