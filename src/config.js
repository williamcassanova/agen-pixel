import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.PIXEL_OFFICE_DATA
  ? path.resolve(process.env.PIXEL_OFFICE_DATA)
  : path.join(ROOT, 'data');
export const WORKSPACE_ROOT = process.env.PIXEL_OFFICE_WORKSPACES
  ? path.resolve(process.env.PIXEL_OFFICE_WORKSPACES)
  : path.join(ROOT, 'workspaces');
export const DB_PATH = process.env.PIXEL_OFFICE_DB || path.join(DATA_DIR, 'pixel-office.db');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const LOG_DIR = path.join(ROOT, 'logs');

export const HOST = process.env.PIXEL_OFFICE_HOST || '127.0.0.1';
export const PORT = Number(process.env.PIXEL_OFFICE_PORT || 3000);

export const LIMITS = {
  bodyBytes: 256 * 1024,
  instructionLength: 4000,
  nameLength: 60,
  descriptionLength: 4000,
  outputBytes: 200 * 1024,
  logLines: 600,
  executionTimeoutMs: Number(process.env.PIXEL_OFFICE_TASK_TIMEOUT || 10 * 60 * 1000),
};

for (const dir of [DATA_DIR, WORKSPACE_ROOT, LOG_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const STATUS = {
  WAITING: 'Menunggu',
  PLANNED: 'Direncanakan',
  WORKING: 'Sedang dikerjakan',
  REVIEW: 'Dalam pemeriksaan',
  APPROVAL: 'Memerlukan persetujuan CEO',
  DONE: 'Selesai',
  FAILED: 'Gagal',
  CANCELLED: 'Dibatalkan',
};

export const TASK_STATUS = [
  STATUS.WAITING,
  STATUS.PLANNED,
  STATUS.WORKING,
  STATUS.REVIEW,
  STATUS.APPROVAL,
  STATUS.DONE,
  STATUS.FAILED,
  STATUS.CANCELLED,
];
