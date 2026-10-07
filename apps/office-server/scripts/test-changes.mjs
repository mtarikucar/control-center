// Which tests changed against main (acceptance R12): for every test file that differs from main, the it(...) blocks
// removed, added, or with a different body (to the close of their describe, whitespace ignored).
//   node apps/office-server/scripts/test-changes.mjs [repo] [--show]   (--show: the differing statements)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const repo = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd();
const show = process.argv.includes('--show');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
const files = git('diff', '--name-only', 'main', '--', '*test*', '*.test.*').split('\n').filter(Boolean);
const blocks = (src) => {
  const out = new Map();
  const re = /^(\s*)it(?:\.\w+)?\((['`])(.+?)\2,/gm;
  let m;
  const starts = [];
  while ((m = re.exec(src))) starts.push({ name: m[3], at: m.index, indent: m[1] });
  starts.forEach((s, i) => {
    let end = i + 1 < starts.length ? starts[i + 1].at : src.length;
    const close = src.indexOf('\n});', s.at);
    if (close >= 0 && close < end) end = close;
    out.set(s.name, src.slice(s.at, end).replace(/\s+/g, ' ').trim());
  });
  return out;
};
for (const f of files) {
  let before = '';
  try { before = execFileSync('git', ['-C', repo, 'show', `main:${f}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { before = ''; }
  const after = existsSync(`${repo}/${f}`) ? readFileSync(`${repo}/${f}`, 'utf8') : '';
  const a = blocks(before), b = blocks(after);
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const added = [...b.keys()].filter((k) => !a.has(k));
  const changed = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k));
  if (!removed.length && !changed.length && !added.length) continue;
  console.log(`\n## ${f}${before ? '' : ' (yeni dosya)'}`);
  for (const k of removed) console.log(`  SİLİNDİ: ${k}`);
  for (const k of changed) {
    console.log(`  DEĞİŞTİ: ${k}`);
    if (show) {
      const x = a.get(k).split(/(?=expect\(|t\.notices\.add|const |await )/), y = b.get(k).split(/(?=expect\(|t\.notices\.add|const |await )/);
      for (const l of x) if (!y.includes(l)) console.log(`      - ${l.slice(0, 240)}`);
      for (const l of y) if (!x.includes(l)) console.log(`      + ${l.slice(0, 240)}`);
    }
  }
  for (const k of added) console.log(`  EKLENDİ: ${k}`);
}
