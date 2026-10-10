import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();
// Set before listening so req.ip respects the platform's TLS proxy.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

const server = app.listen(config.port, () => {
  console.log(`StoreMap listening on ${config.publicBaseUrl} (port ${config.port})`);
  console.log(`  dev login: ${config.devLogin ? 'enabled' : 'disabled'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
