# Exam Accuracy Audit (#23)

## Scope

The Exam inventory contains COLREGs Rules 1-41, Annexes I-IV, and 13 curriculum topics with 26 authored questions. The COLREGs catalog supplies three key-point checks and one scenario for each of its 45 entries. The inventory and coverage paths were reviewed; the detailed source-based accuracy pass is still in progress and has prioritized rule scope, International/Inland differences, safety-critical thresholds, signal patterns, and answer keys. A regression test now verifies that every authored short-answer model answer passes its own keyword rubric; this checks grading consistency, not factual certification of every answer or distractor.

**Status: In progress.** Keep issue #23 open, and do not treat this PR as the prerequisite-complete branch for #22 until the remaining curriculum checks below are resolved.

## Audience and Regional Scope

- Current target: RYA Yachtmaster is the primary curriculum and source set.
- Future product consideration: an ASA-heavy selectable profile may be added later; it is not part of this issue's implementation.
- Regional examples: British Isles. Use the Bristol Channel/Severn Estuary as the initial candidate case study for complex tidal planning. Verify all numeric examples against the current UKHO chart, tide predictions, and relevant local publications before adding them to the Exam.

| Area | Coverage reviewed |
| --- | --- |
| General and steering | Rules 1-18 |
| Restricted visibility | Rule 19 |
| Lights and shapes | Rules 20-31; Annexes I-II |
| Sound and light signals | Rules 32-36; Annex III |
| Distress | Rule 37; Annex IV |
| Exemptions and Convention oversight | Rules 38-41 |
| Curriculum | 13 topics across COLREGs, navigation, tides, meteorology, passage planning, and emergencies |
| External curriculum benchmark | RYA, American Sailing (ASA), and US Sailing public cruising/navigation standards |

## External Curriculum Benchmark

### Method

Compared the 13 WatchWatcher topics with publicly available curriculum descriptions and standards from three established training organizations: RYA (Day Skipper theory and Yachtmaster Offshore), American Sailing / ASA (101, 103-106, and 108), and US Sailing (Basic Keelboat, Basic/Bareboat Cruising, Coastal Navigation, and Coastal Passage Making). Compare like with like: shorebased theory and exam knowledge are not equivalent to practical certification skills. For each area, classify it as covered, partial, not represented, or an advanced/specialist extension. A missing practical outcome is not by itself a factual defect in this knowledge exam.

### Crosswalk

| Current topic ID | Benchmark finding and disposition |
| --- | --- |
| `colregs_steering_rules` | Covered. RYA, ASA and US Sailing cruising pathways include navigation rules and collision avoidance; continue checking keyed encounter assumptions and regional rules. |
| `colregs_rule_19d` | Covered. Restricted-visibility rules are in scope; practical fog tactics and radar operation are candidate extensions, not evidence that the rule topic is absent. |
| `colregs_lights_shapes` | Covered. Lights, shapes, sound and distress signals align with the cited curricula; keep International/Inland distinctions explicit. |
| `nav_compass_leeway` | Core covered. US Sailing/ASA also teach chart references and traditional plotting; chart corrections, Notices to Mariners and navigation-log use are candidate additions. |
| `nav_dr_ep_fixes` | Core covered. Fixes, vectors and course-to-steer are represented; running fixes, hand-bearing compass and explicit electronic-navigation limitations are not. |
| `tides_heights_clearance` | Covered. Tidal-height and under-keel-clearance calculations align with cruising/navigation standards; keep datum and source-prediction assumptions explicit. |
| `tides_diamonds_cts` | Covered. Set/drift, interpolation and course-to-steer limits align; future examples should use current local references and clearly state interpolation assumptions. |
| `met_depressions_fronts` | Partial. Pressure/front concepts are present; forecast-source comparison, barometer use, squalls and local geographic effects appear in advanced cruising standards and merit review. |
| `met_local_fog` | Partial. Sea breeze and fog formation are represented; broaden to operational fog decisions and the effect of local conditions if the chosen learner level requires them. |
| `plan_solas_pilotage` | Partial. Passage appraisal/planning and pilotage are represented; current chart/publication checks, logkeeping, forecast sourcing and crew/watch planning need explicit disposition. |
| `plan_tidal_gates_bars` | Covered with a regional-data limitation. Gates, bars and abort choices are represented; the report correctly defers numeric Bristol Channel/Severn examples until checked against current local sources. |
| `emerg_mob_heavy_weather` | Partial. MOB and heavy-weather theory are present; practical recovery drills, reefing/sail handling, crew/watch management and a wider failure-response set belong in follow-up review. |
| `emerg_anchoring_distress` | Partial. Scope, towing and MAYDAY/PAN-PAN are represented; anchor-type/dragging responses, VHF/DSC operation, safety equipment, fire/flood/steering/engine failures and first aid need explicit knowledge-versus-practical dispositions. |

Across the benchmark, practical handling (sail trim, docking, line handling, equipment checks, and onboard engine/electrical/bilge systems) is assessed separately by the certification bodies. Celestial navigation, ocean routing, night watches, radar and offshore survival are advanced or specialist extensions, not automatic requirements for this knowledge Exam.

### Benchmark Conclusion

The current topic set has a sound core for navigation and rules-focused cruising theory, but it does not represent the full practical competence assessed by RYA Yachtmaster Offshore or the complete progression offered by ASA and US Sailing. The clearest candidate knowledge gaps are chart/publication maintenance and electronic-navigation limitations; weather-source assessment and squalls; vessel systems and failure scenarios; and a broader emergency-equipment/distress-response inventory. Add or defer each item deliberately in a follow-up scope decision; do not broaden this accuracy issue by silently turning a theory exam into a practical certification syllabus.

The comparison is a breadth screen, not proof that all facts within covered topics are correct. Every topic, question, generated distractor, scenario, and answer key still needs the source-by-source review required by issue #23.

## Findings and Changes

- Rule 33's first generated key point incorrectly said bells are required from 12 meters. The corrected thresholds are a whistle from 12 meters, a bell from 20 meters, and a gong from 100 meters. A generated-bank regression test covers the corrected key point.
- The attention-light check used International Rule 36 wording without identifying the regime. It now says International Rule 36 explicitly and includes the restriction on confusing lights and the warning to avoid high-intensity intermittent or revolving lights.
- The long-tow check now identifies Rule 24(a)'s towing-vessel arrangement and distinguishes it from Rule 24(g)'s separate treatment of inconspicuous, partly submerged tows.
- The authored long-tow curriculum explanation incorrectly assigned Rule 24(a)'s diamond to the tow as well as the towing vessel. It now distinguishes Rule 24(a) from Rule 24(g), with a generated-answer regression test.
- The long-tow scenario now states that the vessel is towing astern and defines tow length from the towing vessel's stern to the after end of the tow, matching Rule 24(a)'s 200-meter threshold. The Rule 19 fog-signal scenario names Rule 35(c)'s one-prolonged/two-short pattern and Rule 19(e)'s exception when collision risk is ruled out.
- The Rule 19(e) answer's required keywords now match its canonical wording: minimum speed to maintain course and extreme caution, rather than the separate term minimum steerageway.
- A bank-wide grading check also exposed authored answers that failed their own keyword rubric. Corrected the Rule 25 underway explanation, cocked-hat danger-side phrase, tidal-height and stream-rate units, and a tidal-rate forbidden phrase that incorrectly rejected one of the values required in the worked interpolation.
- The shallow-bar answer now requires reassessing at slack water against current conditions and local pilot guidance; it explicitly avoids treating the flood as an automatic safe-entry window.
- The answer-rubric regression pass now covers all 26 authored questions and has corrected mismatches in COLREGs, navigation, tides, weather, and passage-planning answers. It does not replace the remaining source-by-source review of generated Exam distractors and scenarios.
- The anchor-light answer now distinguishes the optional single all-round white light for a vessel under 50 meters from Rule 30(a)'s two-light arrangement.
- The restricted-visibility answer now includes the gong after the bell for anchored vessels 100 meters or more, while retaining the additional bell strokes required when aground.
- The anchored-vessel fog check now specifies a vessel 20 meters or more, avoiding omission of Rule 35's alternate sound-signal provisions for smaller vessels.
- The MOB curriculum previously generalized that a leeward-side pickup is preferred. It now teaches the RYA's upwind approach guidance and requires adapting to wind, sea state, current, vessel handling, and propeller risk.
- The heaving-to answer no longer requires a universal helm direction; it accepts a backed headsail, eased main, and vessel-specific helm balance.
- The warm-front answer no longer requires a specific backing-wind timing that was not supported by the accessible primary sources; it retains falling-pressure and cloud-development cues and directs learners to current observations and forecasts.
- The compass correction remains 272 degrees compass (275 degrees magnetic minus 3 degrees east deviation); the Exam bank rejects the former incorrect 266-degree result.
- The transit-mark answer was checked geometrically and remains unchanged: being to starboard of the transit calls for steering to port to regain it.

## Sources

- [USCG Navigation Rules, International and U.S. Inland](https://www.navcen.uscg.gov/navigation-rules-amalgamated). The page marks regime-specific wording and records a November 16, 2026 update.
- [NOAA Tidal Datums](https://tidesandcurrents.noaa.gov/datum_options.html), for datum definitions and the limits on applying local tidal-datum relationships elsewhere.
- [NOAA United States Coast Pilot](https://nauticalcharts.noaa.gov/publications/coast-pilot/index.html), for the official publication's scope across coastal hazards, channels, anchorages, tides, currents, and related navigation information.
- [ADMIRALTY Tide Tables](https://www.admiralty.co.uk/publications/publications-and-reference-guides/admiralty-tide-tables), the UKHO source for port tidal predictions; RYA also identifies UKHO EasyTide as a source of short-term predictions.
- [NOAA JetStream Norwegian Cyclone Model](https://www.noaa.gov/jetstream/synoptic/norwegian-cyclone-model), for general frontal development and precipitation context.
- [Royal Yachting Association: Man overboard](https://www.rya.org.uk/knowledge/safety/man-overboard/), for the upwind approach guidance and casualty recovery considerations.
- [RYA passage planning](https://www.rya.org.uk/water-safety/passage-planning-and-navigation/passage-planning/), for current charts and pilot books, tides and currents, hazards, constraints, refuge, weather, crew preparation, and shared plans.
- [RYA Notices to Mariners](https://www.rya.org.uk/water-safety/passage-planning-and-navigation/notices-to-mariners/), for UKHO, lighthouse authority, local port, and activity-specific navigational updates.
- [RYA weather and tides](https://www.rya.org.uk/water-safety/weather-and-tides/weather-and-tides/), for forecast cross-checking, tide-prediction use, and UT/BST convention cautions.
- [RYA navigation lights and sound signals](https://www.rya.org.uk/water-safety/passage-planning-and-navigation/navigation-lights/), for sound-appliance length thresholds and attention-light guidance.
- [UKHO ADMIRALTY Tide Tables (NP201-208)](https://www.admiralty.co.uk/publications/publications-and-reference-guides/admiralty-tide-tables), for port tidal predictions. RYA also identifies UKHO EasyTide as a short-term prediction source.
- [RYA Day Skipper Theory](https://www.rya.org.uk/course-finder/day-skipper-theory-course/), for the theory-course scope in chartwork, navigation, meteorology, and seamanship.
- [RYA Yachtmaster Offshore Exam](https://www.rya.org.uk/training/certificates-of-competence/yachtmaster-offshore-exam/), for exam scope and the RYA Scheme Syllabus and Logbook (G158) reference. The public page states the exam is practical and includes skippering, boat handling, seamanship, navigation, safety awareness, IRPCS, meteorology, and signals.
- [American Sailing certification standards](https://americansailing.com/learn-to-sail/certifications/), including [ASA 101](https://americansailing.com/certifications/asa-101-keelboat-sailing-1/), [ASA 103](https://americansailing.com/certifications/asa-103-coastal-cruising/), [ASA 104](https://americansailing.com/certifications/asa-104-bareboat-cruising/), [ASA 105](https://americansailing.com/certifications/asa-105-coastal-navigation/), [ASA 106](https://americansailing.com/certifications/asa-106-advanced-coastal-cruising/), and [ASA 108](https://americansailing.com/certifications/asa-108-offshore-passagemaking/).
- [US Sailing Adult Certification Courses](https://www.ussailing.org/education/adult/), with published standards for [Basic Keelboat](https://www.ussailing.org/education/adult/certification-courses-endorsements/basic-keelboat/), [Basic Cruising](https://www.ussailing.org/education/adult/certification-courses-endorsements/basic-cruising/), [Bareboat Cruising](https://www.ussailing.org/education/adult/certification-courses-endorsements/bareboat-cruising/), [Coastal Navigation](https://www.ussailing.org/education/adult/certification-courses-endorsements/coastal-navigation/), and [Coastal Passage Making](https://www.ussailing.org/education/adult/certification-courses-endorsements/coastal-passage-making/).

## Limits

This is an educational content review, not an operational navigation approval or substitute for current charts, notices, local rules, or official publications. Regional and training notes should be checked against the relevant authority and the passage area. The USCG amalgamated page itself disclaims guarantees of accuracy; use the current official rule text when making real-world decisions.

The detailed source pass has not yet verified every authored curriculum answer against its named syllabus authority. The regional target is now set to the British Isles; use UKHO charts, tide tables, tidal stream products, and relevant local publications to verify the selected Bristol Channel/Severn Estuary examples.

## Questions for Review

- No further decision is needed for this audit pass. The possible ASA selectable profile is a future product choice; the British Isles region and RYA-first curriculum are recorded above.