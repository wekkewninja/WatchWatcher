import type { ColregsRule } from '../../domain-types';

export type AssessmentPriority = 'critical' | 'major' | 'minor';

interface AssessmentQuestionBase {
  id: string;
  sectionId: string;
  sectionTitle: string;
  sourceRef: string;
  coverageIds: string[];
  priority: AssessmentPriority;
  priorityRationale: string;
  prompt: string;
  explanation: string;
  remediation: string;
}

export interface ChoiceAssessmentQuestion extends AssessmentQuestionBase {
  type: 'choice';
  options: Array<{ id: string; text: string }>;
  answer: string;
}

export interface ShortAnswerAssessmentQuestion extends AssessmentQuestionBase {
  type: 'short-answer';
  expectedKeywords: string[];
  forbiddenKeywords: string[];
  modelAnswer: string;
}

export type AssessmentQuestion = ChoiceAssessmentQuestion | ShortAnswerAssessmentQuestion;

export interface AssessmentCoverageObjective {
  id: string;
  label: string;
  sectionId: string;
  priority: AssessmentPriority;
  sourceRef: string;
}

export interface AssessmentBank {
  questions: AssessmentQuestion[];
  objectives: AssessmentCoverageObjective[];
}

export interface CurriculumAssessmentQuestion {
  id: string;
  prompt: string;
  expected_keywords: string[];
  forbidden_keywords: string[];
  correct_explanation: string;
  deep_remediation: string;
}

export interface CurriculumAssessmentAsset {
  modules: Array<{
    id: string;
    title: string;
    topics: Array<{
      id: string;
      title: string;
      rule_ref: string;
      summary: string;
      asa_note: string;
      questions: CurriculumAssessmentQuestion[];
    }>;
  }>;
}

const criticalRules = new Set([
  'Rule 1', 'Rule 2', 'Rule 5', 'Rule 6', 'Rule 7', 'Rule 8', 'Rule 9', 'Rule 10',
  'Rule 12', 'Rule 13', 'Rule 14', 'Rule 15', 'Rule 16', 'Rule 17', 'Rule 18',
  'Rule 19', 'Rule 23', 'Rule 24', 'Rule 26', 'Rule 27', 'Rule 34', 'Rule 35', 'Rule 37', 'Annex IV',
]);

const minorRules = new Set(['Rule 39', 'Rule 40', 'Rule 41', 'Annex I', 'Annex II', 'Annex III']);
const priorityRationale: Record<AssessmentPriority, string> = {
  critical: 'Immediate collision-avoidance, emergency, or grounding-prevention knowledge.',
  major: 'Frequently applied Yachtmaster knowledge and core syllabus competence.',
  minor: 'Specialist or lower-frequency technical knowledge retained for complete coverage.',
};

interface PointSource {
  rule: ColregsRule;
  ruleIndex: number;
  pointIndex: number;
  text: string;
}

function rulePriority(ruleNumber: string): AssessmentPriority {
  if (criticalRules.has(ruleNumber)) return 'critical';
  if (minorRules.has(ruleNumber)) return 'minor';
  return 'major';
}

function keyPointPriority(ruleNumber: string, pointIndex: number): AssessmentPriority {
  if (minorRules.has(ruleNumber)) return 'minor';
  if (criticalRules.has(ruleNumber) && pointIndex === 0) return 'critical';
  return 'major';
}

function stableHash(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function makeChoiceQuestion(input: {
  id: string;
  sectionId: string;
  sectionTitle: string;
  sourceRef: string;
  coverageId: string;
  priority: AssessmentPriority;
  prompt: string;
  answerText: string;
  distractors: string[];
  explanation: string;
  remediation: string;
}): ChoiceAssessmentQuestion {
  const distractors = [...new Set(input.distractors.filter((text) => text && text !== input.answerText))].slice(0, 3);
  if (distractors.length !== 3) throw new Error(`Question ${input.id} must have three distinct distractors.`);
  const options = distractors.map((text, index) => ({ id: `option-${index}`, text }));
  const answerIndex = stableHash(input.id) % 4;
  options.splice(answerIndex, 0, { id: `option-${answerIndex}`, text: input.answerText });
  return {
    type: 'choice',
    id: input.id,
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    sourceRef: input.sourceRef,
    coverageIds: [input.coverageId],
    priority: input.priority,
    priorityRationale: priorityRationale[input.priority],
    prompt: input.prompt,
    options,
    answer: `option-${answerIndex}`,
    explanation: input.explanation,
    remediation: input.remediation,
  };
}

interface ExplicitCheck {
  id: string;
  sectionId: string;
  sectionTitle: string;
  sourceRef: string;
  priority: AssessmentPriority;
  coverageId: string;
  prompt: string;
  answer: string;
  distractors: [string, string, string];
  explanation: string;
}

const explicitChecks: ExplicitCheck[] = [
  { id: 'lights-weather', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 20', priority: 'major', coverageId: 'colregs:type:lights-weather-and-day-shapes', prompt: 'When do the light and shape provisions apply?', answer: 'Rules 20–31 apply in all weather; lights are generally shown from sunset to sunrise and in restricted visibility by day, while shapes are shown by day.', distractors: ['Lights apply only in fog; shapes are shown only at night.', 'Rules 20–31 apply only when vessels are in sight.', 'Prescribed lights replace the lookout duty in restricted visibility.'], explanation: 'Rule 20 applies the lights and shapes rules in all weather, with separate day/night and restricted-visibility display requirements.' },
  { id: 'lights-masthead-definition', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 21(a)', priority: 'major', coverageId: 'colregs:type:masthead-light', prompt: 'What does a masthead light indicate by its sector?', answer: 'A white light showing an unbroken 225-degree arc from right ahead to 22.5 degrees abaft the beam on each side.', distractors: ['A green light visible through 112.5 degrees on the starboard side.', 'A white light visible through 135 degrees centered on the stern.', 'A red all-round light visible through 360 degrees.'], explanation: 'The masthead light is white and shows the prescribed forward sector.' },
  { id: 'lights-sidelight-colors', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 21(b)', priority: 'critical', coverageId: 'colregs:type:sidelights', prompt: 'Which colors identify a vessel’s sidelights?', answer: 'Green on the starboard side and red on the port side, each showing 112.5 degrees.', distractors: ['Red on starboard and green on port, each showing 135 degrees.', 'White on starboard and red on port, each showing 180 degrees.', 'Green on both sides, each showing 360 degrees.'], explanation: 'Sidelight color and aspect are essential to identify another vessel’s heading.' },
  { id: 'lights-sternlight', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 21(c)', priority: 'major', coverageId: 'colregs:type:sternlight', prompt: 'What sector does a sternlight show?', answer: 'An unbroken white light over a 135-degree arc centered astern.', distractors: ['A white light over a 225-degree arc from ahead.', 'A green light over 112.5 degrees on starboard.', 'A red light visible all around the horizon.'], explanation: 'The sternlight identifies the vessel’s aft aspect.' },
  { id: 'lights-all-round', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 21(e)', priority: 'major', coverageId: 'colregs:type:all-round-light', prompt: 'What makes a light an all-round light?', answer: 'It shows an unbroken light over an arc of 360 degrees.', distractors: ['It flashes at least 120 times per minute.', 'It shows a 225-degree forward sector.', 'It is visible only from the vessel’s beam.'], explanation: 'All-round describes visibility through the full horizon.' },
  { id: 'lights-flashing-definition', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 21(f)', priority: 'minor', coverageId: 'colregs:type:flashing-light', prompt: 'How does Rule 21 define a flashing light?', answer: 'A light flashing at regular intervals at a frequency of 120 flashes or more per minute.', distractors: ['A light that flashes once every 120 seconds.', 'A light with a fixed, uninterrupted beam.', 'A light flashing irregularly only when a vessel alters course.'], explanation: 'The rule gives a minimum flash frequency for this defined term.' },
  { id: 'lights-powered-underway', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 23', priority: 'critical', coverageId: 'colregs:type:power-driven-underway-lights', prompt: 'What is the ordinary light arrangement for a power-driven vessel underway?', answer: 'A masthead light forward, sidelights, and a sternlight, with additional or alternative arrangements for specified vessel sizes and types.', distractors: ['Red over green all-round lights and no sidelights.', 'Two all-round red lights and two black balls.', 'A red light over a white light and a sternlight only.'], explanation: 'Recognizing the ordinary power-driven pattern is fundamental to collision-risk assessment.' },
  { id: 'lights-sailing-underway', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 25(a)', priority: 'critical', coverageId: 'colregs:type:sailing-vessel-underway-lights', prompt: 'What lights does a sailing vessel underway ordinarily exhibit?', answer: 'Sidelights and a sternlight, subject to the permitted options for smaller sailing vessels.', distractors: ['Three masthead lights and a towing light.', 'Two all-round red lights and two balls.', 'A white-over-red pair only.'], explanation: 'The sailing-vessel pattern differs from the ordinary power-driven arrangement.' },
  { id: 'lights-motoring-sail', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 25(e)', priority: 'major', coverageId: 'colregs:type:sailing-while-propelled-by-machinery', prompt: 'What day shape is required for a vessel proceeding under sail while also propelled by machinery?', answer: 'A black cone, apex downwards, displayed forward where it can best be seen, subject to the applicable small-vessel exception.', distractors: ['A black diamond at the stern.', 'A black ball above a black cylinder.', 'A red-and-white flag at the masthead.'], explanation: 'The cone indicates that the vessel is also being propelled by machinery.' },
  { id: 'lights-under-oars', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 25(d)', priority: 'minor', coverageId: 'colregs:type:vessel-under-oars', prompt: 'If a vessel under oars does not display the sailing-vessel lights, what should it have ready at hand?', answer: 'An electric torch or lighted lantern showing a white light, exhibited in sufficient time to prevent collision.', distractors: ['A red all-round light shown continuously.', 'A black diamond and a whistle.', 'A green flashing light displayed at the stern.'], explanation: 'Rule 25 provides a practical white-light alternative for a vessel under oars.' },
  { id: 'lights-trawling', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 26(b)', priority: 'critical', coverageId: 'colregs:type:fishing-trawling', prompt: 'Which light pair identifies a vessel engaged in trawling?', answer: 'Two all-round lights in a vertical line, green above white.', distractors: ['Red above white.', 'Red-white-red.', 'White above red.'], explanation: 'Green over white identifies trawling; distinguish it from other fishing activity.' },
  { id: 'lights-fishing-other', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 26(c)', priority: 'major', coverageId: 'colregs:type:fishing-not-trawling', prompt: 'Which light pair identifies a qualifying fishing vessel other than a trawler?', answer: 'Two all-round lights in a vertical line, red above white.', distractors: ['Green above white.', 'White above red.', 'Three all-round red lights.'], explanation: 'Red over white identifies qualifying fishing other than trawling.' },
  { id: 'lights-nuc', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 27(a)', priority: 'critical', coverageId: 'colregs:type:not-under-command', prompt: 'What lights or shapes identify a vessel not under command?', answer: 'Two all-round red lights in a vertical line, or two balls in a vertical line; sidelights and a sternlight are added when making way.', distractors: ['Red-white-red lights and ball-diamond-ball shapes.', 'Green over white lights and two cones apexes together.', 'White over red lights and a black diamond.'], explanation: 'NUC status is shown by red over red, or two balls, with underway lights added when applicable.' },
  { id: 'lights-ram', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 27(b)', priority: 'critical', coverageId: 'colregs:type:restricted-ability-to-maneuver', prompt: 'What is the ordinary status pattern for a vessel restricted in her ability to maneuver?', answer: 'Red-white-red all-round lights in a vertical line, or ball-diamond-ball shapes, with additional lights when making way.', distractors: ['Two all-round red lights or two balls only.', 'Green over white lights and one black ball.', 'White over red lights and a cylinder.'], explanation: 'RAM status uses the distinctive red-white-red / ball-diamond-ball pattern.' },
  { id: 'lights-dredging-obstruction', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 27(d)', priority: 'major', coverageId: 'colregs:type:dredging-safe-passage-side', prompt: 'A RAM vessel dredging has an obstruction on one side. Which signals indicate the obstructed and safe-passage sides?', answer: 'Two red lights or balls mark the obstructed side; two green lights or diamonds mark the side on which another vessel may pass.', distractors: ['Two green lights mark the obstruction and red marks the safe side.', 'A white-over-red pair marks the obstruction and a black cone the safe side.', 'A single all-round white light marks both sides equally.'], explanation: 'The paired red/green or ball/diamond signals distinguish obstruction from the safe-passage side.' },
  { id: 'lights-constrained-draft', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 28', priority: 'major', coverageId: 'colregs:type:constrained-by-draft', prompt: 'What additional signal may a vessel constrained by her draft exhibit under the International Rules?', answer: 'Three all-round red lights in a vertical line, or a cylinder, in addition to the power-driven vessel lights.', distractors: ['Two all-round green lights and a diamond.', 'Red over green lights above the masthead.', 'One white light and two black balls.'], explanation: 'Rule 28 is International-only and makes the constrained-by-draft signal optional.' },
  { id: 'lights-pilot', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 29', priority: 'major', coverageId: 'colregs:type:pilot-vessel', prompt: 'Which lights identify a vessel engaged on pilotage duty?', answer: 'Two all-round lights in a vertical line, white above red; additional lights depend on whether it is underway or at anchor.', distractors: ['Red above white.', 'Green above white.', 'Red-white-red.'], explanation: 'The white-over-red pair identifies pilotage duty.' },
  { id: 'lights-tow-200m', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 24(a)', priority: 'critical', coverageId: 'colregs:type:tow-over-200m', prompt: 'When towing astern and the tow length exceeds 200 meters, which additional lights and day shape does the towing vessel display?', answer: 'Three masthead lights in a vertical line and a black diamond where it can best be seen.', distractors: ['The towing vessel extinguishes sidelights and the tow shows two balls.', 'The tow shows a cylinder and the towing vessel shows red over green.', 'Only a special flashing light is required; no shape is shown.'], explanation: 'Rule 24(a) requires the towing vessel to add a third masthead light and a diamond shape when the tow length exceeds 200 meters; Rule 24(g) has separate signals for inconspicuous, partly submerged tows.' },
  { id: 'lights-anchor', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 30(a)-(b)', priority: 'major', coverageId: 'colregs:type:anchored-vessel', prompt: 'What anchor signals may a vessel under 50 meters exhibit?', answer: 'One all-round white light where it can best be seen; by day, one black ball. It may instead use the two-light arrangement in Rule 30(a).', distractors: ['Two all-round red lights and two balls.', 'Green over white lights and a cone.', 'A white-over-red pair with a diamond.'], explanation: 'Rule 30(a) describes the forward and after light arrangement; Rule 30(b) allows a vessel under 50 meters to use one all-round white light instead.' },
  { id: 'lights-aground', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 30(d)', priority: 'major', coverageId: 'colregs:type:vessel-aground', prompt: 'What does a vessel aground add to its anchor signals when practicable?', answer: 'Two all-round red lights in a vertical line and three balls in a vertical line.', distractors: ['Two all-round green lights and two diamonds.', 'Red over green lights and a cone.', 'A white-over-red pair and a black cylinder.'], explanation: 'Aground signals supplement, rather than replace, the applicable anchor signals.' },
  { id: 'lights-seaplane-wig', sectionId: 'colregs-lights-shapes', sectionTitle: 'Lights and shapes', sourceRef: 'Rule 31', priority: 'minor', coverageId: 'colregs:type:seaplane-wig', prompt: 'If a seaplane or WIG craft cannot exhibit prescribed lights or shapes in the required positions, what does Rule 31 require?', answer: 'It must exhibit lights and shapes as closely similar in characteristics and position as practicable.', distractors: ['It is exempt from collision-avoidance rules.', 'It must show NUC signals whenever underway.', 'It may use any signal without regard to confusion.'], explanation: 'Practical limits do not remove the requirement to show the closest practicable signals.' },
  { id: 'signals-blast-duration', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 32', priority: 'major', coverageId: 'colregs:type:short-prolonged-blast-duration', prompt: 'How long are a short blast and a prolonged blast?', answer: 'A short blast is about one second; a prolonged blast is four to six seconds.', distractors: ['A short blast is four to six seconds; a prolonged blast is about one second.', 'Both blasts are about one second.', 'A short blast is less than a tenth of a second; a prolonged blast is one minute.'], explanation: 'Know the defined durations before interpreting signal sequences.' },
  { id: 'signals-equipment', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 33', priority: 'minor', coverageId: 'colregs:type:sound-signal-equipment', prompt: 'What sound-signaling equipment is generally required for a vessel 100 meters or more in length?', answer: 'A whistle, a bell, and a gong meeting the applicable technical requirements.', distractors: ['A whistle only.', 'A bell and one short-blast signal lamp only.', 'A gong only, unless underway.'], explanation: 'Rule 33 scales sound-signal equipment requirements by vessel length.' },
  { id: 'signals-maneuvering', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 34(a)', priority: 'critical', coverageId: 'colregs:type:maneuvering-blasts', prompt: 'Under the International Rule 34(a) maneuvering signals, what do one, two, and three short blasts mean?', answer: 'Altering course to starboard; altering course to port; operating astern propulsion.', distractors: ['Altering to port; altering to starboard; stopping engines.', 'Leaving on the other vessel’s port side; leaving on its starboard side; danger.', 'Overtaking on starboard; overtaking on port; agreeing to pass.'], explanation: 'These common maneuvering signals identify the action being taken.' },
  { id: 'signals-doubt', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 34(d)', priority: 'critical', coverageId: 'colregs:type:doubt-danger-signal', prompt: 'What signal indicates doubt about another vessel’s intentions or action in the specified in-sight circumstances?', answer: 'At least five short and rapid blasts, optionally supplemented by at least five short rapid flashes.', distractors: ['One prolonged blast.', 'Three prolonged blasts.', 'One short blast followed by two prolonged blasts.'], explanation: 'The doubt signal is five or more short rapid blasts.' },
  { id: 'signals-inland-difference', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 34(c)', priority: 'major', coverageId: 'colregs:type:international-inland-passing-signals', prompt: 'How do ordinary Rule 34(a) maneuvering meanings differ from Inland Rule 34(c) passing signals?', answer: 'International one/two short blasts indicate starboard/port alteration; Inland one/two short blasts can propose leaving the other vessel on port/starboard in specified close meeting or crossing situations.', distractors: ['They have identical meanings in all circumstances.', 'International one/two short means port/starboard; Inland one/two means astern propulsion.', 'Inland uses only prolonged blasts and International uses only flashing lights.'], explanation: 'The signal meaning depends on which regime and encounter conditions apply.' },
  { id: 'signals-fog-making-way', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 35(a)', priority: 'critical', coverageId: 'colregs:type:fog-signal-making-way', prompt: 'What fog signal does a power-driven vessel making way through the water sound?', answer: 'One prolonged blast at intervals of not more than two minutes.', distractors: ['Two short blasts every minute.', 'Two prolonged blasts in succession every two minutes.', 'One prolonged blast followed by three short blasts every minute.'], explanation: 'Rule 35 distinguishes a power-driven vessel making way from one stopped and making no way.' },
  { id: 'signals-fog-stopped', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 35(b)', priority: 'major', coverageId: 'colregs:type:fog-signal-stopped', prompt: 'What fog signal does a power-driven vessel underway but stopped and making no way through the water sound?', answer: 'Two prolonged blasts in succession with an interval of about two seconds, at intervals of not more than two minutes.', distractors: ['One prolonged blast at intervals of no more than two minutes.', 'Three short blasts followed by one prolonged blast.', 'Five short rapid blasts every minute.'], explanation: 'Two prolonged blasts distinguish stopped/no-way status from making way.' },
  { id: 'signals-fog-other-vessels', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 35(c)', priority: 'major', coverageId: 'colregs:type:fog-signal-other-vessels', prompt: 'Which signal is used by specified sailing, fishing, NUC, RAM, or towing vessels in restricted visibility?', answer: 'One prolonged blast followed by two short blasts, at intervals of not more than two minutes.', distractors: ['Two prolonged blasts only.', 'One short, one prolonged, and one short blast.', 'Four short blasts at intervals of one minute.'], explanation: 'Rule 35(c) groups several non-power-driven or restricted-status vessels under this sequence.' },
  { id: 'signals-anchored-aground', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'Rule 35(g)-(h)', priority: 'major', coverageId: 'colregs:type:anchored-aground-fog-signals', prompt: 'What sound signal does a vessel at anchor make in restricted visibility, and what is added when aground?', answer: 'Ring the bell rapidly for about five seconds at intervals of not more than one minute; vessels 100 meters or more also sound the gong rapidly for about five seconds immediately after. When aground, add three separate strokes immediately before and after the rapid bell ringing.', distractors: ['One prolonged blast every two minutes; when aground, two short blasts.', 'Five short rapid whistle blasts every minute; when aground, no extra signal.', 'Two prolonged blasts every minute; when aground, one bell stroke.'], explanation: 'Rule 35(g) adds a gong after the bell for vessels 100 meters or more; Rule 35(h) adds three separate bell strokes before and after the rapid ringing when aground.' },
  { id: 'signals-distress', sectionId: 'colregs-distress', sectionTitle: 'Distress signals', sourceRef: 'Rule 37 and Annex IV', priority: 'critical', coverageId: 'colregs:type:distress-signal-types', prompt: 'Which set contains recognized distress indications under Annex IV?', answer: 'MAYDAY by radiotelephony, SOS by Morse, a red flare, orange smoke, or a distress alert by approved radio/satellite equipment.', distractors: ['One short maneuvering blast, a green light, or a black diamond.', 'A routine PAN-PAN call only, with no position or distress.', 'Any bright light or sound signal, even if it can be mistaken for a navigation signal.'], explanation: 'Annex IV includes radio, visual, sound, and electronic indications of distress and need of assistance.' },
  { id: 'signals-attention', sectionId: 'colregs-sound-signals', sectionTitle: 'Sound and light signals', sourceRef: 'International Rule 36', priority: 'major', coverageId: 'colregs:type:attention-signal-safety', prompt: 'Under International Rule 36, what restriction applies to a light used to attract another vessel’s attention?', answer: 'It must not be mistaken for an aid to navigation; high-intensity intermittent or revolving lights, such as strobes, should be avoided.', distractors: ['It must use the distress signal sequence.', 'It must always be five short blasts.', 'It replaces any required collision-avoidance action.'], explanation: 'The International text adds that attention lights must not be mistaken for aids to navigation and that high-intensity intermittent or revolving lights should be avoided; attention signals do not replace required action.' },
];

const curriculumPriority = new Map<string, AssessmentPriority>([
  ['colregs_steering_rules', 'critical'],
  ['colregs_rule_19d', 'critical'],
  ['colregs_lights_shapes', 'critical'],
  ['nav_compass_leeway', 'major'],
  ['nav_dr_ep_fixes', 'major'],
  ['tides_heights_clearance', 'critical'],
  ['tides_diamonds_cts', 'critical'],
  ['met_depressions_fronts', 'major'],
  ['met_local_fog', 'critical'],
  ['plan_solas_pilotage', 'major'],
  ['plan_tidal_gates_bars', 'critical'],
  ['emerg_mob_heavy_weather', 'critical'],
  ['emerg_anchoring_distress', 'critical'],
]);

const criticalKeypointRules = new Set(['Rule 1', 'Rule 2', 'Rule 5', 'Rule 6', 'Rule 7', 'Rule 8', 'Rule 9', 'Rule 10', 'Rule 12', 'Rule 13', 'Rule 14', 'Rule 15', 'Rule 16', 'Rule 17', 'Rule 18', 'Rule 19', 'Rule 23', 'Rule 24', 'Rule 26', 'Rule 27', 'Rule 34', 'Rule 35', 'Rule 37', 'Annex IV']);

function getPriorityRationale(priority: AssessmentPriority): string {
  if (priority === 'critical') return 'Immediate collision-avoidance, emergency, or grounding-prevention knowledge.';
  if (priority === 'minor') return 'Specialist or lower-frequency technical knowledge retained for complete coverage.';
  return 'Frequently assessed Yachtmaster knowledge and common operating procedures.';
}

function hash(value: string): number {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

function createChoice(input: {
  id: string;
  sectionId: string;
  sectionTitle: string;
  sourceRef: string;
  coverageId: string;
  priority: AssessmentPriority;
  prompt: string;
  correctText: string;
  distractors: string[];
  explanation: string;
  remediation?: string;
}): ChoiceAssessmentQuestion {
  const distractors = [...new Set(input.distractors.filter((option) => option && option !== input.correctText))].slice(0, 3);
  if (distractors.length !== 3) throw new Error(`${input.id} must have three distinct distractors.`);
  const answerIndex = hash(input.id) % 4;
  const choices = [...distractors];
  choices.splice(answerIndex, 0, input.correctText);
  return {
    id: input.id,
    type: 'choice',
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    sourceRef: input.sourceRef,
    coverageIds: [input.coverageId],
    priority: input.priority,
    priorityRationale: getPriorityRationale(input.priority),
    prompt: input.prompt,
    options: choices.map((text, index) => ({ id: `option-${index}`, text })),
    answer: `option-${answerIndex}`,
    explanation: input.explanation,
    remediation: input.remediation ?? `Review ${input.sourceRef} and its related study points.`,
  };
}

function selectDistractors(target: PointSource, points: PointSource[], questionId: string): string[] {
  const sameCategory = points.filter((candidate) => candidate.rule.id !== target.rule.id && candidate.rule.category === target.rule.category);
  const allOtherRules = points.filter((candidate) => candidate.rule.id !== target.rule.id);
  const candidates = sameCategory.length >= 3 ? sameCategory : allOtherRules;
  const selected: string[] = [];
  const start = hash(questionId) % candidates.length;
  for (let offset = 0; offset < candidates.length && selected.length < 3; offset += 1) {
    const text = candidates[(start + offset) % candidates.length].text;
    if (text !== target.text && !selected.includes(text)) selected.push(text);
  }
  return selected;
}

function priorityForKeypoint(rule: ColregsRule, pointIndex: number): AssessmentPriority {
  if (minorRules.has(rule.ruleNumber)) return 'minor';
  return criticalKeypointRules.has(rule.ruleNumber) && pointIndex === 0 ? 'critical' : 'major';
}

function addObjective(objectives: AssessmentCoverageObjective[], objective: AssessmentCoverageObjective): void {
  if (objectives.some((existing) => existing.id === objective.id)) throw new Error(`Duplicate coverage ID ${objective.id}.`);
  objectives.push(objective);
}

const keywordStopWords = new Set(['about', 'after', 'also', 'before', 'from', 'have', 'into', 'more', 'over', 'that', 'their', 'then', 'these', 'this', 'those', 'through', 'under', 'when', 'where', 'which', 'with', 'your']);

function coverageKeywords(answer: string): string[] {
  return [...new Set(answer.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !keywordStopWords.has(word)))].slice(0, 4);
}

function createCurriculumReviewQuestion(input: {
  id: string;
  topicId: string;
  topicTitle: string;
  sourceRef: string;
  priority: AssessmentPriority;
  coverageId: string;
  prompt: string;
  answer: string;
}): ShortAnswerAssessmentQuestion {
  const expectedKeywords = coverageKeywords(input.answer);
  if (!expectedKeywords.length) throw new Error(`Curriculum review question ${input.id} has no coverage keywords.`);
  return {
    id: input.id,
    type: 'short-answer',
    sectionId: input.topicId,
    sectionTitle: input.topicTitle,
    sourceRef: input.sourceRef,
    coverageIds: [input.coverageId],
    priority: input.priority,
    priorityRationale: getPriorityRationale(input.priority),
    prompt: input.prompt,
    expectedKeywords,
    forbiddenKeywords: [],
    modelAnswer: input.answer,
    explanation: input.answer,
    remediation: `Review the ${input.topicTitle} briefing and compare your answer with the key concepts.`,
  };
}

export function buildAssessmentBank(rules: ColregsRule[], curriculum: CurriculumAssessmentAsset): AssessmentBank {
  const questions: AssessmentQuestion[] = [];
  const objectives: AssessmentCoverageObjective[] = [];
  const allPoints: PointSource[] = rules.flatMap((rule, ruleIndex) => rule.keyPoints.map((text, pointIndex) => ({ rule, ruleIndex, pointIndex, text })));

  for (const rule of rules) {
    const exerciseCoverage = `colregs:${rule.id}:scenario`;
    const priority = minorRules.has(rule.ruleNumber) ? 'minor' : criticalRules.has(rule.ruleNumber) ? 'critical' : 'major';
    addObjective(objectives, { id: exerciseCoverage, label: `${rule.ruleNumber} scenario`, sectionId: rule.id, priority, sourceRef: rule.ruleNumber });
    questions.push({
      id: `${rule.id}:scenario`,
      type: 'choice',
      sectionId: rule.id,
      sectionTitle: `${rule.ruleNumber} · ${rule.title}`,
      sourceRef: rule.ruleNumber,
      coverageIds: [exerciseCoverage],
      priority,
      priorityRationale: getPriorityRationale(priority),
      prompt: rule.exercise.prompt,
      options: rule.exercise.options,
      answer: rule.exercise.answer,
      explanation: rule.exercise.explanation,
      remediation: rule.exercise.remediation,
    });

    rule.keyPoints.forEach((point, pointIndex) => {
      const questionId = `${rule.id}:key-point:${pointIndex + 1}`;
      const coverageId = `colregs:${questionId}`;
      const pointPriority = priorityForKeypoint(rule, pointIndex);
      addObjective(objectives, { id: coverageId, label: `${rule.ruleNumber}: ${point}`, sectionId: rule.id, priority: pointPriority, sourceRef: rule.ruleNumber });
      questions.push(createChoice({
        id: questionId,
        sectionId: rule.id,
        sectionTitle: `${rule.ruleNumber} · ${rule.title}`,
        sourceRef: rule.ruleNumber,
        coverageId,
        priority: pointPriority,
        prompt: `Which statement is a key requirement or principle of ${rule.ruleNumber} (${rule.title})?`,
        correctText: point,
        distractors: selectDistractors(allPoints.find((candidate) => candidate.rule.id === rule.id && candidate.pointIndex === pointIndex)!, allPoints, questionId),
        explanation: `${rule.ruleNumber}: ${point}`,
      }));
    });
  }

  for (const module of curriculum.modules) {
    for (const topic of module.topics) {
      const priority = curriculumPriority.get(topic.id) ?? 'major';
      for (const [kind, label, content] of [
        ['briefing', 'study briefing', topic.summary],
        ['regional-note', 'RYA / ASA note', topic.asa_note],
      ] as const) {
        const coverageId = `curriculum:${topic.id}:${kind}`;
        addObjective(objectives, { id: coverageId, label: `${topic.title}: ${label}`, sectionId: topic.id, priority, sourceRef: topic.rule_ref });
        questions.push(createCurriculumReviewQuestion({
          id: `${topic.id}:${kind}`,
          topicId: topic.id,
          topicTitle: `${module.title} · ${topic.title}`,
          sourceRef: topic.rule_ref,
          priority,
          coverageId,
          prompt: kind === 'briefing' ? `State the core idea taught in ${topic.title}.` : `What regional or training note should be checked for ${topic.title}?`,
          answer: content,
        }));
      }
      for (const item of topic.questions) {
        const coverageId = `curriculum:${topic.id}:${item.id}`;
        addObjective(objectives, { id: coverageId, label: `${topic.title}: ${item.prompt}`, sectionId: topic.id, priority, sourceRef: topic.rule_ref });
        questions.push({
          id: item.id,
          type: 'short-answer',
          sectionId: topic.id,
          sectionTitle: `${module.title} · ${topic.title}`,
          sourceRef: topic.rule_ref,
          coverageIds: [coverageId],
          priority,
          priorityRationale: getPriorityRationale(priority),
          prompt: item.prompt,
          expectedKeywords: item.expected_keywords,
          forbiddenKeywords: item.forbidden_keywords,
          explanation: item.correct_explanation,
          remediation: item.deep_remediation,
          modelAnswer: item.correct_explanation,
        });
      }
    }
  }

  for (const check of explicitChecks) {
    addObjective(objectives, { id: check.coverageId, label: check.prompt, sectionId: check.sectionId, priority: check.priority, sourceRef: check.sourceRef });
    questions.push(createChoice({ ...check, coverageId: check.coverageId, correctText: check.answer }));
  }

  const objectiveIds = new Set(objectives.map((objective) => objective.id));
  const coveredIds = new Set(questions.flatMap((question) => question.coverageIds));
  if (questions.some((question) => question.coverageIds.some((coverageId) => !objectiveIds.has(coverageId)))) {
    throw new Error('Assessment question refers to an unknown coverage objective.');
  }
  const uncovered = objectives.filter((objective) => !coveredIds.has(objective.id));
  if (uncovered.length) throw new Error(`Assessment bank has uncovered objectives: ${uncovered.map((objective) => objective.id).join(', ')}`);
  if (new Set(questions.map((question) => question.id)).size !== questions.length) throw new Error('Assessment question IDs must be unique.');
  return { questions, objectives };
}

export function selectExamQuestions(questions: AssessmentQuestion[], random: () => number = Math.random, supplementalCount = 5): AssessmentQuestion[] {
  const critical = questions.filter((question) => question.priority === 'critical');
  const pool = questions.filter((question) => question.priority !== 'critical');
  const sampleCount = Math.min(Math.max(0, supplementalCount), pool.length);
  const shuffled = [...pool];
  for (let index = 0; index < sampleCount; index += 1) {
    const randomValue = Math.min(0.999999999, Math.max(0, random()));
    const swapIndex = index + Math.floor(randomValue * (shuffled.length - index));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const exam = [...critical, ...shuffled.slice(0, sampleCount)];
  for (let index = exam.length - 1; index > 0; index -= 1) {
    const randomValue = Math.min(0.999999999, Math.max(0, random()));
    const swapIndex = Math.floor(randomValue * (index + 1));
    [exam[index], exam[swapIndex]] = [exam[swapIndex], exam[index]];
  }
  return exam;
}

export function gradeShortAnswer(question: ShortAnswerAssessmentQuestion, answer: string): { correct: boolean; matched: string[]; required: number; forbiddenFound: string[] } {
  const normalized = answer.trim().toLowerCase();
  const matched = question.expectedKeywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
  const forbiddenFound = question.forbiddenKeywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
  const required = Math.max(1, Math.ceil(question.expectedKeywords.length * 0.6));
  return { correct: normalized.length > 0 && matched.length >= required && forbiddenFound.length === 0, matched, required, forbiddenFound };
}

interface PointSource {
  rule: ColregsRule;
  ruleIndex: number;
  pointIndex: number;
  text: string;
}