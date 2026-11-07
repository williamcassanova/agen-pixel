import { BaseAdapter, safeJson } from './base.js';
import { redactSecrets } from '../security.js';

export class HermesAdapter extends BaseAdapter {
  constructor(engine) {
    super(engine);
    this.config = {
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      runArgs: [],
      modelFlag: '',
      dirFlag: '',
      autoApproveFlag: '',
      extraArgs: [],
      timeoutMs: 600000,
      models: [],
      ...safeJson(engine.config, {}),
    };
  }

  async detect() {
    return { executable: await BaseAdapter.detectExecutable('hermes', this.engine.executable || '') };
  }

  fillTemplate(token, { prompt, model, workdir }) {
    const map = { '{prompt}': prompt, '{model}': model || '', '{dir}': workdir };
    let out = String(token);
    for (const [key, value] of Object.entries(map)) out = out.split(key).join(value);
    return out;
  }

  buildRunArgs({ prompt, model, workdir }) {
    const template = Array.isArray(this.config.runArgs) ? this.config.runArgs : [];
    const args = template.map((token) => this.fillTemplate(token, { prompt, model, workdir }));
    if (this.config.modelFlag && model) {
      args.push(this.fillTemplate(this.config.modelFlag, { prompt, model, workdir }), model);
    }
    if (this.config.dirFlag) {
      args.push(this.fillTemplate(this.config.dirFlag, { prompt, model, workdir }), workdir);
    }
    if (this.config.autoApproveFlag) {
      args.push(this.fillTemplate(this.config.autoApproveFlag, { prompt, model, workdir }));
    }
    for (const extra of this.config.extraArgs || []) args.push(String(extra));
    return args;
  }

  async testConnection({ prompt = '', model = '' } = {}) {
    const { executable } = await this.detect();
    if (!executable) {
      return {
        ok: false,
        status: 'Belum terhubung',
        executable: '',
        version: '',
        models: this.config.models || [],
        message: 'Executable Hermes Agent tidak ditemukan. Pasang Hermes atau isi lokasi executable secara manual.',
        logs: '',
      };
    }
    const versionProbe = await BaseAdapter.runProbe(executable, this.config.versionArgs || ['--version']);
    const version = (versionProbe.stdout || versionProbe.stderr || '').trim().split('\n')[0] || '';
    const helpProbe = await BaseAdapter.runProbe(executable, this.config.helpArgs || ['--help']);
    const helpText = `${helpProbe.stdout}\n${helpProbe.stderr}`.slice(0, 20000);
    const hasRunTemplate = Array.isArray(this.config.runArgs) && this.config.runArgs.length > 0;

    if (!versionProbe.ok && !version && !helpProbe.ok) {
      return {
        ok: false,
        status: 'Belum terhubung',
        executable,
        version: '',
        models: this.config.models || [],
        message: 'Executable ditemukan tetapi tidak merespons perintah versi maupun bantuan.',
        logs: redactSecrets(`${versionProbe.stdout}\n${versionProbe.stderr}\n${helpProbe.stdout}\n${helpProbe.stderr}`),
        help: redactSecrets(helpText),
      };
    }

    if (!hasRunTemplate) {
      return {
        ok: false,
        status: 'Perlu konfigurasi',
        executable,
        version,
        models: this.config.models || [],
        message: 'Executable terdeteksi, tetapi template argumen eksekusi Hermes belum diisi. ' +
          'Isi "Argumen eksekusi" menggunakan placeholder {prompt}, {model}, dan {dir}.',
        logs: redactSecrets(`${versionProbe.stdout}\n${versionProbe.stderr}\n${helpProbe.stdout}\n${helpProbe.stderr}`),
        help: redactSecrets(helpText),
      };
    }

    let testRun = null;
    if (prompt) {
      const args = this.buildRunArgs({ prompt, model, workdir: process.cwd() });
      testRun = await BaseAdapter.runProbe(executable, args, this.config.timeoutMs || 120000);
      if (!testRun.ok) {
        return {
          ok: false,
          status: 'Gagal tes',
          executable,
          version,
          models: this.config.models || [],
          message: 'Perintah tes prompt Hermes gagal. Periksa template argumen pada log.',
          logs: redactSecrets(`${testRun.stdout}\n${testRun.stderr}\n${testRun.error}`).slice(0, 20000),
          help: redactSecrets(helpText),
        };
      }
    }

    return {
      ok: true,
      status: 'Terhubung',
      executable,
      version,
      models: this.config.models || [],
      message: 'Hermes Agent terdeteksi dan template eksekusi telah dikonfigurasi.',
      logs: redactSecrets(`${versionProbe.stdout}\n${versionProbe.stderr}\n${testRun ? testRun.stdout + '\n' + testRun.stderr : ''}`).slice(0, 20000),
      help: redactSecrets(helpText),
    };
  }
}
