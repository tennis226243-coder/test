// _site/ を作り直す：site/* と data（引数で別のフォルダも指定できる）をコピー
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(root, process.argv[2] ?? 'data');
const out = resolve(root, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(root, 'site'), out, { recursive: true });
if (existsSync(dataDir)) cpSync(dataDir, resolve(out, 'data'), { recursive: true });
else console.warn(`データのフォルダがありません: ${dataDir}`);
console.log(`built ${out}`);
