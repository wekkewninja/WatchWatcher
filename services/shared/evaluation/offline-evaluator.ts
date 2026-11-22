export interface OfflineEvaluationInput {
  topicId: string;
  answer: string;
}

export interface OfflineEvaluationResult {
  score: number;
  feedback: string;
  misconceptionTag: string | null;
  followUpDrill: string;
  source: 'offline';
}

export interface StructuredRule19Answer {
  ruleNumber: number;
  prohibits: 'port' | 'starboard' | 'toward-target';
  alteration: 'port' | 'starboard' | 'toward-target';
  safeSpeedConfirmed: boolean;
}

export function evaluateOfflineAnswer(input: OfflineEvaluationInput): OfflineEvaluationResult {
  const answer = input.answer.toLowerCase();
  const isRule19 = input.topicId.toLowerCase().includes('19');
  if (isRule19) return evaluateRule19(answer);

  const keywords = ['rule', 'safe', 'action'];
  const matched = keywords.filter((keyword) => answer.includes(keyword)).length;
  const score = Math.min(0.95, 0.45 + matched * 0.17);
  return {
    score,
    feedback: score >= 0.8
      ? 'Your answer identifies the governing rule and a safe response.'
      : 'Add the rule, the hazard or target aspect, and a specific safe action.',
    misconceptionTag: score < 0.8 ? 'incomplete-rule-application' : null,
    followUpDrill: 'Repeat the scenario and explain how you will verify the effect of your action.',
    source: 'offline',
  };
}

export function evaluateStructuredRule19(input: StructuredRule19Answer): OfflineEvaluationResult {
  if (input.alteration !== 'starboard') {
    return {
      score: 0.25,
      feedback: 'For this target on the port bow, a port or toward-target alteration is unsafe. Choose a clear starboard alteration.',
      misconceptionTag: 'rule-19-prohibited-port-turn',
      followUpDrill: 'Repeat the radar-fog encounter and identify the target’s aspect before choosing an alteration.',
      source: 'offline',
    };
  }
  if (input.ruleNumber !== 19) {
    return {
      score: 0.6,
      feedback: 'The safe alteration is starboard, but identify Rule 19 for a vessel detected in restricted visibility.',
      misconceptionTag: 'rule-19-misidentified',
      followUpDrill: 'Review Rule 19(b) and Rule 19(d) for restricted-visibility encounters.',
      source: 'offline',
    };
  }
  if (input.prohibits !== 'port') {
    return {
      score: 0.6,
      feedback: 'Rule 19(d) prohibits a port alteration for a target forward of the beam.',
      misconceptionTag: 'rule-19-prohibition-misidentified',
      followUpDrill: 'Review the direction prohibited by Rule 19(d) for a target forward of the beam.',
      source: 'offline',
    };
  }
  return {
    score: input.safeSpeedConfirmed ? 0.95 : 0.9,
    feedback: input.safeSpeedConfirmed
      ? 'Correct. Rule 19(d) prohibits a port alteration for this target forward of the beam; a clear starboard alteration at safe speed is appropriate.'
      : 'Correct. Rule 19(d) prohibits a port alteration for this target forward of the beam; a clear starboard alteration is appropriate. Maintain safe speed and keep engines ready.',
    misconceptionTag: null,
    followUpDrill: 'Repeat the radar-fog encounter with a target on the starboard bow.',
    source: 'offline',
  };
}

function evaluateRule19(answer: string): OfflineEvaluationResult {
  const unsafePortTurn = hasUnnegatedPortAction(answer);
  const mentionsRule = /\brule\s*19(?:\s*\(?\s*[a-e]\s*\)?)?\b/i.test(answer);
  const choosesStarboard = /\bstarboard\b|\b(?:turn|alter)\s+(?:to\s+)?(?:the\s+)?right\b/i.test(answer);
  const mentionsSafeSpeed = /\bsafe\s+speed\b|\bminimum\s+(?:safe\s+)?steerageway\b|\breduced\s+speed\b/i.test(answer);
  const score = unsafePortTurn
    ? 0.25
    : Math.min(0.95, 0.25 + (mentionsRule ? 0.25 : 0) + (choosesStarboard ? 0.4 : 0) + (mentionsSafeSpeed ? 0.05 : 0));
  return {
    score,
    feedback: unsafePortTurn
      ? 'A port alteration for a target forward of the beam is unsafe under Rule 19(d). State a safe, deliberate action.'
      : score >= 0.85
        ? 'Correct. Rule 19(d) prohibits a port alteration for a target forward of the beam; a clear starboard alteration is appropriate.'
        : 'Name Rule 19 and state a clear avoiding action. For a target forward of the beam, do not alter to port.',
    misconceptionTag: unsafePortTurn ? 'rule-19-prohibited-port-turn' : score < 0.85 ? 'incomplete-rule-application' : null,
    followUpDrill: 'Repeat the radar-fog encounter with a target on the starboard bow.',
      source: 'offline',
  };
}

function hasUnnegatedPortAction(answer: string): boolean {
  const portAction = /\b(?:turn|alter|steer)\b[^.!?;,:]{0,40}\bport\b|\bport\b[^.!?;,:]{0,24}\b(?:turn|alter|steer|alteration)\b/g;
  const clauses = answer.split(/[.!?;,]|\bbut\b|\bhowever\b|\bwhereas\b|\balthough\b/i);
  return clauses.some((clause) => {
    for (const match of clause.matchAll(portAction)) {
      const prefix = clause.slice(Math.max(0, (match.index ?? 0) - 48), match.index ?? 0).replace(/\bnot only\b/g, '');
      const negated = /\b(?:never|not|don't|do not|must not|mustn't|should not|shouldn't|cannot|can't|avoid|forbid(?:s|den)?|prohibited|unsafe|no)\b(?:\s+\w+){0,4}\s*$/i.test(prefix);
      if (!negated) return true;
    }
    return false;
  });
}
