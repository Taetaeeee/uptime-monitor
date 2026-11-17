import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const quotePs = value => `'${String(value).replaceAll("'", "''")}'`;

// 임의 shell 명령을 받지 않습니다. 프롬프트는 서버가 만든 파일로만 전달합니다.
export function createPaseoCli({ command = process.env.PASEO_CLI_COMMAND ?? (process.platform === 'win32' ? 'paseo.cmd' : 'paseo'), cwd, execute = exec } = {}) {
  async function run(args) {
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.PASEO_AGENT_ID; delete env.PASEO_WORKSPACE_ID;
    const options = { cwd, env, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8' };
    const script = `& ${quotePs(command)} ${args.map(quotePs).join(' ')}; exit $LASTEXITCODE`;
    const result = process.platform === 'win32'
      ? await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], options)
      : await execute(command, args, options);
    return result.stdout;
  }
  return {
    async list() {
      const rows = JSON.parse(await run(['ls', '--global', '--json']));
      if (!Array.isArray(rows)) throw new Error('invalid_list');
      return rows.map(row => {
        const [provider, ...model] = String(row.provider ?? '').split('/');
        return { Id: row.id, Name: row.name, Cwd: row.cwd, Provider: provider, Model: model.join('/'), Status: row.status };
      });
    },
    async inspect(id) {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid_session');
      return JSON.parse(await run(['inspect', id, '--json']));
    },
    async send(id, promptPath) {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid_session');
      // 기다리지 않고 접수만 합니다. 완료는 해당 작업의 명시적 결과 게시로 확인합니다.
      await run(['send', id, '--prompt-file', promptPath, '--behavior', 'steer', '--no-wait', '--json']);
    },
  };
}
