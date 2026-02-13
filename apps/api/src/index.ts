import { createApp } from './app.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = await createApp({ logger: true });

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err: unknown) {
    app.log.error(String(err));
    process.exit(1);
  }
}

void main();
