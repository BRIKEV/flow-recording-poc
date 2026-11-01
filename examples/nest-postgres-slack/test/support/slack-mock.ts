import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// msw replaces globalThis.fetch: the case that hides outbound calls from OTel (see flow-recording.ts)
export function createSlackMock() {
  const users = new Map<string, string>();
  const posted: string[] = [];

  const server = setupServer(
    http.post('https://slack.com/api/users.info', async ({ request }) => {
      const { user } = (await request.json()) as { user: string };
      const name = users.get(user);
      return HttpResponse.json(name ? { ok: true, user: { id: user, name } } : { ok: false, error: 'user_not_found' });
    }),
    http.post('https://slack.com/api/chat.postMessage', async ({ request }) => {
      const { text } = (await request.json()) as { text: string };
      posted.push(text);
      return HttpResponse.json({ ok: true });
    }),
  );

  return {
    server,
    posted,
    addUser: (id: string, name: string) => users.set(id, name),
    reset() {
      users.clear();
      posted.length = 0;
    },
  };
}
