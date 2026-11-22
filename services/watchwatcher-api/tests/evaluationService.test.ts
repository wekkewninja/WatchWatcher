import { describe, expect, it } from 'vitest';
import { DeterministicEvaluationService } from '../src/services/evaluationService';

describe('offline evaluation fallback', () => {
  const evaluator = new DeterministicEvaluationService();

  it('fails an unsafe port turn for a Rule 19 target forward of the beam', async () => {
    const result = await evaluator.evaluate({ topicId: 'colregs_rule_19', context: 'Target forward of beam', answer: 'I would turn to port.' });
    expect(result.score).toBeLessThan(0.5);
    expect(result.misconceptionTag).toBe('rule-19-prohibited-port-turn');
  });

  it('accepts a negated port-turn warning followed by a starboard action', async () => {
    const result = await evaluator.evaluate({
      topicId: 'colregs_rule_19',
      context: 'Target forward of beam',
      answer: 'Rule 19b makes me never turn port. so i will turn to starboard.',
    });
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.misconceptionTag).toBeNull();
  });

  it('rewards an answer that names a safe Rule 19 action', async () => {
    const result = await evaluator.evaluate({ topicId: 'colregs_rule_19', context: 'Target forward of beam', answer: 'Under Rule 19 maintain safe speed and alter to starboard.' });
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.misconceptionTag).toBeNull();
  });
});
