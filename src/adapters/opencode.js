import { BaseAdapter, safeJson } from './base.js';
import { redactSecrets } from '../security.js';

export class OpenCodeAdapter extends BaseAdapter {
  constructor(engine) {
    super(engine);
    this.config = {
      autoApprove: false,
      extraArgs: [],
      timeoutMs: 600000,
      ...safeJson(engine.config, {}),
    };
  }

  async detect() {
    const executable = await BaseAdapter.detectExecutable('opencode', this.engine.executable || '');
    return { executable };
  }

  async testConnection({ prompt = '', model = '' } = {}) {
    const { executable } = await this.detect();
    if (!executable) {
      return {
        ok: false,
        status: 'Belum terhubung',
        version: '',
        models: [],
        message: 'Executable opencode tidak ditemukan. Atur lokasi executable secara manual.',
        logs: '',
      };
    }
    const versionProbe = await BaseAdapter.runProbe(executable, ['--version']);
    const version = (versionProbe.stdout || versionProbe.stderr || '').trim().split('\n')[0] || '';
    if (!versionProbe.ok && !version) {
      return {
        ok: false,
        status: 'Belum terhubung',
        executable,
        version: '',
        models: [],
        message: 'Executable ditemukan tetapi gagal dijalankan.',
        logs: redactSecrets(`${versionProbe.stdout}\n${versionProbe.stderr}\n${versionProbe.error}`),
      };
    }
    const modelProbe = await BaseAdapter.runProbe(executable, ['models'], 30000);
    const models = (modelProbe.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:/@+-]+$/.test(line))
      .slice(0, 200);
    let testPrompt = null;
    if (prompt) {
      const args = ['run', '--dir', process.cwd()];
      if (model) args.push('-m', model);
      args.push(prompt);
      testPrompt = await BaseAdapter.runProbe(executable, args, this.config.timeoutMs || 120000);
      if (!testPrompt.ok) {
        return {
          ok: false,
          status: 'Gagal tes',
          executable,
          version,
          models,
          message: 'Perintah tes prompt gagal. Periksa autentikasi/model pada log.',
          logs: redactSecrets(`${testPrompt.stdout}\n${testPrompt.stderr}\n${testPrompt.error}`).slice(0, 20000),
        };
      }
    }
    return {
      ok: true,
      status: 'Terhubung',
      executable,
      version,
      models,
      message: prompt ? 'Koneksi OpenCode dan eksekusi prompt berhasil.' : 'Executable OpenCode terdeteksi dan merespons.',
      logs: redactSecrets(`${versionProbe.stdout}\n${versionProbe.stderr}${testPrompt ? `\n${testPrompt.stdout}\n${testPrompt.stderr}` : ''}`).slice(0, 20000),
    };
  }

  buildRunArgs({ prompt, model, workdir }) {
    const args = ['run', '--dir', workdir];
    if (model) args.push('-m', model);
    if (this.config.autoApprove) args.push('--auto');
    for (const extra of this.config.extraArgs || []) args.push(String(extra));
    args.push(prompt);
    return args;
  }
}
