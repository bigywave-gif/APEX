import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { visualRevisionBindingCurrent } from './visual-revision-binding.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-visual-revision-'));
try {
  const file = path.join(dir, 'revisions.ndjson'), line = value => `${JSON.stringify(value)}\n`;
  const initial = line({ checkpoint: 'visual', impact: 'visible', reason: '调整视觉方案' });
  const expected = `sha256:${crypto.createHash('sha256').update(initial).digest('hex')}`;
  const check = (suffix, value) => { fs.writeFileSync(file, initial + suffix); assert.equal(visualRevisionBindingCurrent(file, expected), value); };
  check('', true);
  check(line({ checkpoint: 'visual', impact: 'non-baseline' }), true);
  check(line({ checkpoint: 'implementation', impact: 'implementation-only' }), true);
  check(line({ checkpoint: 'visual', impact: 'non-baseline' }) + line({ checkpoint: 'implementation', impact: 'implementation-only' }), true);
  check(line({ checkpoint: 'visual', impact: 'visible' }), false);
  check(line({ checkpoint: 'visual', impact: 'implementation-only' }), false);
  check(line({ checkpoint: 'unknown', impact: 'non-baseline' }), false);
  check('{not-json}\n', false);
  fs.writeFileSync(file, initial.replace('视觉', '其他') + line({ checkpoint: 'visual', impact: 'non-baseline' }));
  assert.equal(visualRevisionBindingCurrent(file, expected), false);
  console.log(JSON.stringify({ status: 'passed', checks: 9 }));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
