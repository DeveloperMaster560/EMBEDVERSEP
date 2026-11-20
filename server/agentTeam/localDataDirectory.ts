import { homedir } from 'node:os';
import { join } from 'node:path';

/** Datos y auditoría locales; nunca dentro del repositorio ni de IndexedDB. */
export function defaultAgentDataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (env.EMBEDVERSE_DATA_DIR?.trim()) return env.EMBEDVERSE_DATA_DIR.trim();
  if (process.platform === 'win32') {
    const base = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(base, 'EMBEDVERSE', 'agent-runtime');
  }
  const base = env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'embedverse', 'agent-runtime');
}
