#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTasteSkill, loadTasteSkill, availableAgentSkills, loadAgentSkill, availableVisualSkills, supportedVisualSkillNames, availableStitchSkills, loadStitchSkill } from './required-visual-skill.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-taste-skill-'));
try {
  assert.throws(() => resolveTasteSkill(root), /not installed/);
  const file = path.join(root, 'skills', 'taste-skill', 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Taste\nApply only context-appropriate rules.\n');
  const binding = resolveTasteSkill(root);
  assert.match(loadTasteSkill(binding, root).content, /context-appropriate/);
  fs.writeFileSync(file, '# Changed\n');
  assert.throws(() => loadTasteSkill(binding, root), /changed after role selection/);
  for (const directory of ['redesign-skill', 'minimalist-skill', 'brutalist-skill', 'soft-skill', 'gpt-tasteskill', 'image-to-code-skill', 'imagegen-frontend-web', 'imagegen-frontend-mobile', 'framer-motion']) {
    const file = path.join(root, 'skills', directory, 'SKILL.md'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '# Fixture skill\n');
  }
  const discovered = availableVisualSkills(root);
  for (const name of ['redesign-existing-projects', 'minimalist-ui', 'industrial-brutalist-ui', 'high-end-visual-design', 'gpt-taste', 'image-to-code', 'imagegen-frontend-web', 'imagegen-frontend-mobile', 'framer-motion']) {
    assert.ok(discovered.some(skill => skill.name === name), `${name} must be discoverable`);
    assert.ok(supportedVisualSkillNames.has(name), `${name} must be accepted by the plan and source manifest`);
  }
  for (const name of ['research-intake', 'ponytail', 'react', 'tailwind', 'heroui', 'radix', 'storybook', 'andrej-karpathy-skills']) {
    const skill = path.join(root, 'skills', name, 'SKILL.md'); fs.mkdirSync(path.dirname(skill), { recursive: true }); fs.writeFileSync(skill, `# ${name}\nactual instructions\n`);
  }
  assert.equal(availableStitchSkills(root).length, 0);
  const stitchFile = path.join(root, 'skills', 'stitch-skill', 'SKILL.md'); fs.mkdirSync(path.dirname(stitchFile), { recursive: true }); fs.writeFileSync(stitchFile, '# Stitch adaptation fixture');
  const stitch = availableStitchSkills(root)[0]; assert.equal(stitch.name, 'stitch-design-taste'); assert.match(loadStitchSkill(stitch.name, stitch.sha256, root).content, /Stitch adaptation/);
  fs.writeFileSync(stitchFile, '# Changed'); assert.throws(() => loadStitchSkill(stitch.name, stitch.sha256, root), /missing or changed/);
  const research = availableAgentSkills('gate1', 'product-manager', root).find(item => item.name === 'research-intake');
  const ponytail = availableAgentSkills('implementation', 'frontend-engineer', root).find(item => item.name === 'ponytail');
  assert.match(loadAgentSkill('gate1', 'product-manager', 'research-intake', research.sha256, root).content, /actual instructions/);
  assert.match(loadAgentSkill('implementation', 'frontend-engineer', 'ponytail', ponytail.sha256, root).content, /actual instructions/);
  for (const name of ['react', 'tailwind', 'heroui', 'radix', 'storybook', 'framer-motion', 'andrej-karpathy-skills']) {
    const skill = availableAgentSkills('implementation', 'frontend-engineer', root).find(item => item.name === name);
    assert.ok(skill, `${name} must be discoverable by the frontend role`);
    assert.ok(loadAgentSkill('implementation', 'frontend-engineer', name, skill.sha256, root).content.length);
    assert.throws(() => loadAgentSkill('implementation', 'backend-architect', name, skill.sha256, root), /missing or changed/);
  }
  assert.throws(() => loadAgentSkill('gate1', 'backend-architect', 'research-intake', research.sha256, root), /missing or changed/);
  assert.throws(() => loadAgentSkill('implementation', 'frontend-engineer', 'ponytail', 'sha256:wrong', root), /missing or changed/);
  console.log(JSON.stringify({ status: 'passed', scope: 'skill discovery, role restrictions, content hashes and loading' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
