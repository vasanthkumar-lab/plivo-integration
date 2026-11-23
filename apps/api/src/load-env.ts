import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Loads .env before anything reads process.env.
 *
 * Checked in order, later files win:
 *   <repo root>/.env      <- the usual place for this demo
 *   apps/api/.env         <- per-service override, if you prefer that layout
 *
 * Uses Node's built-in loader (Node >= 20.12), so there is no dotenv dependency.
 */
export function loadEnv(): string[] {
  // dist/main.js -> apps/api/dist -> apps/api -> apps -> <repo root>
  const apiDir = resolve(__dirname, '..');
  const repoRoot = resolve(apiDir, '..', '..');

  const candidates = [resolve(repoRoot, '.env'), resolve(apiDir, '.env')];
  const loaded: string[] = [];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      (process as any).loadEnvFile(file);
      loaded.push(file);
    } catch (err) {
      console.warn(`[env] could not read ${file}: ${(err as Error).message}`);
    }
  }

  return loaded;
}
