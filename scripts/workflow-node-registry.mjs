/**
 * The APEX automatic workflow is a state machine, not a collection of status
 * sentences.  Keep the machine-readable contract for every Router step in one
 * place so a new branch cannot accidentally create an unrunnable pause.
 *
 * This registry deliberately describes the boundary owned by the Router.  A
 * node may use several guarded scripts internally, but it must still declare
 * its action, observable outputs and postcondition before it can be returned
 * to a host as `executionDirective.currentStep`.
 */
const node = (action, outputs, executor, options = {}) => ({
  action,
  outputs,
  executor,
  inputPolicy: options.inputPolicy || 'current-run-artifacts-and-authorized-inputs',
  completion: options.completion || 'all-declared-output-artifacts-are-current-and-validated',
  failurePolicy: options.failurePolicy || 'record-a-real-operation-receipt-then-return-a-typed-block',
  stateCommit: options.stateCommit || 'guarded-script-or-router-command-must-commit-state-before-next-step',
  retry: options.retry || 'rebuild-invalid-internal-inputs-before-reporting-a-block'
});

const actionScript = script => ({ kind: 'guarded-apex-action', script });
const routerCommand = command => ({ kind: 'router-command', command });

export const workflowNodes = Object.freeze({
  'capture-project-inventory': node('collect_existing_baseline', ['project-inventory.json'], actionScript('project-intake.mjs')),
  'freeze-code-reference': node('collect_existing_baseline', ['code-reference.json', 'page-skeleton.json'], actionScript('existing-code-reference.mjs')),
  'capture-existing-browser-baseline': node('collect_existing_baseline', ['evidence/existing-browser-capture.json'], actionScript('browser-capture.mjs')),
  'freeze-existing-baseline': node('collect_existing_baseline', ['existing-baseline.json'], actionScript('baseline-collector.mjs')),
  'freeze-change-scope': node('record_context', ['change-scope.json'], actionScript('contract-recorder.mjs')),
  'continue-gate1-analysis': node('analyze_requirement', [], routerCommand('status')),
  'derive-intent-and-delivery': node('record_context', ['intent-brief.json', 'delivery-contract.json'], actionScript('context-compiler.mjs')),
  'record-domain-model': node('record_context', ['domain-model.json'], actionScript('contract-recorder.mjs')),
  'record-api-contract': node('record_context', ['api-contract.json'], actionScript('contract-recorder.mjs')),
  'evaluate-experience-strategy': node('analyze_requirement', ['experience-strategy.json', 'experience-quality-evidence.json'], actionScript('experience-evaluator.mjs')),
  'compile-gate1-presentation': node('analyze_requirement', ['gate1-presentation.md', 'gate1-presentation-manifest.json'], actionScript('contract-recorder.mjs')),
  'register-gate1-presentation': node('analyze_requirement', ['registrations/gate1-presentation-*.json'], routerCommand('register-gate1-presentation')),
  'compile-complete-visual-plan': node('plan_visual', ['visual-execution-plan.json', 'visual-plan-presentation.md', 'visual-plan-presentation-manifest.json'], actionScript('visual-execution-plan.mjs')),
  'reopen-incomplete-existing-visual-plan': node('revoke_visual', ['visual-execution-plan.json'], routerCommand('transition revoke-stitch')),
  'restore-approved-visual-plan-after-package-identity-repair': node('repair_visual_source_identity', ['visual-execution-plan.json'], routerCommand('transition repair-visual-source-identity')),
  'compile-demo-source-manifest': node('generate_visual', ['demo-source-manifest.json'], actionScript('demo-source-compiler.mjs')),
  'materialize-run-local-demo-code': node('generate_visual', ['visual-sandbox-files.json'], actionScript('visual-sandbox-writer.mjs')),
  'rebuild-invalid-run-local-demo-source': node('generate_visual', ['demo-source-manifest.json', 'visual-sandbox-files.json'], actionScript('visual-sandbox-writer.mjs')),
  'start-run-local-demo': node('generate_visual', ['visual-sandbox-runtime.json'], actionScript('visual-sandbox-runtime.mjs')),
  'capture-runtime-browser-evidence': node('generate_visual', ['evidence/runtime-browser-capture.json'], actionScript('browser-capture.mjs')),
  'freeze-runtime-visual-baseline': node('generate_visual', ['runtime-visual-baseline.json', 'runtime-demo.json', 'runtime-source-lock.json'], actionScript('runtime-visual-baseline.mjs')),
  'emit-runtime-visual-reference': node('generate_visual', ['visual-reference.json', 'gate1-visual-output.json'], actionScript('visual-reference-compiler.mjs')),
  'record-selected-runtime-design-candidate': node('generate_visual', ['design-candidates.json'], actionScript('experience-evaluator.mjs')),
  'register-runtime-demo': node('register_runtime_demo', ['registrations/runtime-demo-*.json'], routerCommand('register-runtime-demo')),
  'create-stitch-candidate': node('sync_stitch', ['stitch-freeze.json'], actionScript('stitch-sync.mjs')),
  'verify-stitch-candidate-parity': node('sync_stitch', ['stitch-parity-evidence.json'], actionScript('strict-replica.mjs')),
  'compile-stitch-confirmation-presentation': node('sync_stitch', ['stitch-presentation.md', 'stitch-presentation-manifest.json'], actionScript('confirmation-presentation.mjs')),
  'publish-complete-stitch-presentation': node('sync_stitch', ['stitch-presentation.md', 'stitch-presentation-manifest.json'], routerCommand('status')),
  'derive-site-contract': node('compile_visual_bundle', ['site-contract.json'], actionScript('contract-recorder.mjs')),
  'compile-visual-bundle-and-implementation-map': node('compile_visual_bundle', ['visual-bundle.json', 'implementation-map.json'], actionScript('bundle-compiler.mjs')),
  'compile-implementation-confirmation-presentation': node('compile_visual_bundle', ['implementation-presentation.md', 'implementation-presentation-manifest.json'], actionScript('confirmation-presentation.mjs')),
  'publish-complete-implementation-freeze': node('compile_visual_bundle', ['implementation-presentation.md', 'implementation-presentation-manifest.json'], routerCommand('status')),
  'run-pre-gate2-and-open-implementation': node('open_gate2', ['Gate 2 machine validation'], routerCommand('transition open-gate2')),
  'emit-formal-runtime-source-markers': node('implement', ['evidence/implementation-audit.json'], { kind: 'host-controlled-implementation' }),
  'apply-approved-formal-implementation': node('implement', ['page-delta.json'], { kind: 'host-controlled-implementation' }),
  'capture-formal-runtime-source-provenance': node('verify', ['runtime-state-matrix.json'], actionScript('browser-capture.mjs')),
  'capture-runtime-state-matrix': node('verify', ['runtime-state-matrix.json'], actionScript('browser-capture.mjs')),
  'compile-verification-plan': node('verify', ['verification-plan.json'], actionScript('verification-planner.mjs')),
  'run-controlled-verification': node('verify', ['verification-bundle.json'], actionScript('verification-orchestrator.mjs')),
  'compile-evidence-bound-industry-review': node('verify', ['industry-benchmark-evidence.json'], actionScript('industry-benchmark.mjs')),
  'pass-controlled-proof-gate': node('pass_proof', ['evidence/proof-*.json', 'Proof Gate passed evidence'], routerCommand('transition pass-proof')),
  'validate-gate3-delivery-evidence': node('open_gate3', ['Gate 3 delivery evidence'], routerCommand('transition open-gate3'))
});

export function workflowNode(id) {
  if (workflowNodes[id]) return workflowNodes[id];
  // Role work is selected/recorded/summarized dynamically for every stage,
  // but it is still a concrete guarded node rather than host prose.
  const role = String(id).match(/^(baseline|gate1|visual|implementation|verify)-role-(select|record|summarize|repair)$/);
  if (role) {
    const action = role[1] === 'baseline' ? 'collect_existing_baseline' : role[1] === 'gate1' ? 'analyze_requirement' : role[1] === 'visual' ? 'plan_visual' : role[1] === 'implementation' ? 'compile_visual_bundle' : 'verify';
    return node(action, [`advisories/${role[1]}/role-decision-summary.md`], actionScript('role-advisory.mjs'));
  }
  return null;
}

export function assertWorkflowNode(id, action, outputs) {
  const definition = workflowNode(id);
  if (!definition) throw new Error(`APEX workflow registry has no definition for automatic step: ${id}`);
  if (definition.action !== action) throw new Error(`APEX workflow step ${id} is registered for ${definition.action}, not ${action}`);
  const declared = JSON.stringify(outputs || []), registered = JSON.stringify(definition.outputs || []);
  // The Router can expose additional input files in `produces`, but must not
  // conceal a required contract output from the registry.
  if (!(definition.outputs || []).every(output => (outputs || []).includes(output) || output.startsWith('Gate '))) {
    throw new Error(`APEX workflow step ${id} does not expose all registered outputs: ${registered}; Router declared ${declared}`);
  }
  return definition;
}
