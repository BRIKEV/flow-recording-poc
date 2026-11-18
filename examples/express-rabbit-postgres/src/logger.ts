import pino from 'pino';

// The app's logger. pino's OTel instrumentation sends each log through OTel too, with the
// span it was written in.
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
