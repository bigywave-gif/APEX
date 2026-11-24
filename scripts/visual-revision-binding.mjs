import fs from 'node:fs';
import crypto from 'node:crypto';

const hash = text => `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;

/** Preserve a visual role only when its frozen log is an intact prefix and
 * every later Router revision explicitly leaves the visual baseline intact. */
export function visualRevisionBindingCurrent(file, expectedHash) {
  const text = fs.readFileSync(file, 'utf8');
  if (hash(text) === expectedHash) return true;
  const chunks = text.match(/[^\n]*\n|[^\n]+/g) || [];
  let prefix = '';
  for (let index = 0; index < chunks.length; index += 1) {
    prefix += chunks[index];
    if (hash(prefix) !== expectedHash) continue;
    return chunks.slice(index + 1).every(chunk => {
      try {
        const revision = JSON.parse(chunk);
        const checkpoint = ['gate1', 'visual-plan', 'visual', 'stitch', 'implementation'].includes(revision.checkpoint);
        return checkpoint && (revision.impact === 'non-baseline' || (revision.checkpoint === 'implementation' && revision.impact === 'implementation-only'));
      } catch { return false; }
    });
  }
  return false;
}
