import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from './config';

// Plain fetch, like @slack/web-api does: the outbound call we want to see in the recording
@Injectable()
export class SlackClient {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async userName(userId: string): Promise<string | null> {
    const body = await this.call('users.info', { user: userId });
    return body.ok ? body.user.name : null;
  }

  async postMessage(text: string): Promise<void> {
    await this.call('chat.postMessage', { channel: this.config.SLACK_CHANNEL, text });
  }

  private async call(method: string, payload: Record<string, string>) {
    const response = await fetch(`${this.config.SLACK_API_URL}/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.SLACK_BOT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
}
