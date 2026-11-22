import { OfflineExaminerService } from './offline-examiner.service';

describe('OfflineExaminerService', () => {
  const examiner = new OfflineExaminerService();

  it('fails a prohibited port turn even if the answer mentions Rule 19', () => {
    const result = examiner.evaluate({ topicId: 'colregs_rule_19', context: 'Target forward of the beam', answer: 'Under Rule 19 I turn to port at safe speed.' });
    expect(result.score).toBe(0.25);
    expect(result.passed).toBe(false);
    expect(result.misconceptionTag).toBe('rule-19-prohibited-port-turn');
  });

  it('accepts a correct answer that says never to turn port and chooses starboard', () => {
    const result = examiner.evaluate({
      topicId: 'colregs_rule_19',
      context: 'Target forward of the beam',
      answer: 'Rule 19b makes me never turn port. so i will turn to starboard.',
    });
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.passed).toBe(true);
    expect(result.misconceptionTag).toBeNull();
  });

  it('passes the correct structured Rule 19 choices without requiring free text', () => {
    const result = examiner.evaluateStructuredRule19({
      ruleNumber: 19,
      prohibits: 'port',
      alteration: 'starboard',
      safeSpeedConfirmed: true,
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.source).toBe('offline');
  });

  it('fails a structured port alteration for the port-bow target', () => {
    const result = examiner.evaluateStructuredRule19({
      ruleNumber: 19,
      prohibits: 'port',
      alteration: 'port',
      safeSpeedConfirmed: true,
    });
    expect(result.passed).toBe(false);
    expect(result.misconceptionTag).toBe('rule-19-prohibited-port-turn');
  });

  it('passes a complete safe answer at the topic threshold', () => {
    const result = examiner.evaluate({ topicId: 'colregs_rule_19', context: 'Target forward of the beam', answer: 'Under Rule 19, keep safe speed and alter to starboard.' });
    expect(result.passed).toBe(true);
    expect(result.misconceptionTag).toBeNull();
  });
});
