import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';


for (const file of [
  resolve(process.cwd(), '../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'apps/api/.env'),
]) {
  if (existsSync(file)) (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(file);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
