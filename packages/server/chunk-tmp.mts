import { advanceDays, generateLeague, offseasonStep, type League } from '@hockey-gm/sim-core';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const stripBox = (L: League) => { for (const g of L.schedule) if (g.result) (g.result as any).box = null; for (const r of L.playoffs?.rounds ?? []) for (const s of r) for (const g of s.games) if (g.result) (g.result as any).box = null; };
// Chunks: each top-level key; big records split into 32 buckets by key hash; big arrays into runs of 200.
function chunks(L: League): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(L)) {
    const s = JSON.stringify(v ?? null);
    if (s.length < 20000) { out.set(k, s); continue; }
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 200) out.set(`${k}[${i}]`, JSON.stringify(v.slice(i, i + 200))); continue; }
    if (v && typeof v === 'object') {
      const b: Record<number, Record<string, unknown>> = {};
      for (const [id, x] of Object.entries(v)) { const h = createHash('md5').update(id).digest()[0] % 32; (b[h] ??= {})[id] = x; }
      for (const [h, x] of Object.entries(b)) out.set(`${k}#${h}`, JSON.stringify(x));
      continue;
    }
    out.set(k, s);
  }
  return out;
}
const gz = (s: string) => gzipSync(s).length;
function day(L: League, label: string, n = 1) {
  const before = chunks(L);
  advanceDays(L, n); stripBox(L);
  const after = chunks(L);
  let changed = 0, keys: Record<string, number> = {};
  for (const [k, v] of after) if (before.get(k) !== v) { const z = gz(v); changed += z; const top = k.split(/[#[]/)[0]; keys[top] = (keys[top] ?? 0) + z; }
  const full = gz(JSON.stringify(L));
  console.log(label, 'full gz', (full / 1e3).toFixed(0), 'KB; changed chunks gz', (changed / 1e3).toFixed(0), 'KB;', Object.entries(keys).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, z]) => `${k} ${(z / 1e3).toFixed(0)}K`).join(', '));
}
const L = generateLeague({ seed: 5 } as never);
advanceDays(L, 40); stripBox(L);
day(L, 'S1 day 41');
for (let s = 0; s < 3; s++) {
  while (L.phase !== 'offseason') { advanceDays(L, 10); stripBox(L); }
  while (L.phase === 'offseason') { try { offseasonStep(L, { force: true }); } catch { advanceDays(L, 1); } stripBox(L); }
  advanceDays(L, 40); stripBox(L);
  const top = Object.entries(L).map(([k, v]) => [k, gz(JSON.stringify(v ?? null))] as const).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`season ${s + 2} day 40 top gz:`, top.map(([k, n]) => `${k} ${(n / 1e3).toFixed(0)}K`).join(', '));
  day(L, `S${s + 2} day 41`);
}
