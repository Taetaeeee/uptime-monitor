import { readFile } from 'node:fs/promises';
import { ROLE_NAMES } from './model.mjs';
export async function loadConfig(path) {
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(config.teams) || !config.teams.length || config.teams.length > 4) throw new Error('invalid_config');
  const ids = new Set();
  for (const team of config.teams) {
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(team.id) || ids.has(team.id) || typeof team.name !== 'string' || team.name.length > 80 || !team.sessions?.leader) throw new Error('invalid_team');
    ids.add(team.id);
    for (const [role, id] of Object.entries(team.sessions)) if (!Object.hasOwn(ROLE_NAMES, role) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid_binding');
    if (new Set(Object.values(team.sessions)).size !== Object.keys(team.sessions).length) throw new Error('duplicate_role_session');
  }
  return config;
}
