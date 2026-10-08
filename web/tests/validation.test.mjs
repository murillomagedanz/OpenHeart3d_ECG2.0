// Guarda de reprodutibilidade: o relatório de validação commitado precisa ser
// exatamente o que o código atual regenera dos registros incluídos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildReport, renderMarkdown, REPORT_DIR } from './validation-report.mjs';

test('relatório de validação commitado coincide com o regenerado', async () => {
  const rep = await buildReport();
  assert.ok(rep.records.length >= 39, 'registros anotados incluídos');
  const json = (await readFile(path.join(REPORT_DIR, 'validation.json'), 'utf8')).replace(/\r\n/g, '\n');
  const md = (await readFile(path.join(REPORT_DIR, 'validation.md'), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(json, `${JSON.stringify(rep, null, 2)}\n`, 'validation.json desatualizado: rode `npm run report`');
  assert.equal(md, renderMarkdown(rep), 'validation.md desatualizado: rode `npm run report`');
});

test('protocolo: ajuste (par) e held-out (ímpar) não se misturam', async () => {
  const rep = await buildReport();
  for (const r of rep.records.filter((x) => x.db === 'ludb')) {
    assert.equal(r.split, Number(r.id.split('/')[1]) % 2 === 0 ? 'tuning' : 'held-out');
  }
});

