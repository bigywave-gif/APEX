import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { codexHome } from './apex-paths.mjs';
import { requiredSkillLoads } from './run-ledger.mjs';

const digest = text => `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
export function resolveTasteSkill(home = codexHome) {
  const candidates = ['taste-skill', 'design-taste-frontend'].flatMap(name => [path.join(home, 'skills', name, 'SKILL.md'), path.join(path.dirname(home), '.agents', 'skills', name, 'SKILL.md')]);
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file) throw new Error('required taste-skill is not installed');
  const content = fs.readFileSync(file, 'utf8');
  if (!content.trim()) throw new Error('required taste-skill is empty');
  return { name: 'taste-skill', path: file, sha256: digest(content) };
}
export function loadTasteSkill(binding, home = codexHome) {
  const current = resolveTasteSkill(home);
  if (!binding || current.path !== binding.path || current.sha256 !== binding.sha256) throw new Error('required taste-skill changed after role selection');
  const content = fs.readFileSync(current.path, 'utf8');
  if (digest(content) !== binding.sha256) throw new Error('required taste-skill changed while being loaded');
  return { ...current, content };
}

export function requiredTasteLoadCurrent(runDir, jobId, attempt, leaseToken, binding) {
  try {
    const root = fs.realpathSync(runDir), operations = fs.realpathSync(path.join(root, 'operations'));
    return requiredSkillLoads(runDir, jobId, attempt).some(event => {
      try {
        if (event.stage !== 'visual' || event.agentId !== 'ui-designer' || event.name !== 'taste-skill' || event.sha256 !== binding.sha256 || event.path !== binding.path || typeof event.operationReceipt !== 'string' || path.isAbsolute(event.operationReceipt)) return false;
        const receiptPath = fs.realpathSync(path.resolve(root, event.operationReceipt));
        if (!receiptPath.startsWith(`${operations}${path.sep}`)) return false;
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        if (receipt.status !== 'succeeded' || receipt.action !== 'plan_visual' || receipt.script !== 'agent-runtime.mjs') return false;
        const claim = JSON.parse(receipt.stdout || '{}');
        return claim.job_id === jobId && Number(claim.attempt) === Number(attempt) && (!leaseToken || claim.leaseToken === leaseToken) && claim.requiredSkill?.sha256 === binding.sha256 && claim.requiredSkill?.path === binding.path && digest(claim.requiredSkill?.content || '') === binding.sha256;
      } catch { return false; }
    });
  } catch { return false; }
}

export function optionalSkillLoadCurrent(runDir, event, leaseToken) {
  try {
    const actions = { gate1: 'analyze_requirement', visual: 'plan_visual', implementation: 'compile_visual_bundle' };
    if (!actions[event.stage] || !leaseToken || event.leaseTokenHash !== digest(leaseToken) || typeof event.operationReceipt !== 'string' || path.isAbsolute(event.operationReceipt)) return false;
    const root = fs.realpathSync(runDir), operations = fs.realpathSync(path.join(root, 'operations')), receiptPath = fs.realpathSync(path.resolve(root, event.operationReceipt));
    if (!receiptPath.startsWith(`${operations}${path.sep}`)) return false;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.status !== 'succeeded' || receipt.action !== actions[event.stage] || receipt.script !== 'agent-runtime.mjs') return false;
    const loaded = JSON.parse(receipt.stdout || '{}');
    return loaded.status === 'loaded' && loaded.jobId === event.jobId && loaded.skill?.name === event.name && loaded.skill?.sha256 === event.sha256 && loaded.skill?.path === event.path && digest(loaded.skill?.content || '') === event.sha256;
  } catch { return false; }
}

// These sources are offered to the designer, but their full instructions are
// loaded only when the designer selects them for the current task.
const optionalVisualSkills = [
  { name: 'google-design-md', aliases: ['google-design-md'], scope: '设计规范与实现约束' },
  { name: 'ui-ux-pro-max-skill', aliases: ['ui-ux-pro-max-skill', 'ui-ux-pro-max'], scope: '多场景样式和 UX 参考' },
  { name: 'impeccable', aliases: ['impeccable'], scope: '交互、响应式与设计审查' },
  { name: 'better-icons', aliases: ['better-icons'], scope: '图标选择与一致性' },
  { name: 'motion-ai-kit', aliases: ['motion-ai-kit'], scope: '交互动效与运动策略' },
  { name: 'react-bits', aliases: ['react-bits'], scope: 'React 动效与组件参考' },
  { name: 'redesign-existing-projects', aliases: ['redesign-skill'], scope: '既有网站改造' },
  { name: 'minimalist-ui', aliases: ['minimalist-skill'], scope: '简约视觉方向' },
  { name: 'industrial-brutalist-ui', aliases: ['brutalist-skill'], scope: '工业粗野视觉方向' },
  { name: 'high-end-visual-design', aliases: ['soft-skill'], scope: '高端视觉表达参考，需适配场景' },
  { name: 'gpt-taste', aliases: ['gpt-tasteskill'], scope: '特定营销页面与动效方向，需核对约束' },
  { name: 'image-to-code', aliases: ['image-to-code-skill'], scope: '视觉参考与代码还原' },
  { name: 'imagegen-frontend-web', aliases: ['imagegen-frontend-web'], scope: '网站设计图像参考' },
  { name: 'imagegen-frontend-mobile', aliases: ['imagegen-frontend-mobile'], scope: '移动端设计图像参考' },
  { name: 'framer-motion', aliases: ['framer-motion'], scope: 'React 动效实现与可访问性' }
];
// One vocabulary keeps the designer's discoverable skills consistent with
// visual-plan and source-manifest validation. Availability is checked at load.
export const supportedVisualSkillNames = new Set(['taste-skill', 'shadcn-ui-reference', ...optionalVisualSkills.map(item => item.name)]);
export function availableVisualSkills(home = codexHome) {
  return optionalVisualSkills.flatMap(item => {
    const file = item.aliases.map(name => path.join(home, 'skills', name, 'SKILL.md')).find(candidate => fs.existsSync(candidate));
    if (!file) return [];
    try { const content = fs.readFileSync(file, 'utf8'); return content.trim() ? [{ name: item.name, scope: item.scope, path: file, sha256: digest(content) }] : []; } catch { return []; }
  });
}
export function loadVisualSkill(name, expectedSha256, home = codexHome) {
  const binding = availableVisualSkills(home).find(item => item.name === name);
  if (!binding || binding.sha256 !== expectedSha256) throw new Error(`optional visual skill is missing or changed: ${name}`);
  const content = fs.readFileSync(binding.path, 'utf8');
  if (digest(content) !== expectedSha256) throw new Error(`optional visual skill changed while being loaded: ${name}`);
  return { ...binding, content };
}

export function availableStitchSkills(home = codexHome) {
  const file = path.join(home, 'skills', 'stitch-skill', 'SKILL.md');
  try {
    const content = fs.readFileSync(file, 'utf8');
    return content.trim() ? [{ name: 'stitch-design-taste', path: file, sha256: digest(content), scope: '仅提取适用于已确认 Demo 的 Stitch 表达，不改变其设计和交互' }] : [];
  } catch { return []; }
}
export function loadStitchSkill(name, expectedSha256, home = codexHome) {
  const binding = availableStitchSkills(home).find(item => item.name === name);
  if (!binding || binding.sha256 !== expectedSha256) throw new Error(`optional Stitch skill is missing or changed: ${name}`);
  const content = fs.readFileSync(binding.path, 'utf8');
  if (digest(content) !== expectedSha256) throw new Error(`optional Stitch skill changed while being loaded: ${name}`);
  return { ...binding, content };
}

export function availableAgentSkills(stage, roleId, home = codexHome) {
  if (stage === 'visual' && roleId === 'ui-designer') return availableVisualSkills(home);
  const names = stage === 'gate1' && roleId === 'product-manager' ? [{ name: 'research-intake', scope: '仅在需要研究或时效核验时选择来源和路径' }]
    : stage === 'implementation' && ['frontend-engineer', 'frontend-implementation-planner'].includes(roleId) ? [
      { name: 'ponytail', scope: '复用现有实现并完成必要工程验证' },
      { name: 'react', scope: '仅在 React 技术栈中处理组件、状态与渲染' },
      { name: 'tailwind', scope: '仅在项目使用 Tailwind 时核对主题和样式实现' },
      { name: 'heroui', scope: '仅在适用的 React 项目中核对 HeroUI 组件和主题' },
      { name: 'radix', scope: '按需处理 Radix 组件、交互与无障碍' },
      { name: 'storybook', scope: '按需核对组件文档与交互状态' },
      { name: 'framer-motion', scope: '仅在适用技术栈中实现并验证动效' },
      { name: 'andrej-karpathy-skills', scope: '按需约束工程实现与验证' }
    ] : [];
  return names.flatMap(item => {
    const file = path.join(home, 'skills', item.name, 'SKILL.md');
    try { const content = fs.readFileSync(file, 'utf8'); return content.trim() ? [{ ...item, path: file, sha256: digest(content) }] : []; } catch { return []; }
  });
}
export function loadAgentSkill(stage, roleId, name, expectedSha256, home = codexHome) {
  const binding = availableAgentSkills(stage, roleId, home).find(item => item.name === name);
  if (!binding || binding.sha256 !== expectedSha256) throw new Error(`optional agent skill is missing or changed: ${name}`);
  const content = fs.readFileSync(binding.path, 'utf8');
  if (digest(content) !== expectedSha256) throw new Error(`optional agent skill changed while being loaded: ${name}`);
  return { ...binding, content };
}
