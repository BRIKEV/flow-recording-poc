import { createApp } from './app';
import { config } from './config';

createApp().listen(config.port, () => console.log(`bff on :${config.port}`));
