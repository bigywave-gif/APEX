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
  'reconcile-run-integrity': node('recover', ['run-ledger.sqlite', 'state.json'], actionScript('apex-recover.mjs'), { inputPolicy: 'current-run-ledger-projection-and-operation-receipts-only', completion: 'reconciliation reports consistent; otherwise retain the typed repair-required receipt', failurePolicy: 'never resume a downstream gate while reconciliation remains repair-required', retry: 'repair the reported durable artifact, lineage, or Agent-job inconsistency before requesting another Router status' }),
  'capture-project-inventory': node('collect_existing_baseline', ['project-inventory.json'], actionScript('project-intake.mjs')),
  'expand-project-inventory': node('collect_existing_baseline', ['project-inventory.json'], actionScript('project-intake.mjs')),
  'freeze-code-reference': node('collect_existing_baseline', ['code-reference.json', 'page-skeleton.json'], actionScript('existing-code-reference.mjs')),
  'capture-existing-browser-baseline': node('collect_existing_baseline', ['evidence/existing-browser-capture.json'], actionScript('browser-capture.mjs')),
  'freeze-existing-baseline': node('collect_existing_baseline', ['existing-baseline.json'], actionScript('baseline-collector.mjs')),
  'freeze-change-scope': node('record_context', ['change-scope.json'], actionScript('contract-recorder.mjs')),
  'compile-functional-freeze': node('collect_existing_baseline', ['functional-freeze.json'], actionScript('functional-freeze-compiler.mjs')),
  'continue-gate1-analysis': node('analyze_requirement', [], routerCommand('status')),
  'derive-intent-and-delivery': node('record_context', ['intent-brief.json', 'delivery-contract.json'], actionScript('context-compiler.mjs')),
  'record-domain-model': node('record_context', ['domain-model.json'], actionScript('contract-recorder.mjs')),
  'record-api-contract': node('record_context', ['api-contract.json'], actionScript('contract-recorder.mjs')),
  'evaluate-experience-strategy': node('analyze_requirement', ['experience-strategy.json', 'experience-quality-evidence.json'], actionScript('experience-evaluator.mjs')),
  'compile-gate1-presentation': node('analyze_requirement', ['gate1-presentation.md', 'gate1-presentation-manifest.json'], actionScript('contract-recorder.mjs')),
  'register-gate1-presentation': node('analyze_requirement', ['registrations/gate1-presentation-*.json'], routerCommand('register-gate1-presentation')),
  'repair-gate1-validation': node('analyze_requirement', [], { kind: 'host-controlled-implementation' }, { completion: 'repair the specific failed pre-Gate-1 source through its authorized action and revalidate dependent artifacts', retry: 'do not repeat the same invalid inputs without repair' }),
  'compile-complete-visual-plan': node('plan_visual', ['visual-execution-plan.json', 'visual-plan-presentation.md', 'visual-plan-presentation-manifest.json'], actionScript('visual-execution-plan.mjs')),
  'reopen-incomplete-existing-visual-plan': node('revoke_visual', ['visual-execution-plan.json'], routerCommand('transition revoke-stitch')),
  'restore-approved-visual-plan-after-package-identity-repair': node('repair_visual_source_identity', ['visual-execution-plan.json'], routerCommand('transition repair-visual-source-identity')),
  'compile-demo-source-manifest': node('generate_visual', ['demo-source-manifest.json'], actionScript('demo-source-compiler.mjs')),
  'materialize-run-local-demo-code': node('generate_visual', ['visual-sandbox-files.json'], actionScript('visual-sandbox-writer.mjs')),
  'rebuild-invalid-run-local-demo-source': node('generate_visual', ['demo-source-manifest.json', 'visual-sandbox-files.json'], actionScript('visual-sandbox-writer.mjs')),
  'start-run-local-demo': node('generate_visual', ['visual-sandbox-runtime.json'], actionScript('visual-sandbox-runtime.mjs')),
  'capture-runtime-browser-evidence': node('generate_visual', ['evidence/runtime-browser-capture.json'], actionScript('browser-capture.mjs')),
  'repair-demo-control-coverage': node('generate_visual', ['demo-source-manifest.json', 'visual-sandbox-files.json'], actionScript('demo-source-compiler.mjs')),
  'freeze-runtime-visual-baseline': node('generate_visual', ['runtime-visual-baseline.json', 'runtime-demo.json', 'runtime-source-lock.json'], actionScript('runtime-visual-baseline.mjs')),
  'emit-runtime-visual-reference': node('generate_visual', ['visual-reference.json', 'gate1-visual-output.json'], actionScript('visual-reference-compiler.mjs')),
  'record-selected-runtime-design-candidate': node('generate_visual', ['design-candidates.json'], actionScript('experience-evaluator.mjs')),
  'register-runtime-demo': node('register_runtime_demo', ['registrations/runtime-demo-*.json'], routerCommand('register-runtime-demo')),
  'present-run-local-runtime-demo': node('present_runtime_demo', ['presentations/runtime-demo-*.json'], routerCommand('present-runtime-demo'), { inputPolicy: 'current-run-verified-chat-fragment-or-visual-sandbox-http-fallback', completion: 'the same-source chat content reference is prepared for final output, or the current Run HTTP preview is opened, with a bound presentation receipt' }),
  'create-stitch-candidate': node('sync_stitch', ['stitch-freeze.json'], actionScript('stitch-sync.mjs')),
  'verify-stitch-candidate-parity': node('sync_stitch', ['stitch-parity-evidence.json'], actionScript('strict-replica.mjs')),
  'compile-stitch-screen-reference': node('sync_stitch', ['visual-screen-references.json'], actionScript('visual-reference-compiler.mjs')),
  'verify-stitch-candidate-screen': node('sync_stitch', ['evidence/parity/stitch-result-*.json'], actionScript('strict-replica.mjs')),
  'seal-unchanged-stitch-candidate': node('sync_stitch', ['machine-seals/stitch.json'], actionScript('stitch-sync.mjs')),
  'compile-stitch-confirmation-presentation': node('sync_stitch', ['stitch-presentation.md', 'stitch-presentation-manifest.json'], actionScript('confirmation-presentation.mjs')),
  'publish-complete-stitch-presentation': node('sync_stitch', ['stitch-presentation.md', 'stitch-presentation-manifest.json'], routerCommand('status')),
  'derive-site-contract': node('compile_visual_bundle', ['site-contract.json'], actionScript('contract-recorder.mjs')),
  'freeze-visual-source-manifest': node('compile_visual_bundle', ['visual-source-manifest.json'], actionScript('visual-source.mjs')),
  'resolve-visual-dependencies': node('compile_visual_bundle', ['dependency-lock.json'], actionScript('asset-resolver.mjs')),
  'compile-visual-bundle-and-implementation-map': node('compile_visual_bundle', ['visual-bundle.json', 'implementation-map.json'], actionScript('bundle-compiler.mjs')),
  'compile-implementation-confirmation-presentation': node('compile_visual_bundle', ['implementation-presentation.md', 'implementation-presentation-manifest.json'], actionScript('confirmation-presentation.mjs')),
  'publish-complete-implementation-freeze': node('compile_visual_bundle', ['implementation-presentation.md', 'implementation-presentation-manifest.json'], routerCommand('status')),
  'run-pre-gate2-and-open-implementation': node('open_gate2', ['Gate 2 machine validation'], routerCommand('transition open-gate2')),
  'emit-formal-runtime-source-markers': node('implement', ['evidence/implementation-audit.json'], { kind: 'host-controlled-implementation' }),
  'apply-approved-formal-implementation': node('implement', ['page-delta.json'], { kind: 'host-controlled-implementation' }),
  'restore-product-plan-evidence': node('verify', ['experience-strategy.json'], { kind: 'host-controlled-implementation' }, { completion: 'restore the original confirmed product plan through authorized recovery or return to the appropriate earlier phase', failurePolicy: 'do not fabricate product tasks or repeat browser capture while the plan is unavailable', retry: 'retry only after the product plan evidence has changed or been restored' }),
  'restore-product-plan-before-demo': node('generate_visual', ['experience-strategy.json'], { kind: 'host-controlled-implementation' }, { completion: 'restore the original confirmed product plan through authorized recovery or return to the appropriate earlier phase', failurePolicy: 'do not fabricate product tasks or repeatedly generate a Demo without the plan', retry: 'retry only after the product plan evidence has changed or been restored' }),
  'inspect-pending-stitch-upload': node('sync_stitch', ['run-ledger.sqlite'], { kind: 'host-controlled-implementation' }, { inputPolicy: 'current-run-and-project-external-submission-records', completion: 'inspect the durable upload and preserve uncertain external effects', failurePolicy: 'never repeat an upload or generation while its outcome is unresolved', retry: 'retry only after independently establishing the remote outcome' }),
  'capture-formal-runtime-source-provenance': node('verify', ['evidence/runtime-browser-capture.json'], actionScript('browser-capture.mjs')),
  'capture-formal-resource-evidence': node('verify', ['evidence/runtime-browser-capture.json'], actionScript('browser-capture.mjs')),
  'repair-existing-resource-review': node('verify', ['role-advisory-manifest.json'], { kind: 'host-controlled-implementation' }),
  'compile-formal-screen-reference': node('verify', ['visual-screen-references.json'], actionScript('visual-reference-compiler.mjs')),
  'verify-formal-direct-screen': node('verify', ['evidence/parity/implementation-result-*.json'], actionScript('strict-replica.mjs')),
  'verify-formal-stitch-screen': node('verify', ['evidence/parity/implementation-result-*.json'], actionScript('strict-replica.mjs')),
  'capture-formal-route-coverage': node('verify', ['evidence/runtime-browser-capture.json'], actionScript('browser-capture.mjs')),
  'capture-runtime-state-matrix': node('verify', ['runtime-state-matrix.json'], actionScript('stability-evidence.mjs')),
  'capture-verification-inventory': node('verify', ['verification-inventory.json'], actionScript('project-intake.mjs')),
  'compile-verification-plan': node('verify', ['verification-plan.json'], actionScript('verification-planner.mjs')),
  'verify-required-visual-parity': node('verify', ['implementation-parity-evidence.json'], actionScript('strict-replica.mjs')),
  'compile-visual-quality-evidence': node('verify', ['evidence/visual-verification.json'], actionScript('quality-evidence.mjs')),
  'capture-accessibility-measurement': node('verify', ['evidence/accessibility-measurement.json'], actionScript('quality-measurement.mjs')),
  'capture-performance-measurement': node('verify', ['evidence/performance-measurement.json'], actionScript('quality-measurement.mjs')),
  'compile-accessibility-evidence': node('verify', ['evidence/accessibility-verification.json'], actionScript('quality-evidence.mjs')),
  'compile-performance-evidence': node('verify', ['evidence/performance-verification.json'], actionScript('quality-evidence.mjs')),
  'repair-quality-context': node('verify', [], { kind: 'host-controlled-implementation' }),
  'run-controlled-verification': node('verify', ['verification-bundle.json'], actionScript('verification-orchestrator.mjs')),
  'seal-verification-evidence': node('record_context', ['evidence-provenance.json'], actionScript('evidence-provenance.mjs')),
  'compile-evidence-bound-industry-review': node('verify', ['industry-benchmark-evidence.json'], actionScript('industry-benchmark.mjs')),
  'pass-controlled-proof-gate': node('pass_proof', ['Proof Gate passed evidence'], routerCommand('transition pass-proof')),
  'validate-gate3-delivery-evidence': node('open_gate3', ['Gate 3 delivery evidence'], routerCommand('transition open-gate3'))
});

export function workflowNode(id) {
  if (workflowNodes[id]) return workflowNodes[id];
  // Role work is selected/recorded/summarized dynamically for every stage,
  // but it is still a concrete guarded node rather than host prose.
  const role = String(id).match(/^(baseline|gate1|visual|implementation|verify)-role-(select|record|summarize|repair|rebudget|wait)$/);
  if (role) {
    const action = role[1] === 'baseline' ? 'collect_existing_baseline' : role[1] === 'gate1' ? 'analyze_requirement' : role[1] === 'visual' ? 'plan_visual' : role[1] === 'implementation' ? 'compile_visual_bundle' : 'verify';
    if (role[2] === 'wait') return node(action, [], actionScript('agent-runtime.mjs'), { completion: 'observe the existing job until it ends or its lease is eligible for controlled recovery', stateCommit: 'status is read-only; a finished job or controlled recovery advances the ledger', retry: 'poll the same live job without starting or cancelling another execution', failurePolicy: 'preserve uncertain execution and lease evidence' });
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
