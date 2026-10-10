import { spawn } from 'node:child_process';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('ControlCenter için Node.js 24 veya üstü gerekir. Node sürümünü güncelleyip pnpm office:codex komutunu yeniden çalıştırın.');
  process.exit(1);
}
const pnpm = process.env.npm_execpath;
if (!pnpm) { console.error('Bu başlatıcıyı pnpm office:codex ile çalıştırın.'); process.exit(1); }
process.env.OFFICE_PROVIDER = 'codex';
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [pnpm, '--filter', '@cc/office-web', 'build'], { stdio: 'inherit', windowsHide: true });
  child.on('error', reject); child.on('close', resolve);
});
if (code !== 0) process.exit(code ?? 1);
await import('../apps/office-server/src/main.ts');
