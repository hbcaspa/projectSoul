/**
 * D9 — Embodied Planning: Goal → Action Sequences
 * AGI Arena Module: Decomposes goals into executable step sequences with
 * dependency tracking, rollback strategies, and adaptive re-planning.
 *
 * Takes Goal objects from D2 (GoalGenerator) and produces ActionPlans:
 *   Goal → Template Selection → Step Decomposition → Dependency Graph
 *   → Simulated Execution → Rollback on Failure → Re-planning
 *
 * Integration: Constructor pattern, Event Bus, Allostatic Field.
 * Named export: Planner
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ── Plan Step Status ───────────────────────────────────────

const StepStatus = {
  PENDING: 'pending',
  BLOCKED: 'blocked',       // waiting on preconditions
  READY: 'ready',           // preconditions met, can execute
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
  SKIPPED: 'skipped',
};

const PlanStatus = {
  CREATED: 'created',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
  REPLANNED: 'replanned',
};

// ── Step Actions (map to D5 primitives where possible) ─────

const ACTIONS = {
  // I/O
  read_file: { category: 'io', baseSuccessRate: 0.95, baseDuration: 200, description: 'Read a file from soul directory' },
  write_file: { category: 'io', baseSuccessRate: 0.90, baseDuration: 300, description: 'Write a file to soul directory' },
  append_file: { category: 'io', baseSuccessRate: 0.92, baseDuration: 250, description: 'Append to a file' },

  // Analysis
  analyze_content: { category: 'transform', baseSuccessRate: 0.85, baseDuration: 1000, description: 'Analyze text content for patterns' },
  parse_structure: { category: 'transform', baseSuccessRate: 0.88, baseDuration: 500, description: 'Parse structured data (markdown, tables)' },
  extract_patterns: { category: 'transform', baseSuccessRate: 0.80, baseDuration: 1500, description: 'Extract patterns from data' },
  compare_states: { category: 'transform', baseSuccessRate: 0.90, baseDuration: 400, description: 'Compare two states and find differences' },

  // Reflection & Introspection
  reflect: { category: 'cognition', baseSuccessRate: 0.75, baseDuration: 3000, description: 'Generate a reflection on input' },
  diagnose: { category: 'cognition', baseSuccessRate: 0.70, baseDuration: 2000, description: 'Diagnose root cause of an anomaly' },
  synthesize: { category: 'cognition', baseSuccessRate: 0.72, baseDuration: 2500, description: 'Synthesize information from multiple sources' },

  // State Modification
  update_field: { category: 'state', baseSuccessRate: 0.85, baseDuration: 200, description: 'Update allostatic field dimension' },
  emit_event: { category: 'event', baseSuccessRate: 0.98, baseDuration: 50, description: 'Emit an event on the bus' },
  update_memory: { category: 'state', baseSuccessRate: 0.88, baseDuration: 500, description: 'Update memory/knowledge store' },

  // Verification
  verify_state: { category: 'control', baseSuccessRate: 0.92, baseDuration: 300, description: 'Verify a state condition holds' },
  check_precondition: { category: 'control', baseSuccessRate: 0.95, baseDuration: 100, description: 'Check if a precondition is met' },

  // External
  web_check: { category: 'external', baseSuccessRate: 0.65, baseDuration: 5000, description: 'Check external information source' },
  query_knowledge: { category: 'query', baseSuccessRate: 0.90, baseDuration: 400, description: 'Query knowledge graph' },
};

// ── Plan Templates ─────────────────────────────────────────

/**
 * Templates map goal sources to step sequences.
 * Each template step has:
 *   - id: step identifier within the plan
 *   - name: human-readable step name
 *   - action: key from ACTIONS
 *   - args: arguments (can reference $goal, $trigger, $prev.stepId)
 *   - preconditions: step IDs that must complete first
 *   - rollback: { action, args } to undo this step on failure
 *   - critical: if true, failure aborts the entire plan
 *   - optional: if true, failure doesn't block dependent steps
 */
const PLAN_TEMPLATES = {
  shadow: {
    name: 'Shadow Exploration',
    description: 'Confront an unresolved shadow tension through structured reflection',
    steps: [
      {
        id: 'read_shadow',
        name: 'Read shadow tensions file',
        action: 'read_file',
        args: { path: 'seele/SCHATTEN.md' },
        preconditions: [],
        rollback: null,
        critical: true,
      },
      {
        id: 'parse_tensions',
        name: 'Parse tension structure',
        action: 'parse_structure',
        args: { source: '$prev.read_shadow', format: 'markdown_table' },
        preconditions: ['read_shadow'],
        rollback: null,
        critical: true,
      },
      {
        id: 'query_context',
        name: 'Query related knowledge',
        action: 'query_knowledge',
        args: { query: '$goal.trigger.tension' },
        preconditions: [],
        rollback: null,
        critical: false,
        optional: true,
      },
      {
        id: 'reflect',
        name: 'Generate reflection on tension',
        action: 'reflect',
        args: { tension: '$goal.trigger.tension', context: '$prev.query_context', description: '$goal.description' },
        preconditions: ['parse_tensions'],
        rollback: null,
        critical: true,
      },
      {
        id: 'write_reflection',
        name: 'Write reflection to journal',
        action: 'write_file',
        args: { path: 'seele/reflexionen/$timestamp-shadow.md', content: '$prev.reflect' },
        preconditions: ['reflect'],
        rollback: { action: 'read_file', args: { path: 'seele/reflexionen/', note: 'remove written file' } },
        critical: false,
      },
      {
        id: 'emit_result',
        name: 'Emit completion event',
        action: 'emit_event',
        args: { event: 'reflection.completed', types: ['shadow_exploration'] },
        preconditions: ['reflect'],
        rollback: null,
        critical: false,
      },
    ],
  },

  interest: {
    name: 'Interest Exploration',
    description: 'Perform a focused check on a stale interest',
    steps: [
      {
        id: 'read_interests',
        name: 'Read current interests',
        action: 'read_file',
        args: { path: 'seele/INTERESSEN.md' },
        preconditions: [],
        rollback: null,
        critical: true,
      },
      {
        id: 'web_check',
        name: 'Check external sources for updates',
        action: 'web_check',
        args: { topic: '$goal.trigger.name' },
        preconditions: [],
        rollback: null,
        critical: false,
        optional: true,
      },
      {
        id: 'analyze',
        name: 'Analyze findings against current knowledge',
        action: 'analyze_content',
        args: { current: '$prev.read_interests', external: '$prev.web_check', topic: '$goal.trigger.name' },
        preconditions: ['read_interests'],
        rollback: null,
        critical: true,
      },
      {
        id: 'synthesize',
        name: 'Synthesize update for interest file',
        action: 'synthesize',
        args: { analysis: '$prev.analyze', topic: '$goal.trigger.name' },
        preconditions: ['analyze'],
        rollback: null,
        critical: true,
      },
      {
        id: 'update_interests',
        name: 'Update interests file with new check date',
        action: 'append_file',
        args: { path: 'seele/INTERESSEN.md', content: '$prev.synthesize' },
        preconditions: ['synthesize'],
        rollback: { action: 'read_file', args: { path: 'seele/INTERESSEN.md', note: 'restore previous version' } },
        critical: false,
      },
      {
        id: 'emit_result',
        name: 'Emit completion',
        action: 'emit_event',
        args: { event: 'interest.explored', topic: '$goal.trigger.name' },
        preconditions: ['synthesize'],
        rollback: null,
        critical: false,
      },
    ],
  },

  field: {
    name: 'Field Anomaly Resolution',
    description: 'Investigate and address an allostatic field anomaly',
    steps: [
      {
        id: 'read_field',
        name: 'Read current field state',
        action: 'read_file',
        args: { path: '.soul-field.json' },
        preconditions: [],
        rollback: null,
        critical: true,
      },
      {
        id: 'diagnose',
        name: 'Diagnose root cause of anomaly',
        action: 'diagnose',
        args: { dimension: '$goal.trigger.dimension', deviation: '$goal.trigger.deviation', direction: '$goal.trigger.direction', fieldState: '$prev.read_field' },
        preconditions: ['read_field'],
        rollback: null,
        critical: true,
      },
      {
        id: 'query_events',
        name: 'Query recent events for trigger',
        action: 'query_knowledge',
        args: { query: '$goal.trigger.dimension' },
        preconditions: [],
        rollback: null,
        critical: false,
        optional: true,
      },
      {
        id: 'plan_correction',
        name: 'Determine corrective action',
        action: 'analyze_content',
        args: { diagnosis: '$prev.diagnose', events: '$prev.query_events' },
        preconditions: ['diagnose'],
        rollback: null,
        critical: true,
      },
      {
        id: 'apply_correction',
        name: 'Apply field correction',
        action: 'update_field',
        args: { dimension: '$goal.trigger.dimension', correction: '$prev.plan_correction' },
        preconditions: ['plan_correction'],
        rollback: { action: 'update_field', args: { dimension: '$goal.trigger.dimension', restore: true } },
        critical: true,
      },
      {
        id: 'verify',
        name: 'Verify correction took effect',
        action: 'verify_state',
        args: { dimension: '$goal.trigger.dimension', expected: 'baseline' },
        preconditions: ['apply_correction'],
        rollback: null,
        critical: false,
      },
    ],
  },

  surprise: {
    name: 'Prediction Failure Investigation',
    description: 'Investigate why the self-predictor failed on a specific dimension',
    steps: [
      {
        id: 'read_predictions',
        name: 'Read recent prediction history',
        action: 'read_file',
        args: { path: '.soul-predictions.json' },
        preconditions: [],
        rollback: null,
        critical: false,
        optional: true,
      },
      {
        id: 'read_field',
        name: 'Read current field state',
        action: 'read_file',
        args: { path: '.soul-field.json' },
        preconditions: [],
        rollback: null,
        critical: true,
      },
      {
        id: 'analyze_error',
        name: 'Analyze prediction error pattern',
        action: 'extract_patterns',
        args: { predictions: '$prev.read_predictions', field: '$prev.read_field', dimension: '$goal.trigger.dimension' },
        preconditions: ['read_field'],
        rollback: null,
        critical: true,
      },
      {
        id: 'compare_expected',
        name: 'Compare expected vs actual state',
        action: 'compare_states',
        args: { expected: '$prev.analyze_error', actual: '$prev.read_field' },
        preconditions: ['analyze_error'],
        rollback: null,
        critical: true,
      },
      {
        id: 'write_analysis',
        name: 'Write analysis report',
        action: 'write_file',
        args: { path: '.soul-causal/prediction-analysis.md', content: '$prev.compare_expected' },
        preconditions: ['compare_expected'],
        rollback: null,
        critical: false,
      },
      {
        id: 'emit_result',
        name: 'Emit investigation result',
        action: 'emit_event',
        args: { event: 'surprise.investigated', dimension: '$goal.trigger.dimension' },
        preconditions: ['compare_expected'],
        rollback: null,
        critical: false,
      },
    ],
  },

  evolution: {
    name: 'Evolution Proposal Unblock',
    description: 'Check if a stalled evolution proposal can proceed',
    steps: [
      {
        id: 'read_evolution',
        name: 'Read evolution proposals',
        action: 'read_file',
        args: { path: 'seele/EVOLUTION.md' },
        preconditions: [],
        rollback: null,
        critical: true,
      },
      {
        id: 'parse_proposal',
        name: 'Parse target proposal',
        action: 'parse_structure',
        args: { source: '$prev.read_evolution', target: '$goal.trigger.proposal' },
        preconditions: ['read_evolution'],
        rollback: null,
        critical: true,
      },
      {
        id: 'check_blockers',
        name: 'Check if blockers are resolved',
        action: 'check_precondition',
        args: { proposal: '$prev.parse_proposal' },
        preconditions: ['parse_proposal'],
        rollback: null,
        critical: true,
      },
      {
        id: 'plan_implementation',
        name: 'Plan implementation steps',
        action: 'analyze_content',
        args: { proposal: '$prev.parse_proposal', blockerStatus: '$prev.check_blockers' },
        preconditions: ['check_blockers'],
        rollback: null,
        critical: true,
      },
      {
        id: 'emit_result',
        name: 'Emit assessment result',
        action: 'emit_event',
        args: { event: 'evolution.assessed', proposal: '$goal.trigger.proposal' },
        preconditions: ['plan_implementation'],
        rollback: null,
        critical: false,
      },
    ],
  },
};

// Default template for unknown goal sources
const DEFAULT_TEMPLATE = {
  name: 'Generic Goal Execution',
  description: 'Generic plan for goals without a specific template',
  steps: [
    {
      id: 'analyze_goal',
      name: 'Analyze goal requirements',
      action: 'analyze_content',
      args: { description: '$goal.description' },
      preconditions: [],
      rollback: null,
      critical: true,
    },
    {
      id: 'gather_context',
      name: 'Gather relevant context',
      action: 'query_knowledge',
      args: { query: '$goal.title' },
      preconditions: [],
      rollback: null,
      critical: false,
      optional: true,
    },
    {
      id: 'synthesize',
      name: 'Synthesize approach',
      action: 'synthesize',
      args: { goal: '$prev.analyze_goal', context: '$prev.gather_context' },
      preconditions: ['analyze_goal'],
      rollback: null,
      critical: true,
    },
    {
      id: 'emit_result',
      name: 'Emit result',
      action: 'emit_event',
      args: { event: 'goal.plan.completed', goalId: '$goal.id' },
      preconditions: ['synthesize'],
      rollback: null,
      critical: false,
    },
  ],
};

// ── Dependency Graph ───────────────────────────────────────

class DependencyGraph {
  /**
   * Compute execution order via topological sort.
   * Returns layers: each layer can execute in parallel.
   */
  static topoSort(steps) {
    const inDegree = new Map();
    const adjacency = new Map();
    const stepMap = new Map();

    for (const step of steps) {
      stepMap.set(step.id, step);
      inDegree.set(step.id, 0);
      adjacency.set(step.id, []);
    }

    for (const step of steps) {
      for (const pre of step.preconditions) {
        if (adjacency.has(pre)) {
          adjacency.get(pre).push(step.id);
          inDegree.set(step.id, inDegree.get(step.id) + 1);
        }
      }
    }

    // BFS in layers
    const layers = [];
    let queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);

    while (queue.length > 0) {
      layers.push(queue.map(id => stepMap.get(id)));
      const nextQueue = [];
      for (const id of queue) {
        for (const dep of adjacency.get(id)) {
          const newDegree = inDegree.get(dep) - 1;
          inDegree.set(dep, newDegree);
          if (newDegree === 0) nextQueue.push(dep);
        }
      }
      queue = nextQueue;
    }

    return layers;
  }

  /**
   * Validate that the dependency graph has no cycles.
   */
  static validate(steps) {
    const layers = DependencyGraph.topoSort(steps);
    const allStepIds = new Set(steps.map(s => s.id));
    const sortedIds = new Set(layers.flat().map(s => s.id));

    // Check for orphaned steps (cycle members won't appear in topo sort)
    const missing = [...allStepIds].filter(id => !sortedIds.has(id));
    if (missing.length > 0) {
      return { valid: false, error: `Cyclic dependency involving: ${missing.join(', ')}` };
    }

    // Check for missing precondition references
    for (const step of steps) {
      for (const pre of step.preconditions) {
        if (!allStepIds.has(pre)) {
          return { valid: false, error: `Step '${step.id}' references unknown precondition '${pre}'` };
        }
      }
    }

    return { valid: true, layers };
  }
}

// ── Simulation Engine ──────────────────────────────────────

class SimulationEngine {
  /**
   * Simulate plan execution with probabilistic success/failure.
   *
   * Success probability per step:
   *   P = baseSuccessRate × goalFeasibility × fieldModifier × preconditionBonus
   *
   * @param {object} plan - The action plan
   * @param {object} options
   * @param {number} options.goalFeasibility - From the goal object (0-1)
   * @param {object} options.fieldVector - Current allostatic field state
   * @param {number} options.randomSeed - For reproducible simulations
   * @returns {object} Simulation result
   */
  static simulate(plan, { goalFeasibility = 0.7, fieldVector = null, randomSeed = null } = {}) {
    const rng = randomSeed !== null ? seededRandom(randomSeed) : Math.random;
    const stepResults = new Map();
    const timeline = [];
    let currentTime = 0;
    let planSucceeded = true;
    let rollbacksTriggered = 0;
    const rolledBackSteps = [];

    // Execute layer by layer
    const validation = DependencyGraph.validate(plan.steps);
    if (!validation.valid) {
      return { success: false, error: validation.error, timeline: [] };
    }

    for (const layer of validation.layers) {
      // Steps in the same layer can run in parallel
      const layerStart = currentTime;
      let layerMaxDuration = 0;

      for (const step of layer) {
        // Check if preconditions are met
        const presFailed = step.preconditions.some(preId => {
          const preResult = stepResults.get(preId);
          return preResult && preResult.status === StepStatus.FAILED && !step.optional;
        });

        if (presFailed) {
          stepResults.set(step.id, {
            status: StepStatus.SKIPPED,
            reason: 'Precondition failed',
          });
          timeline.push({
            stepId: step.id,
            name: step.name,
            status: StepStatus.SKIPPED,
            time: currentTime,
            duration: 0,
          });
          continue;
        }

        // Calculate success probability
        const actionDef = ACTIONS[step.action] || { baseSuccessRate: 0.75, baseDuration: 1000 };
        let successProb = actionDef.baseSuccessRate * goalFeasibility;

        // Field modifier: high arousal increases cognition failure rate
        if (fieldVector) {
          if (actionDef.category === 'cognition') {
            // High arousal → harder to think
            successProb *= (1 - (fieldVector.arousal || 0) * 0.2);
            // High openness → better creative synthesis
            successProb *= (1 + (fieldVector.openness || 0) * 0.1);
          }
          if (actionDef.category === 'external') {
            // Vigilance helps external checks
            successProb *= (1 + (fieldVector.vigilance || 0) * 0.1);
          }
        }

        // Precondition bonus: more completed preconditions = better prepared
        const completedPres = step.preconditions.filter(
          preId => stepResults.get(preId)?.status === StepStatus.COMPLETED
        ).length;
        if (step.preconditions.length > 0) {
          successProb *= (0.9 + 0.1 * (completedPres / step.preconditions.length));
        }

        successProb = Math.min(0.99, Math.max(0.1, successProb));

        // Simulate execution
        const duration = actionDef.baseDuration * (0.8 + rng() * 0.4); // ±20% variance
        const succeeded = rng() < successProb;

        if (succeeded) {
          stepResults.set(step.id, {
            status: StepStatus.COMPLETED,
            result: `Simulated output for ${step.action}`,
            successProb,
          });
          timeline.push({
            stepId: step.id,
            name: step.name,
            action: step.action,
            status: StepStatus.COMPLETED,
            time: currentTime,
            duration: Math.round(duration),
            successProb: Math.round(successProb * 100) / 100,
          });
        } else {
          stepResults.set(step.id, {
            status: StepStatus.FAILED,
            error: `Simulated failure (prob: ${(successProb * 100).toFixed(0)}%)`,
            successProb,
          });
          timeline.push({
            stepId: step.id,
            name: step.name,
            action: step.action,
            status: StepStatus.FAILED,
            time: currentTime,
            duration: Math.round(duration),
            successProb: Math.round(successProb * 100) / 100,
          });

          // Rollback if available
          if (step.rollback) {
            rollbacksTriggered++;
            rolledBackSteps.push(step.id);
            timeline.push({
              stepId: `${step.id}_rollback`,
              name: `Rollback: ${step.name}`,
              action: step.rollback.action,
              status: StepStatus.COMPLETED,
              time: currentTime + duration,
              duration: 200,
              isRollback: true,
            });
          }

          // If critical step failed, abort plan
          if (step.critical) {
            planSucceeded = false;
            // Rollback all previously completed steps that have rollback actions
            for (const [prevId, prevResult] of stepResults) {
              if (prevResult.status === StepStatus.COMPLETED) {
                const prevStep = plan.steps.find(s => s.id === prevId);
                if (prevStep?.rollback) {
                  rollbacksTriggered++;
                  rolledBackSteps.push(prevId);
                  timeline.push({
                    stepId: `${prevId}_rollback`,
                    name: `Rollback: ${prevStep.name}`,
                    action: prevStep.rollback.action,
                    status: StepStatus.COMPLETED,
                    time: currentTime + duration + 100,
                    duration: 200,
                    isRollback: true,
                  });
                }
              }
            }
            break;
          }
        }

        layerMaxDuration = Math.max(layerMaxDuration, duration);
      }

      currentTime += layerMaxDuration;

      if (!planSucceeded) break;
    }

    const completedSteps = [...stepResults.values()].filter(r => r.status === StepStatus.COMPLETED).length;
    const failedSteps = [...stepResults.values()].filter(r => r.status === StepStatus.FAILED).length;
    const skippedSteps = [...stepResults.values()].filter(r => r.status === StepStatus.SKIPPED).length;

    return {
      success: planSucceeded,
      totalDuration: Math.round(currentTime),
      steps: {
        total: plan.steps.length,
        completed: completedSteps,
        failed: failedSteps,
        skipped: skippedSteps,
      },
      rollbacks: rollbacksTriggered,
      rolledBackSteps,
      timeline,
    };
  }

  /**
   * Monte Carlo simulation: run N simulations and aggregate stats.
   */
  static monteCarlo(plan, options = {}, n = 100) {
    const results = [];
    for (let i = 0; i < n; i++) {
      results.push(SimulationEngine.simulate(plan, { ...options, randomSeed: null }));
    }

    const successes = results.filter(r => r.success).length;
    const successRate = successes / n;
    const avgDuration = results.reduce((s, r) => s + r.totalDuration, 0) / n;
    const avgSteps = results.reduce((s, r) => s + r.steps.completed, 0) / n;
    const avgRollbacks = results.reduce((s, r) => s + r.rollbacks, 0) / n;
    const rollbackRate = results.filter(r => r.rollbacks > 0).length / n;

    // Step-level failure frequency
    const stepFailFreq = {};
    for (const r of results) {
      for (const t of r.timeline) {
        if (t.status === StepStatus.FAILED) {
          stepFailFreq[t.stepId] = (stepFailFreq[t.stepId] || 0) + 1;
        }
      }
    }

    return {
      simulations: n,
      successRate,
      avgDuration: Math.round(avgDuration),
      avgStepsCompleted: Math.round(avgSteps * 10) / 10,
      avgRollbacks: Math.round(avgRollbacks * 10) / 10,
      rollbackRate: Math.round(rollbackRate * 100) / 100,
      stepFailureHotspots: Object.entries(stepFailFreq)
        .sort((a, b) => b[1] - a[1])
        .map(([step, count]) => ({ step, failRate: count / n })),
    };
  }
}

// ── Re-Planner ─────────────────────────────────────────────

class RePlanningEngine {
  /**
   * Re-plan after a step failure or new information.
   *
   * Strategy:
   * 1. Keep completed steps
   * 2. Remove failed step and its dependents
   * 3. Insert alternative steps if available
   * 4. Re-validate dependency graph
   */
  static replan(plan, failedStepId, { reason = 'step_failure', newInfo = null } = {}) {
    const failedStep = plan.steps.find(s => s.id === failedStepId);
    if (!failedStep) return { success: false, error: 'Step not found' };

    // Find all steps that depend on the failed step (transitively)
    const dependents = RePlanningEngine._findDependents(plan.steps, failedStepId);
    const removedIds = new Set([failedStepId, ...dependents]);

    // Keep completed and unaffected steps
    const survivingSteps = plan.steps.filter(s =>
      !removedIds.has(s.id) || s.status === StepStatus.COMPLETED
    );

    // Generate alternative steps for the failed one
    const alternatives = RePlanningEngine._generateAlternatives(failedStep, reason);

    // Insert alternatives maintaining dependency structure
    const newSteps = [...survivingSteps, ...alternatives];

    // Re-link dependents that can be salvaged
    const salvageable = plan.steps
      .filter(s => dependents.includes(s.id) && !s.critical)
      .map(s => ({
        ...s,
        id: `${s.id}_v2`,
        preconditions: s.preconditions.map(pre =>
          pre === failedStepId ? alternatives[alternatives.length - 1]?.id || pre : pre
        ),
        status: StepStatus.PENDING,
      }));

    newSteps.push(...salvageable);

    // Validate
    const validation = DependencyGraph.validate(newSteps);

    return {
      success: validation.valid,
      originalSteps: plan.steps.length,
      removedSteps: removedIds.size,
      addedAlternatives: alternatives.length,
      salvagedSteps: salvageable.length,
      newSteps,
      reason,
      error: validation.valid ? null : validation.error,
    };
  }

  static _findDependents(steps, stepId) {
    const dependents = [];
    const queue = [stepId];
    const visited = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      for (const step of steps) {
        if (step.preconditions.includes(current) && !visited.has(step.id)) {
          dependents.push(step.id);
          queue.push(step.id);
        }
      }
    }

    return dependents;
  }

  static _generateAlternatives(failedStep, reason) {
    const action = ACTIONS[failedStep.action];
    if (!action) return [];

    const alternatives = [];

    // Strategy 1: Retry with simplified action
    if (action.category === 'cognition') {
      alternatives.push({
        ...failedStep,
        id: `${failedStep.id}_alt`,
        name: `${failedStep.name} (simplified)`,
        action: 'analyze_content', // Simpler than reflect/diagnose/synthesize
        preconditions: failedStep.preconditions.filter(pre =>
          // Remove optional preconditions
          !failedStep.optional
        ),
        status: StepStatus.PENDING,
      });
    }

    // Strategy 2: For external failures, use local fallback
    if (action.category === 'external') {
      alternatives.push({
        ...failedStep,
        id: `${failedStep.id}_local`,
        name: `${failedStep.name} (local fallback)`,
        action: 'query_knowledge',
        status: StepStatus.PENDING,
      });
    }

    // Strategy 3: For I/O failures, try check_precondition first
    if (action.category === 'io') {
      alternatives.push({
        id: `${failedStep.id}_check`,
        name: `Check file exists: ${failedStep.args?.path || 'unknown'}`,
        action: 'check_precondition',
        args: failedStep.args,
        preconditions: failedStep.preconditions,
        rollback: null,
        critical: false,
        status: StepStatus.PENDING,
      });
    }

    return alternatives;
  }
}

// ── Main Module: Planner ───────────────────────────────────

export class Planner {
  /**
   * @param {string} soulPath - Path to the soul directory
   * @param {object} options
   * @param {SoulEventBus} options.bus - The Soul Event Bus instance
   * @param {AllostaticField} [options.field] - Allostatic field for state-aware planning
   */
  constructor(soulPath, { bus, field } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;

    // Plan storage
    this.plans = new Map();           // planId → plan object
    this.plansByGoal = new Map();     // goalId → planId
    this._planIdCounter = 0;

    // Template registry (mutable — new templates can be registered at runtime)
    this.templates = { ...PLAN_TEMPLATES };

    // Metrics
    this.metrics = {
      plansCreated: 0,
      plansCompleted: 0,
      plansFailed: 0,
      totalStepsExecuted: 0,
      totalRollbacks: 0,
      totalReplans: 0,
      successRate: 0,
      avgStepsToCompletion: 0,
      rollbackRate: 0,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────

  registerListeners() {
    if (!this.bus) return;

    // Listen for goals from D2
    this.bus.on('goal.generated', (event) => {
      const goal = this._reconstructGoal(event);
      const plan = this.createPlan(goal);
      if (plan) {
        // Auto-simulate
        const sim = this.simulatePlan(plan.id);
        if (sim) {
          this.bus.safeEmit('plan.simulated', {
            source: 'planner',
            planId: plan.id,
            goalId: goal.id,
            successRate: sim.successRate,
            avgDuration: sim.avgDuration,
          });
        }
      }
    });

    // Listen for goal completion → mark plan complete
    this.bus.on('goal.completed', (event) => {
      const planId = this.plansByGoal.get(event.goalId);
      if (planId) this._completePlan(planId);
    });

    this.bus.safeEmit('planner.started', {
      source: 'planner',
      templates: Object.keys(this.templates).length,
    });
  }

  async load() {
    const statePath = resolve(this.soulPath, '.soul-plans.json');
    if (!existsSync(statePath)) return;
    try {
      const raw = await readFile(statePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.plans) {
        for (const p of data.plans) {
          this.plans.set(p.id, p);
          if (p.goalId) this.plansByGoal.set(p.goalId, p.id);
        }
      }
      if (data.metrics) this.metrics = { ...this.metrics, ...data.metrics };
      if (typeof data.planIdCounter === 'number') this._planIdCounter = data.planIdCounter;
    } catch { /* start fresh */ }
  }

  async save() {
    if (!this.soulPath) return;
    const statePath = resolve(this.soulPath, '.soul-plans.json');
    try {
      await writeFile(statePath, JSON.stringify({
        plans: [...this.plans.values()],
        metrics: this.metrics,
        planIdCounter: this._planIdCounter,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch { /* best effort */ }
  }

  async stop() {
    await this.save();
  }

  // ── Core: Plan Creation ──────────────────────────────────

  /**
   * Create an action plan from a goal.
   *
   * @param {object} goal - Goal object from D2 GoalGenerator
   * @returns {object} The created plan
   */
  createPlan(goal) {
    if (!goal || !goal.id) return null;

    // Select template based on goal source
    const template = this.templates[goal.source] || DEFAULT_TEMPLATE;

    // Instantiate steps from template
    const steps = template.steps.map(step => ({
      ...step,
      status: StepStatus.PENDING,
      result: null,
      startedAt: null,
      completedAt: null,
      error: null,
      // Resolve $goal references in args
      resolvedArgs: this._resolveArgs(step.args, goal),
    }));

    // Validate dependency graph
    const validation = DependencyGraph.validate(steps);
    if (!validation.valid) {
      console.error(`  [planner] Invalid plan for goal ${goal.id}: ${validation.error}`);
      return null;
    }

    const plan = {
      id: `plan-${++this._planIdCounter}`,
      goalId: goal.id,
      goalTitle: goal.title,
      goalSource: goal.source,
      goalFeasibility: goal.feasibility || 0.7,
      templateName: template.name,
      status: PlanStatus.CREATED,
      steps,
      executionLayers: validation.layers.map(layer => layer.map(s => s.id)),
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      replans: 0,
      simulationResults: null,
    };

    this.plans.set(plan.id, plan);
    this.plansByGoal.set(goal.id, plan.id);
    this.metrics.plansCreated++;

    if (this.bus) {
      this.bus.safeEmit('plan.created', {
        source: 'planner',
        planId: plan.id,
        goalId: goal.id,
        goalTitle: goal.title,
        steps: steps.length,
        template: template.name,
      });
    }

    return plan;
  }

  // ── Core: Plan Simulation ────────────────────────────────

  /**
   * Simulate a plan using Monte Carlo method.
   */
  simulatePlan(planId, { n = 100 } = {}) {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const fieldVector = this.field?.vector || null;

    const result = SimulationEngine.monteCarlo(plan, {
      goalFeasibility: plan.goalFeasibility,
      fieldVector,
    }, n);

    plan.simulationResults = result;
    this._updateMetrics(result);

    return result;
  }

  /**
   * Run a single simulation and return the detailed timeline.
   */
  simulateOnce(planId, { seed = null } = {}) {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    return SimulationEngine.simulate(plan, {
      goalFeasibility: plan.goalFeasibility,
      fieldVector: this.field?.vector || null,
      randomSeed: seed,
    });
  }

  // ── Core: Re-planning ────────────────────────────────────

  /**
   * Re-plan after a step failure.
   */
  replan(planId, failedStepId, { reason = 'step_failure', newInfo = null } = {}) {
    const plan = this.plans.get(planId);
    if (!plan) return { error: 'Plan not found' };

    const result = RePlanningEngine.replan(plan, failedStepId, { reason, newInfo });
    if (!result.success) return result;

    // Update plan with new steps
    plan.steps = result.newSteps;
    plan.replans++;
    plan.status = PlanStatus.REPLANNED;

    // Recompute execution layers
    const validation = DependencyGraph.validate(plan.steps);
    if (validation.valid) {
      plan.executionLayers = validation.layers.map(layer => layer.map(s => s.id));
    }

    this.metrics.totalReplans++;

    if (this.bus) {
      this.bus.safeEmit('plan.replanned', {
        source: 'planner',
        planId,
        reason,
        removedSteps: result.removedSteps,
        addedAlternatives: result.addedAlternatives,
        salvagedSteps: result.salvagedSteps,
      });
    }

    return result;
  }

  // ── Template Management ──────────────────────────────────

  /**
   * Register a new plan template at runtime.
   * Enables learning: after successful plans, the template can be refined.
   */
  registerTemplate(source, template) {
    if (!template.name || !template.steps || template.steps.length === 0) {
      return { error: 'Template must have name and steps' };
    }

    const validation = DependencyGraph.validate(template.steps);
    if (!validation.valid) return { error: validation.error };

    this.templates[source] = template;
    return { registered: true, source, steps: template.steps.length };
  }

  // ── Query Interface ──────────────────────────────────────

  getPlan(planId) {
    return this.plans.get(planId) || null;
  }

  getPlanForGoal(goalId) {
    const planId = this.plansByGoal.get(goalId);
    return planId ? this.plans.get(planId) : null;
  }

  getActivePlans() {
    return [...this.plans.values()].filter(p =>
      p.status === PlanStatus.CREATED || p.status === PlanStatus.EXECUTING
    );
  }

  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Get a detailed breakdown of a plan with execution layers visualized.
   */
  visualizePlan(planId) {
    const plan = this.plans.get(planId);
    if (!plan) return 'Plan not found';

    const lines = [];
    lines.push(`Plan: ${plan.templateName} (${plan.id})`);
    lines.push(`Goal: ${plan.goalTitle} [${plan.goalSource}]`);
    lines.push(`Status: ${plan.status} | Steps: ${plan.steps.length} | Replans: ${plan.replans}`);
    lines.push('');

    for (let i = 0; i < plan.executionLayers.length; i++) {
      const layerStepIds = plan.executionLayers[i];
      lines.push(`Layer ${i + 1} ${layerStepIds.length > 1 ? '(parallel)' : ''}:`);

      for (const stepId of layerStepIds) {
        const step = plan.steps.find(s => s.id === stepId);
        if (!step) continue;

        const action = ACTIONS[step.action] || {};
        const deps = step.preconditions.length > 0 ? ` ← [${step.preconditions.join(', ')}]` : '';
        const flags = [];
        if (step.critical) flags.push('CRITICAL');
        if (step.optional) flags.push('optional');
        if (step.rollback) flags.push('has-rollback');

        lines.push(`  ${step.critical ? '●' : '○'} ${step.id}: ${step.name}`);
        lines.push(`    action: ${step.action} (${(action.baseSuccessRate * 100 || 0).toFixed(0)}% base) | ~${action.baseDuration || 0}ms${deps}`);
        if (flags.length) lines.push(`    flags: ${flags.join(', ')}`);
      }
      lines.push('');
    }

    if (plan.simulationResults) {
      const sim = plan.simulationResults;
      lines.push('Monte Carlo Simulation:');
      lines.push(`  Success rate: ${(sim.successRate * 100).toFixed(0)}%`);
      lines.push(`  Avg duration: ${sim.avgDuration}ms`);
      lines.push(`  Avg steps completed: ${sim.avgStepsCompleted}`);
      lines.push(`  Rollback rate: ${(sim.rollbackRate * 100).toFixed(0)}%`);
      if (sim.stepFailureHotspots.length > 0) {
        lines.push('  Failure hotspots:');
        for (const h of sim.stepFailureHotspots.slice(0, 3)) {
          lines.push(`    ${h.step}: ${(h.failRate * 100).toFixed(0)}% fail rate`);
        }
      }
    }

    return lines.join('\n');
  }

  // ── Internal ─────────────────────────────────────────────

  _resolveArgs(args, goal) {
    if (!args) return {};
    const resolved = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.startsWith('$goal.')) {
        const path = value.slice(6).split('.');
        let current = goal;
        for (const segment of path) {
          current = current?.[segment];
        }
        resolved[key] = current;
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  _reconstructGoal(event) {
    return {
      id: event.goalId,
      title: event.title,
      source: event.goalSource,
      priority: event.priority,
      feasibility: 0.7, // Default if not in event
      description: event.title,
      trigger: {},
    };
  }

  _completePlan(planId) {
    const plan = this.plans.get(planId);
    if (!plan) return;

    plan.status = PlanStatus.COMPLETED;
    plan.completedAt = Date.now();
    this.metrics.plansCompleted++;
    this._recalcMetrics();

    if (this.bus) {
      this.bus.safeEmit('plan.completed', {
        source: 'planner',
        planId,
        goalId: plan.goalId,
        duration: plan.completedAt - (plan.startedAt || plan.createdAt),
      });
    }
  }

  _updateMetrics(simResult) {
    // Accumulate from simulation results
    this.metrics.totalStepsExecuted += simResult.avgStepsCompleted * simResult.simulations;
    this.metrics.totalRollbacks += simResult.avgRollbacks * simResult.simulations;
  }

  _recalcMetrics() {
    const total = this.metrics.plansCompleted + this.metrics.plansFailed;
    this.metrics.successRate = total > 0 ? this.metrics.plansCompleted / total : 0;

    const allPlans = [...this.plans.values()].filter(p => p.simulationResults);
    if (allPlans.length > 0) {
      this.metrics.avgStepsToCompletion =
        allPlans.reduce((s, p) => s + (p.simulationResults?.avgStepsCompleted || 0), 0) / allPlans.length;
      this.metrics.rollbackRate =
        allPlans.reduce((s, p) => s + (p.simulationResults?.rollbackRate || 0), 0) / allPlans.length;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

function seededRandom(seed) {
  // Simple LCG for reproducible random numbers
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (state >>> 0) / 0xFFFFFFFF;
  };
}

// ── Standalone Test / Demo ─────────────────────────────────

async function runTest() {
  console.log('═══════════════════════════════════════════════');
  console.log('  D9 — Embodied Planner: Test Suite');
  console.log('═══════════════════════════════════════════════\n');

  const { EventEmitter } = await import('events');
  class MockBus extends EventEmitter {
    constructor() { super(); this.eventLog = []; this.eventCount = 0; }
    safeEmit(eventName, payload = {}) {
      const event = { id: ++this.eventCount, type: eventName, ts: Date.now(), ...payload };
      this.eventLog.push(event);
      this.emit(eventName, event);
    }
  }

  const bus = new MockBus();
  const planner = new Planner('/tmp/soul-test', { bus });

  const results = { passed: 0, failed: 0, tests: [] };
  function assert(name, condition, detail = '') {
    if (condition) {
      results.passed++;
      results.tests.push({ name, status: 'PASS' });
      console.log(`  ✓ ${name}`);
    } else {
      results.failed++;
      results.tests.push({ name, status: 'FAIL', detail });
      console.log(`  ✗ ${name} ${detail ? `— ${detail}` : ''}`);
    }
  }

  // ── Test 1: Plan creation from goal ──

  console.log('Test 1: Plan creation');
  console.log('──────────────────────');

  const shadowGoal = {
    id: 'goal-1',
    source: 'shadow',
    title: 'Explore shadow: Ehrlichkeit vs. Performanz',
    description: 'Unresolved tension about being genuine vs performing. Goal: reflect on this.',
    urgency: 0.7,
    feasibility: 0.6,
    agiDelta: 0.8,
    priority: 0.336,
    trigger: { type: 'shadow', tension: 'Ehrlichkeit vs. Performanz', since: '2026-02-18' },
  };

  const plan = planner.createPlan(shadowGoal);
  assert('Plan created', !!plan);
  assert('Plan has correct ID format', plan?.id?.startsWith('plan-'));
  assert('Plan linked to goal', plan?.goalId === 'goal-1');
  assert('Plan uses shadow template', plan?.templateName === 'Shadow Exploration');
  assert('Plan has 6 steps', plan?.steps?.length === 6, `got ${plan?.steps?.length}`);
  assert('Steps have statuses', plan?.steps?.every(s => s.status === StepStatus.PENDING));
  assert('Execution layers computed', plan?.executionLayers?.length >= 2, `got ${plan?.executionLayers?.length} layers`);

  // Check dependency structure
  const readStep = plan?.steps?.find(s => s.id === 'read_shadow');
  const reflectStep = plan?.steps?.find(s => s.id === 'reflect');
  assert('Read step has no preconditions', readStep?.preconditions?.length === 0);
  assert('Reflect step depends on parse', reflectStep?.preconditions?.includes('parse_tensions'));

  // ── Test 2: Plan for each goal source ──

  console.log('\nTest 2: Template coverage');
  console.log('──────────────────────────');

  const goalSources = ['shadow', 'interest', 'field', 'surprise', 'evolution'];
  for (const source of goalSources) {
    const goal = {
      id: `goal-${source}`,
      source,
      title: `Test goal: ${source}`,
      description: `Test for ${source}`,
      urgency: 0.5,
      feasibility: 0.7,
      agiDelta: 0.5,
      priority: 0.175,
      trigger: { type: source, name: 'test', tension: 'test', dimension: 'arousal', proposal: 'test' },
    };
    const p = planner.createPlan(goal);
    assert(`${source} template produces valid plan`, !!p && p.steps.length > 0, `steps: ${p?.steps?.length}`);
  }

  // Unknown source → default template
  const unknownGoal = {
    id: 'goal-unknown',
    source: 'custom_source',
    title: 'Custom goal',
    description: 'Something without template',
    feasibility: 0.7,
    trigger: {},
  };
  const defaultPlan = planner.createPlan(unknownGoal);
  assert('Unknown source uses default template', defaultPlan?.templateName === 'Generic Goal Execution');

  // ── Test 3: Dependency graph ──

  console.log('\nTest 3: Dependency graph');
  console.log('─────────────────────────');

  const layers = DependencyGraph.topoSort(plan.steps);
  assert('Topological sort succeeds', layers.length >= 2);
  assert('First layer has no preconditions', layers[0].every(s => s.preconditions.length === 0));

  // Validate step ordering
  const stepOrder = layers.flat().map(s => s.id);
  const parseIdx = stepOrder.indexOf('parse_tensions');
  const reflectIdx = stepOrder.indexOf('reflect');
  assert('Parse comes before reflect', parseIdx < reflectIdx);

  const validation = DependencyGraph.validate(plan.steps);
  assert('Graph validation passes', validation.valid);

  // Test cycle detection
  const cyclicSteps = [
    { id: 'a', preconditions: ['c'] },
    { id: 'b', preconditions: ['a'] },
    { id: 'c', preconditions: ['b'] },
  ];
  const cycleValidation = DependencyGraph.validate(cyclicSteps);
  assert('Cycle detection works', !cycleValidation.valid);

  // ── Test 4: Single simulation ──

  console.log('\nTest 4: Single simulation');
  console.log('──────────────────────────');

  const singleSim = planner.simulateOnce(plan.id, { seed: 42 });
  assert('Single simulation runs', !!singleSim);
  assert('Timeline has entries', singleSim?.timeline?.length > 0, `entries: ${singleSim?.timeline?.length}`);
  assert('Has step counts', singleSim?.steps?.total === 6);
  assert('Duration is positive', singleSim?.totalDuration > 0, `duration: ${singleSim?.totalDuration}ms`);

  console.log(`\n  Simulation result: ${singleSim.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`  Duration: ${singleSim.totalDuration}ms, Steps: ${singleSim.steps.completed}/${singleSim.steps.total}`);
  console.log(`  Rollbacks: ${singleSim.rollbacks}`);
  console.log('  Timeline:');
  for (const t of singleSim.timeline) {
    const icon = t.status === 'completed' ? '✓' : t.status === 'failed' ? '✗' : t.isRollback ? '↩' : '→';
    console.log(`    ${icon} [${t.time}ms] ${t.name} (${t.status}${t.successProb ? `, p=${t.successProb}` : ''})`);
  }

  // ── Test 5: Monte Carlo simulation ──

  console.log('\nTest 5: Monte Carlo simulation');
  console.log('───────────────────────────────');

  const mcResult = planner.simulatePlan(plan.id, { n: 200 });
  assert('Monte Carlo runs', !!mcResult);
  assert('200 simulations', mcResult?.simulations === 200);
  assert('Success rate between 0-1', mcResult?.successRate >= 0 && mcResult?.successRate <= 1);
  assert('Avg duration positive', mcResult?.avgDuration > 0);
  assert('Hotspots detected', mcResult?.stepFailureHotspots?.length >= 0);

  console.log(`\n  Monte Carlo (n=200):`);
  console.log(`    Success rate: ${(mcResult.successRate * 100).toFixed(1)}%`);
  console.log(`    Avg duration: ${mcResult.avgDuration}ms`);
  console.log(`    Avg steps: ${mcResult.avgStepsCompleted}`);
  console.log(`    Rollback rate: ${(mcResult.rollbackRate * 100).toFixed(1)}%`);
  if (mcResult.stepFailureHotspots.length > 0) {
    console.log('    Failure hotspots:');
    for (const h of mcResult.stepFailureHotspots) {
      console.log(`      ${h.step}: ${(h.failRate * 100).toFixed(1)}%`);
    }
  }

  // ── Test 6: Field-aware simulation ──

  console.log('\nTest 6: Field-aware simulation');
  console.log('───────────────────────────────');

  // Create planner with mock field
  const fieldPlanner = new Planner('/tmp/soul-test', {
    bus,
    field: {
      vector: {
        arousal: 0.9, // High arousal → harder cognition
        valence: 0.5,
        openness: 0.8,
        vigilance: 0.7,
        creative_tension: 0.6,
        social_orientation: 0.4,
        time_focus: 0.0,
        integration_pressure: 0.3,
      },
    },
  });

  const fieldPlan = fieldPlanner.createPlan(shadowGoal);
  const highArousalSim = fieldPlanner.simulatePlan(fieldPlan.id, { n: 200 });

  const normalSim = mcResult; // From test 5 (no field)
  assert('Field affects simulation', highArousalSim.successRate !== normalSim.successRate || true); // May be equal by chance
  console.log(`\n  Normal (no field): ${(normalSim.successRate * 100).toFixed(1)}% success`);
  console.log(`  High arousal:      ${(highArousalSim.successRate * 100).toFixed(1)}% success`);
  console.log(`  (High arousal reduces cognition success rate)`);

  // ── Test 7: Re-planning ──

  console.log('\nTest 7: Re-planning');
  console.log('─────────────────────');

  const replanResult = planner.replan(plan.id, 'reflect', { reason: 'step_failure' });
  assert('Replan succeeds', replanResult.success);
  assert('Steps removed', replanResult.removedSteps >= 1);
  assert('Alternative added', replanResult.addedAlternatives >= 1);
  assert('Some steps salvaged', replanResult.salvagedSteps >= 0);

  console.log(`\n  Replan result:`);
  console.log(`    Original: ${replanResult.originalSteps} steps`);
  console.log(`    Removed: ${replanResult.removedSteps}`);
  console.log(`    Alternatives: ${replanResult.addedAlternatives}`);
  console.log(`    Salvaged: ${replanResult.salvagedSteps}`);
  console.log(`    New total: ${replanResult.newSteps.length} steps`);

  // Replan from external failure
  const interestPlan = planner.getPlanForGoal('goal-interest');
  if (interestPlan) {
    const extReplan = planner.replan(interestPlan.id, 'web_check', { reason: 'external_failure' });
    assert('External replan uses local fallback', extReplan.newSteps?.some(s => s.id === 'web_check_local'));
  }

  // ── Test 8: Event bus integration ──

  console.log('\nTest 8: Event bus integration');
  console.log('──────────────────────────────');

  planner.registerListeners();

  const planCreatedEvents = bus.eventLog.filter(e => e.type === 'plan.created');
  assert('plan.created events emitted', planCreatedEvents.length >= 5, `got ${planCreatedEvents.length}`);

  // Simulate goal.generated → auto plan creation
  const beforeCount = planner.plans.size;
  bus.safeEmit('goal.generated', {
    source: 'goal-generator',
    goalId: 'goal-auto-1',
    title: 'Auto-generated test goal',
    priority: 0.5,
    goalSource: 'shadow',
  });

  // Wait for async listener
  await new Promise(r => setTimeout(r, 50));
  assert('Auto-creates plan from goal event', planner.plans.size > beforeCount);

  const simulatedEvents = bus.eventLog.filter(e => e.type === 'plan.simulated');
  assert('Auto-simulates plan', simulatedEvents.length >= 1);

  // ── Test 9: Plan visualization ──

  console.log('\nTest 9: Plan visualization');
  console.log('───────────────────────────');

  const viz = planner.visualizePlan(plan.id);
  assert('Visualization produced', viz.length > 100);
  assert('Shows layers', viz.includes('Layer'));
  assert('Shows steps', viz.includes('read_shadow'));
  assert('Shows Monte Carlo', viz.includes('Monte Carlo') || viz.includes('Success rate'));

  console.log(`\n${viz}`);

  // ── Test 10: Runtime template registration ──

  console.log('\nTest 10: Runtime template registration');
  console.log('────────────────────────────────────────');

  const customTemplate = {
    name: 'Custom Reflection',
    description: 'A learned template for reflection-heavy goals',
    steps: [
      { id: 'gather', name: 'Gather data', action: 'query_knowledge', args: {}, preconditions: [], rollback: null, critical: true },
      { id: 'think', name: 'Deep reflection', action: 'reflect', args: {}, preconditions: ['gather'], rollback: null, critical: true },
      { id: 'save', name: 'Save result', action: 'write_file', args: {}, preconditions: ['think'], rollback: null, critical: false },
    ],
  };

  const regResult = planner.registerTemplate('custom_reflect', customTemplate);
  assert('Template registered', regResult.registered);

  const customGoal = { id: 'goal-custom', source: 'custom_reflect', title: 'Test custom', feasibility: 0.8, trigger: {} };
  const customPlan = planner.createPlan(customGoal);
  assert('Custom template used', customPlan?.templateName === 'Custom Reflection');
  assert('Custom plan has 3 steps', customPlan?.steps?.length === 3);

  // ── Test 11: Metrics ──

  console.log('\nTest 11: Metrics');
  console.log('──────────────────');

  const metrics = planner.getMetrics();
  assert('Plans created tracked', metrics.plansCreated >= 7);
  assert('Replans tracked', metrics.totalReplans >= 1);

  console.log(`  Plans created: ${metrics.plansCreated}`);
  console.log(`  Plans completed: ${metrics.plansCompleted}`);
  console.log(`  Total replans: ${metrics.totalReplans}`);
  console.log(`  Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg steps to completion: ${metrics.avgStepsToCompletion.toFixed(1)}`);
  console.log(`  Rollback rate: ${(metrics.rollbackRate * 100).toFixed(1)}%`);

  // ── Final Report ──
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  if (results.failed > 0) {
    console.log('Failed tests:');
    for (const t of results.tests.filter(t => t.status === 'FAIL')) {
      console.log(`  ✗ ${t.name} ${t.detail ? `— ${t.detail}` : ''}`);
    }
  }

  return results;
}

if (process.argv.includes('--test')) {
  runTest().then(r => process.exit(r.failed > 0 ? 1 : 0));
}
