# Exam Accuracy Audit (#23)

## Scope

The Exam inventory contains COLREGs Rules 1-41, Annexes I-IV, and 13 curriculum topics with 26 authored questions. The COLREGs catalog supplies three key-point checks and one scenario for each of its 45 entries. The inventory and coverage paths were reviewed; the detailed source-based accuracy pass is still in progress and has prioritized rule scope, International/Inland differences, safety-critical thresholds, signal patterns, and answer keys. This document does not claim that every generated answer has been independently certified.

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

## Findings and Changes

- Rule 33's first generated key point incorrectly said bells are required from 12 meters. The corrected thresholds are a whistle from 12 meters, a bell from 20 meters, and a gong from 100 meters. A generated-bank regression test covers the corrected key point.
- The attention-light check used International Rule 36 wording without identifying the regime. It now says International Rule 36 explicitly and includes the restriction on confusing lights and the warning to avoid high-intensity intermittent or revolving lights.
- The long-tow check now identifies Rule 24(a)'s towing-vessel arrangement and distinguishes it from Rule 24(g)'s separate treatment of inconspicuous, partly submerged tows.
- The authored long-tow curriculum explanation incorrectly assigned Rule 24(a)'s diamond to the tow as well as the towing vessel. It now distinguishes Rule 24(a) from Rule 24(g), with a generated-answer regression test.
- The anchor-light answer now distinguishes the optional single all-round white light for a vessel under 50 meters from Rule 30(a)'s two-light arrangement.
- The restricted-visibility answer now includes the gong after the bell for anchored vessels 100 meters or more, while retaining the additional bell strokes required when aground.
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

## Limits

This is an educational content review, not an operational navigation approval or substitute for current charts, notices, local rules, or official publications. Regional and training notes should be checked against the relevant authority and the passage area. The USCG amalgamated page itself disclaims guarantees of accuracy; use the current official rule text when making real-world decisions.

The detailed source pass has not yet verified every authored curriculum answer against its named syllabus authority. The regional target is now set to the British Isles; use UKHO charts, tide tables, tidal stream products, and relevant local publications to verify the selected Bristol Channel/Severn Estuary examples.

## Questions for Review

- No further decision is needed for this audit pass. The possible ASA selectable profile is a future product choice; the British Isles region and RYA-first curriculum are recorded above.