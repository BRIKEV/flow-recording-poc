export const CONFIG = Symbol('CONFIG');

export type Config = {
  PORT: number;
  DATABASE_URL: string;
  SLACK_API_URL: string;
  SLACK_BOT_TOKEN: string;
  SLACK_CHANNEL: string;
};

export function configFromEnv(env = process.env): Config {
  return {
    PORT: Number(env.PORT ?? 3000),
    DATABASE_URL: env.DATABASE_URL ?? 'postgres://flow:flow@localhost:5440/flow_test',
    SLACK_API_URL: env.SLACK_API_URL ?? 'https://slack.com/api',
    SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN ?? 'xoxb-local',
    SLACK_CHANNEL: env.SLACK_CHANNEL ?? 'CNOTES',
  };
}
