# WatchWatcher — Autonomous Build Specification for GitHub Copilot

## Approved Evaluation Privacy Decision

The current Angular/API implementation requires explicit, informed, per-answer consent before sending a learner's topic, question context, and answer to Google Gemini. Consent is off by default, is not persisted, and must be renewed after editing, navigation, submission, logout, or an account change. The authenticated API requires `onlineConsent: true` and rejects older requests; the provider receives only `topicId`, `context`, and `answer`, never consent, account identity, or progress. Provider errors return 503 without free-text fallback. Learners can skip a free-text answer ungraded or use the existing offline structured-choice exercises. This decision supersedes any older Flutter or keyword-grading instructions below.

Guests can use the structured COLREGs practice and reference without an account; guest and account local progress are separate and guest progress is not automatically uploaded. Valid online evaluations are limited to a proposed 30 per account per hour in PostgreSQL, using scoped HMAC identifiers; limiter failure is closed. Trusted IP and aggregate abuse controls remain unresolved. The provider must explicitly indicate whether a critical safety failure exists and give a consistent reason; uncertain or invalid results are not graded. Passing requires both the score threshold and an explicit no-critical-failure judgment. This judgment is fallible AI output, not authoritative navigation guidance. Answers longer than 12,000 characters after trimming must be shortened before submission.

## 1. Project Overview & Identity
- **App Name:** WatchWatcher
- **Package / Slug:** `watch_watcher`
- **Repository Target:** `WatchWatcher` (GitHub-ready with `.gitignore`, `README.md`, and `.github/workflows/ci.yml`)
- **Primary Platforms:** Cross-platform Flutter (`Android`, `Linux/Desktop`, `Web`) built with an **offline-first architecture** so training, COLREGs reference lookup, visual vector/encounter simulations, deterministic grading, and local progress work without internet connectivity. Optional sign-in, PostgreSQL progress sync, and Gemini grading are online enhancements, not prerequisites for study.
- **Domain & Purpose:** An adaptive, Socratic **RYA Yachtmaster Offshore & ASA (105/106/108) Examiner & Visual Trainer**. It guides a sailor through structured modules, evaluates free-text and scenario answers against strict safety thresholds, logs misconceptions into a longitudinal student knowledge base, and dynamically renders deterministic vector charts and animated COLREGs encounters.

---

## 2. Core Functional Requirements

### A. Offline-First Grounded Syllabus & Reference Corpus
1. **Six Core Modules (`assets/syllabus/curriculum_seed.json`):**
   - **Module 1:** COLREGs / IRPCS (Rules 5–19, 20–31 lights/shapes, 32–37 sound/distress signals, Rule 19 restricted visibility).
   - **Module 2:** Chartwork & Terrestrial Navigation (True/Magnetic/Compass conversions, leeway, DR `+`, EP `△`, 3-point & running fixes, Course to Steer CTS, electronic navigation pitfalls).
   - **Module 3:** Tidal Heights & Tidal Streams (Primary/Secondary ports, Rule of Twelfths, tidal curves, tidal diamonds, under-keel clearance).
   - **Module 4:** Marine Meteorology (Synoptic charts, Buys Ballot's Law, warm/cold/occluded fronts, sea breezes, advection/radiation fog, Beaufort scale).
   - **Module 5:** Passage Planning & Pilotage (SOLAS V Reg 34 obligations, tidal gates, bolt holes, transits/leading lines, clearing bearings `NMT`/`NLT`).
   - **Module 6:** Heavy Weather, Boat Handling & Emergencies (Storm tactics, MOB recovery leeward pickup, anchoring/mooring in tidal streams, towing, Mayday/DSC/EPIRB distress).
2. **RYA vs. ASA Dual-Mode Toggle:**
   - Global UI switch (`RYA` | `ASA`) that adapts terminology, buoyage notes (IALA Region A vs. B), chart datum references (LAT vs. MLLW), and USCG Inland vs. International COLREGs notes.
3. **Offline COLREGs Reference and Practice:**
  - Bundle `assets/reference/colregs_catalog.json` containing all 41 numbered provisions and Annexes I–IV, with searchable original study points and one scenario exercise per entry for offline practice.

### B. Threshold-Gated Examiner & Adaptive Remediation Loop
1. **Dual-Mode Grading Engine (`ExaminerAiService`):**
  - **Online Mode (Gemini Structured JSON Output):** With explicit per-answer consent and an authenticated session, send the topic, grounded question context, and answer to `POST /api/exam/evaluate`. The API calls `gemini-2.5-flash` with its server-side key and returns structured feedback. Do not send account or weak-spot history to the provider.
  - **Offline Mode:** Use structured-choice exercises or skip free-text answers ungraded. Do not substitute keyword-based free-text grading when online evaluation is unavailable.
2. **Progression Gate:**
   - Each module defines a `pass_threshold` (e.g., `0.85` for COLREGs and Emergencies; `0.80` for Navigation, Tides, Meteorology, Passage Planning).
   - If `score < pass_threshold`:
     - Lock progression to the next topic.
     - Log the `misconception_tag` into the student's persistent knowledge base.
     - Display the **Deep Remediation Card** + interactive visual aid.
     - Require passing a retry or variant verification check before unlocking the next node.

### C. Longitudinal Student Knowledge Base (`StudentMemoryService`)
- Persist the working copy locally using `shared_preferences`, behind a `StorageRepository` interface. Local progress remains available when signed out or offline; when signed in, synchronize it with the account-scoped PostgreSQL snapshot through the API. Do not make cloud access necessary for recording or reviewing progress:
  - `topic_mastery`: Map of `topic_id -> double` (exponential moving average of scores).
  - `weak_spot_log`: Chronological list of unresolved misconceptions (`topic_id`, `topic_title`, `tag`, `timestamp`).
  - `drill_queue`: Spaced-repetition queue that surfaces past weak spots as "Surprise Examiner Drills."
  - `rule_exercise_attempts`: Append-only COLREGs exercise events (`id`, `ruleId`, `selectedOptionId`, `correct`, `attemptedAt`). Attempt count, accuracy, completion (at least one correct answer), and last-attempt time are derived per rule from these events.
- Namespace IndexedDB snapshots by authenticated account ID; keep guest data in a separate namespace. Upgrade the legacy shared `current` snapshot to guest-only storage and never assign it to whichever account signs in next.
- When signed in, merge local and cloud snapshots by stable attempt ID before syncing with the existing revision contract. Duplicate events are idempotent; if sync fails or conflicts, retain the merged local copy and reconcile on a later sync attempt.

### D. Account, Authentication & Cloud Progress Sync
- Sign-in is optional for using the app and required only for account-scoped cloud sync and online Gemini evaluation.
- Implement `POST /api/auth/session` to exchange credentials for an `accountId` and session. Store session credentials using platform secure storage, not `SharedPreferences`.
- Implement `GET /api/progress` and `PUT /api/progress` for the signed-in account's `topicMastery`, `weakSpotLog`, and `drillQueue`. Include a revision on writes; a stale revision returns `409`. A failed or conflicting sync must never discard the local snapshot.
- Store cloud progress in PostgreSQL, partitioned by authenticated account. Keep the local copy usable and writable regardless of API availability.
- The Azure Functions API uses `DATABASE_URL`, `GEMINI_API_KEY`, and `AzureWebJobsStorage` configuration. The Flutter client must not contain database credentials or the Gemini key.

### E. Deterministic Visual Aid & Animation Engine (No External GIF Dependencies)
Because navigation diagrams require exact geometric proportions (e.g., a 6.0 NM water track must be strictly twice a 3.0 NM tidal vector), render all visual aids programmatically via `CustomPainter` and `AnimationController`:
1. **`ChartVectorCanvas` & `ChartVectorSandbox`:**
   - Draws an Admiralty-style chart grid with proportional vectors using standard RYA symbols:
     - Known Fix: `⊙`
     - Water Track (`1 arrow >`) ending at Dead Reckoning `DR (+)`
     - Tidal Vector (`3 arrows >>>`) from DR ending at Estimated Position `EP (△)`
     - Ground Track (`2 arrows >>`) from Fix to EP, displaying live calculated `COG (°T)` and `SOG (kn)`.
   - Interactive sandbox sliders for `Boat Speed (kn)`, `Water Heading (°T)`, `Tide Rate (kn)`, and `Tide Set (°T)` with an automatic warning banner when `tideRate > boatSpeed` (physically impossible direct perpendicular crossing).
2. **`ColregsAnimatedView`:**
   - **Radar Fog Encounter Mode (`Rule 19(d)`):** Looping radar display animating a steady-bearing target on the port bow (`315°` relative), showing a dashed red warning arc for an illegal port turn vs. a green bold starboard turn.
   - **Night Lights & Aspect Mode (`Rules 23–27`):** Animated glowing masthead/sidelight stack on a night horizon with toggleable vessel presets (Sailing `Red/Green`, Fishing `Red/White`, Trawling `Green/White`, NUC `Red/Red`, RAM `Red/White/Red`, Pilot `White/Red`).

---

## 3. Target Directory & File Structure

Create the exact folder and file hierarchy below inside the root workspace:

```text
WatchWatcher/
├── .github/
│   └── workflows/
│       └── ci.yml                          # Flutter analyze, unit/widget tests, Linux/Web build check
├── .gitignore                              # Standard Flutter/Dart/IDE ignores + .env protection
├── README.md                               # Architecture overview, offline design, setup & CLI commands
├── pubspec.yaml                            # Flutter dependencies, local storage, secure session storage, and HTTP client
├── services/
│   └── watchwatcher-api/
│       ├── host.json                       # Azure Functions host configuration
│       ├── package.json                    # TypeScript API dependencies and Vitest scripts
│       ├── src/functions/                  # Health, session, progress, and exam evaluation routes
│       ├── src/services/                   # Authentication, PostgreSQL, and Gemini integrations
│       └── tests/                          # API route and service tests
├── assets/
│   ├── syllabus/
│   │   └── curriculum_seed.json            # Full 6-module RYA/ASA syllabus, thresholds & remediation
│   └── reference/
│       └── colregs_catalog.json            # Searchable offline Rules 1–41, Annexes I–IV, and exercises
├── lib/
│   ├── main.dart                           # App bootstrap, Material 3 nautical theme, responsive navigation
│   ├── models/
│   │   └── training_models.dart            # SyllabusStandard, ModuleNode, TopicNode, QuestionItem, VisualSpec, ExaminerEvaluation
│   ├── services/
│   │   ├── syllabus_repository.dart        # Loads & caches curriculum_seed.json and colregs_catalog.json
│   │   ├── student_memory_service.dart     # Local persistence of mastery scores, weak spots & drill queue
│   │   ├── auth_service.dart                # Optional sign-in and secure session handling
│   │   ├── progress_sync_service.dart       # Revision-aware optional cloud progress sync
│   │   └── examiner_ai_service.dart        # API-backed Gemini evaluator + offline rubric fallback
│   ├── screens/
│   │   ├── study_desk_screen.dart           # Home dashboard for next topic, mastery, weak spots, and sync/offline status
│   │   ├── examiner_workspace_screen.dart  # Visual canvas and threshold-gated exam UI
│   │   ├── syllabus_map_screen.dart        # Module progress tree, mastery percentages & weak-spot drill launcher
│   │   └── colregs_reference_screen.dart   # Instant offline searchable 72 COLREGs & lights/shapes cheat-sheet
│   └── widgets/
│       ├── chart_vector_canvas.dart        # Exact-scale DR/EP/CTS CustomPainter + interactive sliders
│       └── colregs_animated_view.dart      # Animated Rule 19 radar plot & night navigation lights visualizer
└── test/
    ├── navigation_math_test.dart           # Unit tests for DR/EP vector math, COG/SOG & impossible CTS detection
  ├── offline_examiner_test.dart          # Unit tests for threshold gates, misconception logging & remediation triggers
  ├── study_desk_test.dart                 # Signed-out/offline home, loading, and progress summary states
  └── progress_sync_service_test.dart      # Successful sync, API failure, and revision-conflict preservation

```markdown
# WatchWatcher — Step 4: Detailed Data Schemas, Mathematics, UI & Test Specifications

This document provides the complete, implementation-ready specifications for **Step 4** of the **WatchWatcher** (`watch_watcher`) offline-first Flutter application. It contains full schemas, reference datasets, trigonometric vector formulas, UI architecture, automated unit/widget test blueprints, and GitHub Actions CI/CD definitions so GitHub Copilot can generate zero-stub production code.

---

## 4.1 Complete JSON Schema & Seed Data: `assets/syllabus/curriculum_seed.json`

### Schema Definition
Every module, topic, visual aid configuration, and threshold-gated question must adhere to this exact structure:

```json
{
  "app_name": "WatchWatcher",
  "version": "1.0.0",
  "modules": [
    {
      "id": "string (unique snake_case module ID)",
      "title": "string (display title)",
      "pass_threshold": "number (0.0 to 1.0, e.g. 0.85)",
      "topics": [
        {
          "id": "string (unique snake_case topic ID)",
          "rule_ref": "string (IRPCS / RYA / SOLAS / ASA citation)",
          "title": "string (topic heading)",
          "summary": "string (concise, first-principles technical briefing)",
          "asa_note": "string (USCG Inland / ASA 105-108 comparative nuance)",
          "visual_spec": {
            "type": "colregs_encounter | colregs_lights | chart_vector_sandbox | none",
            "params": {}
          },
          "questions": [
            {
              "id": "string (unique question ID)",
              "prompt": "string (situational offshore/coastal examiner dilemma)",
              "expected_keywords": ["string (required concept tokens for offline rubric)"],
              "forbidden_keywords": ["string (critical safety errors triggering immediate fail)"],
              "correct_explanation": "string (affirmation + rule citation)",
              "deep_remediation": "string (step-by-step corrective breakdown when score < threshold)"
            }
          ]
        }
      ]
    }
  ]
}

```

### Required 6-Module Curriculum Coverage (Minimum 12 Topics, 24 Questions)

1. **`mod_1_colregs` — Module 1: COLREGs / IRPCS (`pass_threshold: 0.85`)**
* **`colregs_steering_rules` (Rules 5, 7, 8, 12, 13, 14, 15, 18):**
* *Summary:* Look-out by all means; CBDR risk assessment; bold early alterations; sailing tacks (port gives way to starboard, windward to leeward; Rule 12(a)(iii) uncertain tack at night gives way); Rule 18 hierarchy (`NUC > RAM > CBD > Fishing > Sailing > Power`); motor-sailing counts as power-driven and requires a black cone apex down (Rule 25(e)); Rule 17 stand-on vessel 3-stage escalation.
* *ASA Note:* Identical under 72 COLREGs; highlight Rule 34 USCG Inland intent signals (`1 short` = leave on port side) vs. International rudder-action signals.
* *Questions:* (1) Motor-sailing close-hauled on starboard tack converging with a pure sailboat on port tack; (2) Overtaking 200m cargo ship astern failing to alter course (Rule 13 + Rule 17 stages).


* **`colregs_rule_19d` (Rules 19 & 35 — Restricted Visibility):**
* *Visual Spec:* `{ "type": "colregs_encounter", "params": { "scenario": "rule_19_fog_port_bow", "own_heading": 0, "target_bearing": 315, "recommended_turn": "starboard" } }`
* *Summary:* Rules 11–18 do not apply when not in sight; no stand-on vessel; safe speed with engine ready; Rule 19(d) prohibits turning to **port** for a target forward of the beam (unless overtaking) and prohibits turning **toward** a target abeam or abaft the beam; Rule 19(e) drop to bare steerageway on hearing fog signal forward of the beam; Rule 35 fog blasts (`—` power making way, `— —` power stopped, `— • •` sail/NUC/RAM/CBD/fishing/towing every $\le 2\text{ min}$).
* *Questions:* (1) Steady radar target at `315°` relative (port bow) in dense fog—turn starboard, never port; (2) Hearing `— • •` forward of the beam in 100m fog—identify candidate vessels and drop to minimum steerageway.


* **`colregs_lights_shapes` (Rules 20–31 & Annex IV Distress):**
* *Visual Spec:* `{ "type": "colregs_lights", "params": { "top_light": "red", "mid_light": "green", "bottom_light": "none", "sidelight": "red", "label": "Sailing Vessel Underway (Port Aspect)" } }`
* *Summary:* Running light arcs (masthead $225^\circ$, sidelights $112.5^\circ$, sternlight $135^\circ$); $\ge 50\text{m}$ two masthead lights; Sailing (`Red/Green` optional masthead); Trawling (`Green/White`, hourglass); Fishing (`Red/White`, hourglass); Pilot (`White/Red`, Flag H); NUC (`Red/Red`, 2 balls); RAM (`Red/White/Red`, Ball-Diamond-Ball); CBD (`Red/Red/Red`, cylinder); Tow $>200\text{m}$ (3 masthead lights + Black Diamond on tug & tow). Sidelights/masthead lights only on when making way.
* *Questions:* (1) `Red-over-Green` above a single `Red` sidelight (sailing vessel, port aspect, not motor-sailing); (2) Tug with `Ball-Diamond-Ball` + `Black Diamond` towing barge with `Black Diamond` (RAM + tow $>200\text{m}$).




2. **`mod_2_chartwork` — Module 2: Chartwork & Terrestrial Navigation (`pass_threshold: 0.80`)**
* **`nav_compass_leeway` (True, Magnetic, Compass & Leeway):**
* *Summary:* `TVMDC` conversion: True $\rightarrow$ Compass **Add West, Subtract East** (*"True Virgins Make Dull Company — Add Whisky"*); Compass $\rightarrow$ True reverse signs. Update chart Variation using annual rate of change. Apply Leeway by steering **into** the wind from Water Track to True Heading.
* *Questions:* (1) Annual variation update (`4° 15' W` in 2020 increasing `10' W` annually to 2026 = `5° 15' W`); (2) Full conversion (`270° T` water track, `6°` leeway from South wind, `5° W` var, `3° E` dev $\rightarrow$ `266° C`).


* **`nav_dr_ep_fixes` (DR `+`, EP `△`, Cocked Hats & GPS Pitfalls):**
* *Visual Spec:* `{ "type": "chart_vector_sandbox", "params": { "water_heading": 0, "water_speed": 6.0, "tide_set": 90, "tide_rate": 3.0, "hours": 1.0 } }`
* *Summary:* Water track (`>`) $\rightarrow$ DR (`+`); add Tidal vector (`>>>`) $\rightarrow$ EP (`△`); Fix (`⊙`) to EP (`△`) = Ground track (`>>`, COG/SOG). 3-point fix cocked hat: always navigate from the corner closest to danger. GPS pitfalls: WGS84 vs. local chart datum, vector over-zooming, COG vs. Heading in cross-currents.
* *Questions:* (1) `090° T` at `6.0 kn` + `180° T` tide at `2.0 kn` $\rightarrow$ DR `6.0 NM` East, EP in SE quadrant, `SOG = 6.32 kn`; (2) Navigating from the danger-side corner of a `0.2 NM` cocked hat; (3) COLREGs sidelight aspect when `COG = 000° T` but `Heading = 335° T` (ship dead ahead of bow sees both sidelights).




3. **`mod_3_tides` — Module 3: Tidal Heights & Tidal Streams (`pass_threshold: 0.80`)**
* **`tides_heights_clearance` (Rule of Twelfths, Curves & Drying Heights):**
* *Summary:* Semi-diurnal 6-hour tide rises/falls in twelfths (`1/12, 2/12, 3/12, 3/12, 2/12, 1/12`). Clearance over drying rock = `Height of Tide - Charted Drying Height (underlined)`. Required Height of Tide = `Draft + UKC + Drying Height` (or `Draft + UKC - Charted Sounding`).
* *ASA Note:* UK/Admiralty charts reference Chart Datum to **LAT** (Lowest Astronomical Tide); US/NOAA charts (ASA 105) reference **MLLW** (Mean Lower Low Water).
* *Questions:* (1) Rule of Twelfths height calculation (`LW 1.0m`, `HW 7.0m`, 2 hours after LW = `2.5m`); (2) Safe passage time over a rock drying `1.8m` with `2.0m` draft and `1.0m` UKC (need `4.8m` Height of Tide).


* **`tides_diamonds_cts` (Tidal Diamonds, Atlases & Impossible CTS):**
* *Summary:* Interpolate between Neap and Spring rates on chart Tidal Diamonds based on daily tidal range. Course to Steer (CTS) triangle: plot Tide (`>>>`) from Fix (`⊙`), swing arc of Boat Speed (`>`) onto desired Ground Track (`>>`). If `Tide Rate > Boat Speed` on a perpendicular crossing, no direct straight-line intersection exists—use tidal gates or ferry-glide S-curves.
* *Questions:* (1) Interpolating mid-range tidal rate between `1.4 kn` Neaps and `2.8 kn` Springs (`2.1 kn`); (2) Decision-making when a `3.0 kn` yacht faces a `4.0 kn` perpendicular cross-tide.




4. **`mod_4_meteorology` — Module 4: Marine Meteorology (`pass_threshold: 0.80`)**
* **`met_depressions_fronts` (Buys Ballot's Law & Frontal Passages):**
* *Summary:* Northern Hemisphere Buys Ballot's Law: back to the wind, Low pressure is on your **LEFT** (Southern Hemisphere: right). Warm front: cirrus $\rightarrow$ cirrostratus $\rightarrow$ altostratus $\rightarrow$ nimbostratus, falling pressure, steady rain, wind **veers** (clockwise). Cold front: squalls, cumulonimbus, heavy showers, rapid pressure rise, sharp wind **veer**.
* *Questions:* (1) Facing SW wind (`225°`) in English Channel—Low lies NW (left), cold front causes wind to veer clockwise; (2) Interpreting sudden barometric drop (`> 3 hPa / 3 hrs`) + backing wind ahead of a warm front.


* **`met_local_fog` (Sea Breezes & Fog Formation):**
* *Summary:* Sea breeze forms on sunny afternoons when land heats faster than sea (air rises over land, drawing cool marine air onshore, peaking mid-afternoon and dying after sunset). **Advection fog** forms when warm moist air moves over cold sea water (persists day and night, dispersed only by wind shift/airmass change); **radiation fog** forms over land on clear calm nights and burns off after sunrise.
* *Questions:* (1) Why advection fog over cold coastal waters does not burn off at midday; (2) Expected coastal wind shift and strength on a hot sunny afternoon with light gradient wind.




5. **`mod_5_passage_planning` — Module 5: Passage Planning & Pilotage (`pass_threshold: 0.80`)**
* **`plan_solas_pilotage` (SOLAS V Reg 34, Transits & Clearing Bearings):**
* *Summary:* SOLAS V Regulation 34 legally requires all pleasure vessels to plan voyages beyond local waters (Appraisal, Planning, Execution, Monitoring), identifying tidal gates, bolt holes, and escape routes. Pilotage transits: *"Follow the rear mark"* (if rear beacon moves left of front beacon, boat is to the right $\rightarrow$ steer left). Clearing bearings (`NMT` / `NLT`) keep vessel clear of unlit hazards without plotting.
* *ASA Note:* RYA tests SOLAS V legal accountability; ASA 106/108 emphasizes formal Float Plans and waypoint leg sheets.
* *Questions:* (1) Rear transit beacon drifting left of front beacon—identify drift direction (starboard) and helm correction (port); (2) Using a `NMT 045° T` clearing bearing off a rocky headland.


* **`plan_tidal_gates_bars` (Wind Against Tide & Night Entry):**
* *Summary:* Strong onshore wind opposing an ebbing river/harbor tide creates steep, short, breaking waves over shallow bars—risking broaching or pitchpoling. Conservative Yachtmaster option: heave-to or stand off in deep water until slack water or flood tide.
* *Questions:* (1) Approaching a shallow river bar at night in onshore Force 6 against a spring ebb—assess hazard and choose safe action.




6. **`mod_6_seamanship_emergencies` — Module 6: Heavy Weather, Boat Handling & Emergencies (`pass_threshold: 0.85`)**
* **`emerg_mob_heavy_weather` (MOB Recovery & Storm Tactics):**
* *Summary:* MOB immediate actions: shout, deploy danbuoy/lifebuoy, press DSC/GPS MOB, assign dedicated spotter, start engine, recover with casualty on **LEEWARD** side so hull does not drift onto casualty. Heavy weather options: early reefing, storm jib/trysail, heaving-to (backed headsail + sheeted main + helm lashed to leeward), running off / trailing warps.
* *Questions:* (1) Why MOB pickup must place the casualty on the leeward side; (2) Sail and helm configuration to heave-to in a rising gale.


* **`emerg_anchoring_distress` (Anchoring Scope, Towing & Mayday):**
* *Summary:* Minimum anchoring scope: **4:1** for all-chain, **6:1** for rope/chain combo (measured from bow roller to seabed at **High Water**, plus storm allowance). Towing: bridle attachment, long nylon warp for elasticity, chafing gear, tug shows towing lights (`>200m` tow = 3 masthead lights + diamonds). Distress: `MAYDAY` (grave and imminent danger), `PAN-PAN` (urgency), DSC red button + voice Mayday (`MIPDANIO`: Mayday x3, Vessel name/callsign/MMSI, Position, Nature of distress, Assistance required, Number of souls, Other info, Over).
* *Questions:* (1) Calculating minimum all-chain scope in `8.0m` chart depth with `4.0m` HW tide and `1.5m` bow roller height (`(8+4+1.5) * 4 = 54m`); (2) Difference between `MAYDAY` and `PAN-PAN` and exact `MAYDAY` call structure.





---

## 4.2 Legacy COLREGs Reference Examples

The examples below are historical design notes, not the current data contract. The canonical offline catalog schema is defined after them.

```json
{
  "rules": [
    {
      "rule_number": "Rule 5",
      "title": "Look-out",
      "category": "Steering & Sailing",
      "summary": "Every vessel shall at all times maintain a proper look-out by sight and hearing as well as by all available means appropriate in the prevailing circumstances and conditions (radar, AIS, VHF).",
      "memory_hook": "Eyes, ears, radar, and AIS—never leave the helm unguarded.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 7",
      "title": "Risk of Collision",
      "category": "Steering & Sailing",
      "summary": "Every vessel shall use all available means to determine if risk of collision exists. If there is any doubt, such risk shall be deemed to exist. Risk exists if the compass bearing of an approaching vessel does not appreciably change (CBDR).",
      "memory_hook": "Constant Bearing, Decreasing Range (CBDR) = Collision.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 8",
      "title": "Action to Avoid Collision",
      "category": "Steering & Sailing",
      "summary": "Any action taken to avoid collision shall be positive, made in ample time, and with due regard to good seamanship. Alterations of course and/or speed shall be large enough to be readily apparent visually or on radar; avoid a succession of small alterations.",
      "memory_hook": "Make one bold, early alteration (30°–60°), never tiny nibbles.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 9",
      "title": "Narrow Channels",
      "category": "Steering & Sailing",
      "summary": "Keep as near to the outer limit of the channel on your starboard side as is safe. Vessels <20m and sailing vessels shall not impede a vessel that can safely navigate only within a narrow channel or fairway.",
      "memory_hook": "Keep right; small craft and sailboats never impede ships in channels.",
      "asa_inland_note": "In USCG Inland waters, downbound vessels with a following current have right-of-way over upbound vessels in narrow channels (Rule 9(a)(ii))."
    },
    {
      "rule_number": "Rule 10",
      "title": "Traffic Separation Schemes (TSS)",
      "category": "Steering & Sailing",
      "summary": "Proceed in the general direction of traffic flow. Cross traffic lanes on a heading as nearly as practicable at right angles to the general direction of traffic flow (heading, not COG!). Vessels <20m or under sail shall not impede power-driven vessels following a traffic lane.",
      "memory_hook": "Cross at 90° heading (bow perpendicular to lane, regardless of tide).",
      "asa_inland_note": "Applies to IMO-adopted TSS zones."
    },
    {
      "rule_number": "Rule 12",
      "title": "Sailing Vessels",
      "category": "Steering & Sailing",
      "summary": "When two sailing vessels approach with risk of collision: (i) different tacks -> port tack gives way to starboard tack; (ii) same tack -> windward gives way to leeward; (iii) if on port tack and you see a vessel to windward at night and cannot determine her tack with certainty -> give way.",
      "memory_hook": "Port gives way to Starboard; Windward gives way to Leeward; Unsure on port at night -> Give way.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 13",
      "title": "Overtaking",
      "category": "Steering & Sailing",
      "summary": "Any vessel overtaking any other (coming up from >22.5° abaft her beam) shall keep out of the way of the vessel being overtaken—regardless of whether either vessel is power or sail.",
      "memory_hook": "Overtaking vessel ALWAYS gives way (even a sailboat overtaking a ship).",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 14 & 15",
      "title": "Head-on & Crossing Situations (Power)",
      "category": "Steering & Sailing",
      "summary": "Head-on (Rule 14): both alter course to starboard (pass port-to-port). Crossing (Rule 15): vessel which has the other on her starboard side gives way and avoids crossing ahead.",
      "memory_hook": "If to starboard red appear, 'tis your duty to keep clear.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 17",
      "title": "Action by Stand-on Vessel",
      "category": "Steering & Sailing",
      "summary": "Stage 1: Maintain course and speed. Stage 2: May take action alone as soon as it becomes apparent the give-way vessel is not taking appropriate action (do not turn port for a vessel on port side). Stage 3: Must take best action to avoid collision when collision cannot be avoided by give-way vessel alone.",
      "memory_hook": "Hold course -> May act (+ 5 short blasts) -> Must act.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 18",
      "title": "Responsibilities Between Vessels (Hierarchy)",
      "category": "Steering & Sailing",
      "summary": "Order of privilege (most privileged first): 1. NUC, 2. RAM, 3. CBD, 4. Fishing (commercial nets/trawls), 5. Sailing (pure sail), 6. Power-driven (including motor-sailing).",
      "memory_hook": "New Reels Catch Fish So Purchase (NUC, RAM, CBD, Fish, Sail, Power).",
      "asa_inland_note": "USCG Inland Rules do not include CBD (Constrained by Draft) in Rule 18."
    },
    {
      "rule_number": "Rule 19",
      "title": "Conduct of Vessels in Restricted Visibility",
      "category": "Fog & Restricted Visibility",
      "summary": "Applies when vessels are not in sight of one another. Rules 11–18 do not apply; no stand-on vessel. Safe speed, engine ready. Avoid altering course to PORT for a target forward of the beam (unless overtaking); avoid turning TOWARD a target abeam or abaft the beam. Reduce to bare steerageway when hearing a fog signal forward of the beam.",
      "memory_hook": "Forward of beam in fog -> ALWAYS Starboard. Abeam/abaft -> Turn AWAY.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 24",
      "title": "Towing and Pushing",
      "category": "Lights & Shapes",
      "summary": "Tug shows yellow towing light above white sternlight, plus 2 white masthead lights (tow <= 200m) or 3 white masthead lights (tow > 200m). If tow > 200m, BOTH tug and tow display a Black Diamond by day.",
      "memory_hook": "Tow > 200m = 3 masthead lights + Black Diamonds on both.",
      "asa_inland_note": "In USCG Inland waters, pushing ahead / towing alongside displays 2 yellow towing lights vertically."
    },
    {
      "rule_number": "Rule 25",
      "title": "Sailing Vessels Underway and Vessels Under Oars",
      "category": "Lights & Shapes",
      "summary": "Under sail: sidelights + sternlight, plus optional Red-over-Green all-round masthead lights. Under sail AND machinery (motor-sailing): treated as power-driven (white steaming light at night; 1 Black Cone apex DOWN by day).",
      "memory_hook": "Red over green, sailing machine. Cone pointing DOWN when motor-sailing.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 26",
      "title": "Fishing Vessels",
      "category": "Lights & Shapes",
      "summary": "Trawling (dragging net): Green-over-White all-round lights. Non-trawling fishing: Red-over-White all-round lights (extra white light/cone toward gear if extending >150m). Day shape for both: two cones apexes together (hourglass). Sidelights/sternlight only when making way.",
      "memory_hook": "Green over white, trawling at night; Red over white, fishing at night.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 27",
      "title": "Vessels Not Under Command (NUC) or Restricted in Ability to Maneuver (RAM)",
      "category": "Lights & Shapes",
      "summary": "NUC: Red-over-Red all-round lights; 2 Black Balls by day. RAM: Red-White-Red all-round lights; Ball-Diamond-Ball by day. Sidelights/masthead lights only when making way.",
      "memory_hook": "Red over red, the captain is dead (NUC). Red-White-Red = RAM.",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 28 & 29",
      "title": "Constrained by Draft (CBD) & Pilot Vessels",
      "category": "Lights & Shapes",
      "summary": "CBD: 3 all-round Red lights vertically + 1 Black Cylinder by day (plus power-driven lights). Pilot on duty: White-over-Red all-round lights + Flag 'H' by day.",
      "memory_hook": "Three reds = CBD cylinder. White hat, red face = Pilot.",
      "asa_inland_note": "CBD is International Rules only."
    },
    {
      "rule_number": "Rule 30",
      "title": "Anchored Vessels and Vessels Aground",
      "category": "Lights & Shapes",
      "summary": "Anchored (<50m): 1 all-round white light; 1 Black Ball by day. Anchored (>=50m): 2 all-round white lights (forward higher). Aground: Anchor light(s) + Red-over-Red; 3 Black Balls by day.",
      "memory_hook": "1 ball = anchored; 3 balls = on the shoals (aground).",
      "asa_inland_note": "Identical in USCG Inland Rules."
    },
    {
      "rule_number": "Rule 34 & 35",
      "title": "Maneuvering, Warning & Fog Sound Signals",
      "category": "Sound & Distress",
      "summary": "In sight: 1 short = altering starboard; 2 short = altering port; 3 short = astern propulsion; 5+ short = doubt/wake-up. In fog (<=2 min): 1 prolonged = power making way; 2 prolonged = power stopped; 1 prolonged + 2 short = sail, NUC, RAM, CBD, fishing, towing.",
      "memory_hook": "5 short blasts = Wake up! In fog: 1 long = power moving; 2 long = power stopped; Long-short-short = special/sail.",
      "asa_inland_note": "USCG Inland: 1 short = intent to pass port-to-port; 2 short = intent to pass starboard-to-starboard (requires agreement whistle)."
    }
  ]
}

```

---

### Current Catalog Contract

`assets/reference/colregs_catalog.json` contains 41 numbered COLREGs provisions and Annexes I–IV. Every entry has two or more original key points and one multiple-choice exercise. Rule summaries and scenarios are study aids; use the current official publication for authoritative wording.

```json
{
  "version": 1,
  "source": "https://www.navcen.uscg.gov/navigation-rules-amalgamated",
  "rules": [
    {
      "rule_number": "Rule 1",
      "title": "Application",
      "category": "General",
      "summary": "Original concise study summary.",
      "memory_hook": "Short recall cue.",
      "asa_inland_note": "International/Inland comparison or applicability note.",
      "key_points": ["Important application point.", "A relevant exception or limit."],
      "exercise": {
        "prompt": "A short vessel-operation question.",
        "options": [
          { "id": "a", "text": "First answer choice." },
          { "id": "b", "text": "Second answer choice." },
          { "id": "c", "text": "Third answer choice." },
          { "id": "d", "text": "Fourth answer choice." }
        ],
        "answer": "b",
        "explanation": "Why the correct choice applies.",
        "remediation": "What to review after an incorrect choice."
      }
    }
  ]
}
```

`answer` must match one option ID. Automated web tests verify all Rules 1–41, Annexes I–IV, unique entry/option IDs, and a valid explanation and remediation for every exercise.

## 4.3 Gemini Structured Output Schema & Prompt Contract (`ExaminerAiService`)

After explicit per-answer consent, an authenticated client can send the evaluation request to `POST /api/exam/evaluate`. The Azure Functions API calls Gemini using its server-side `GEMINI_API_KEY` configuration. Clients must never call Gemini directly or bundle the key.

### WatchWatcher API Contracts

| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| `GET` | `/api/health` | Check API and configured service health | — | `{ status, services }` |
| `POST` | `/api/auth/session` | Start an authenticated session | `{ credentials }` | `{ accountId, session }` |
| `GET` | `/api/progress` | Read the signed-in account's cloud snapshot | — | `{ topicMastery, weakSpotLog, drillQueue }` |
| `PUT` | `/api/progress` | Sync local progress using the supplied revision | `{ topicMastery, weakSpotLog, drillQueue, revision }` | `{ syncedAt, revision }`; `409` for a stale revision |
| `POST` | `/api/exam/evaluate` | Optional online structured evaluation | `{ topicId, context, answer, onlineConsent: true }` | `{ score, feedback, misconceptionTag, followUpDrill, source: "online" }` |

The client applies the topic's pass threshold. API failures must leave structured offline study and ungraded skipping available.

### Request Body Contract

```json
{
  "system_instruction": {
    "parts": [
      {
        "text": "You are an elite RYA Yachtmaster Chief Instructor and Examiner (with ASA 105/106/108 comparative expertise). Grade strictly on safety, COLREGs compliance, and navigation precision. Cite exact rules. If score < pass_threshold, diagnose the root misconception and provide a follow-up drill."
      }
    ]
  },
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "{\"topicId\":\"rule-19\",\"context\":\"Synthetic question and reference\",\"answer\":\"Synthetic answer\"}"
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.2,
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "OBJECT",
      "properties": {
        "score": {
          "type": "NUMBER",
          "description": "Normalized score from 0.0 to 1.0."
        },
        "feedback": {
          "type": "STRING",
          "description": "Candid examiner evaluation explaining why the answer passed or failed, with rule citations."
        },
        "misconception_tag": {
          "type": "STRING",
          "description": "Snake_case tag describing the error (e.g. 'turned_port_in_fog'), or empty string if score >= pass_threshold."
        },
        "follow_up_drill": {
          "type": "STRING",
          "description": "A targeted verification question testing the same rule from a new angle if score < pass_threshold."
        }
      },
      "required": ["score", "feedback", "misconception_tag"]
    }
  }
}

```

### Offline Alternative

Structured choices are graded locally against their predefined answer. Free-text answers cannot be reliably graded by the keyword evaluator and are left ungraded when skipped.

---

## 4.4 Exact Vector Mathematics & Canvas Geometry (`ChartVectorCanvas`)

All vector plotting in `lib/widgets/chart_vector_canvas.dart` must obey exact Euclidean scaling so `1.0 NM` along the Water Track equals `1.0 NM` along the Tidal Vector:

1. **Bearing-to-Cartesian Mapping** ($\theta$ in degrees True clockwise from North):

$$\theta_{\text{rad}} = \theta \cdot \frac{\pi}{180}, \quad \Delta x = d \cdot \sin(\theta_{\text{rad}}), \quad \Delta y = -d \cdot \cos(\theta_{\text{rad}})$$


2. **Vector Chain (over duration $t$ hours):**
* **Fix ($\odot$):** $P_{\text{fix}} = (0, 0)$
* **Water Vector (`1 arrow >`):** $\vec{W} = \text{polar}(\theta_{\text{water}}, V_{\text{boat}} \cdot t)$
* **Dead Reckoning ($\boldsymbol{+}$):** $P_{\text{DR}} = P_{\text{fix}} + \vec{W}$
* **Tidal Vector (`3 arrows >>>`):** $\vec{T} = \text{polar}(\theta_{\text{tide}}, V_{\text{tide}} \cdot t)$
* **Estimated Position ($\triangle$):** $P_{\text{EP}} = P_{\text{DR}} + \vec{T}$
* **Ground Track (`2 arrows >>`):** $\vec{G} = P_{\text{EP}} - P_{\text{fix}}$


3. **Derived Telemetry:**
* **Speed Over Ground (SOG):** $\text{SOG} = \frac{\sqrt{\Delta x_{\text{EP}}^2 + \Delta y_{\text{EP}}^2}}{t}$
* **Course Over Ground (COG):** $\text{COG} = \left(\text{atan2}(\Delta x_{\text{EP}}, -\Delta y_{\text{EP}}) \cdot \frac{180}{\pi} + 360\right) \bmod 360$
* **Course to Steer (CTS) Feasibility Check:** When attempting a perpendicular track against a cross-tide, flag `overpoweredByTide = V_tide > V_boat` and render an amber seamanship warning banner.


4. **Uniform Aspect-Preserving Viewport Scaling:**
* Compute bounding box `[minX, maxX] × [minY, maxY]` across `{P_fix, P_DR, P_EP}` and apply a **single uniform scalar** `scale = min((width - 2*pad)/spanX, (height - 2*pad)/spanY)` to both X and Y axes so triangles are never stretched.



---

## 4.5 UI & Navigation Architecture (`lib/screens/` & `lib/main.dart`)

* **Color Palette & Night-Watch Support:**
* Light Mode: Admiralty Blue (`#1B4965`) primary, Chart Paper (`#F6F1E3`) vector canvas, Slate (`#334155`) typography.
* Dark Mode (Night Watch): Deep Navy (`#0B192C`) background, Radar Phosphor (`#4ADE80`) & High-Contrast Signal Red (`#FF3B30`) accents.


* **Responsive Navigation Shell (`lib/main.dart`):**
* Uses `NavigationBar` on screens `< 720px` wide and `NavigationRail` on screens `>= 720px` wide across four top-level destinations:
1. **`StudyDeskScreen` (`/`):** Resume the next study topic and review overall readiness, mastery, weak spots, and offline/sync status. Show a loading skeleton while local progress initializes and never block the desk on sign-in or network access.
2. **`ExaminerWorkspaceScreen` (`/examiner`):** Displays module/topic header, RYA/ASA segmented toggle, offline/online status badge, current topic mastery chip, grounded summary, ASA comparative callout (when selected), interactive visual aid (`ChartVectorSandbox` or `ColregsAnimatedView`), scenario prompt, multi-line response input, and threshold-gated debrief/remediation box.
3. **`SyllabusMapScreen` (`/syllabus`):** Displays overall readiness, per-module progress, pass thresholds, expandable topic mastery, and a prominent **"Drill My Weak Spots"** action that queues topics from `StudentMemoryService.weakSpotLog`. Include the empty weak-spot state.
4. **`ColregsReferenceScreen` (`/colregs`):** Instant offline search input + category filter chips (`All`, `Steering & Sailing`, `Lights & Shapes`, `Sound & Distress`, `Fog & Restricted Visibility`) + an interactive **Night Lights Inspector** allowing users to preview vessel light stacks and day shapes.

The Study Desk's account controls expose sign-in, sign-out, and manual sync. Display whether progress is local-only, synced, or awaiting retry; do not imply that sign-in is required for studying.





---

## 4.6 Automated Test Specifications (`test/`)

### 1. `test/navigation_math_test.dart`

* **Test 1 (2:1 Cross-Tide Right Triangle):** Verify `waterHeading = 0°`, `waterSpeed = 6.0 kn`, `tideSet = 90°`, `tideRate = 3.0 kn`, `hours = 1.0` computes `COG` within `26.5° ± 0.5°` (`027° T`) and `SOG` within `6.71 kn ± 0.05 kn`.
* **Test 2 (South-East Quadrant DR/EP):** Verify `090° T` at `6.0 kn` + `180° T` tide at `2.0 kn` places `EP` in `(+6.0, +2.0)` screen delta (SE quadrant) with `SOG ≈ 6.32 kn`.
* **Test 3 (Impossible CTS Detection):** Verify `waterSpeed = 3.0 kn` vs. `tideRate = 4.0 kn` evaluates `overpoweredByTide == true`.

### 2. `test/offline_examiner_test.dart`

* **Test 1 (Critical Safety Failure & Remediation Gate):** Submit `"I would alter course to port"` on `colregs_rule_19d` (`pass_threshold = 0.85`). Assert `eval.passed == false`, `eval.triggerDeepRemediation == true`, and `StudentMemoryService.weakSpotLog` records an entry for `colregs_rule_19d`.
* **Test 2 (Passing Threshold & Weak-Spot Clearance):** Submit `"Alter course boldly to starboard because Rule 19(d) prohibits turning to port for a vessel forward of the beam"`. Assert `eval.passed == true` and `weakSpotLog` removes `colregs_rule_19d`.
* **Test 3 (Persistence Round-Trip):** Using `SharedPreferences.setMockInitialValues({})`, record an attempt, instantiate a fresh `StudentMemoryService`, call `load()`, and verify `_topicMastery` and `_weakSpotLog` restore accurately.

### 3. `test/study_desk_test.dart`

* Verify the Study Desk renders the next topic and local progress while signed out and offline.
* Verify progress initialization shows a skeleton, then resolves to populated or empty states without requiring an API response.
* Verify sync status distinguishes local-only, synced, and retry-needed states.

### 4. `test/progress_sync_service_test.dart`

* Verify an authenticated successful sync updates the stored server revision.
* Verify signed-out, offline, unauthorized, and timeout cases preserve the local progress snapshot.
* Verify a `409` revision conflict preserves local progress and exposes a conflict/retry state instead of silently overwriting it.

---

## 4.7 GitHub Actions CI Workflow (`.github/workflows/ci.yml`)

```yaml
name: WatchWatcher CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  analyze-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          channel: 'stable'
          cache: true

      - name: Install dependencies
        run: flutter pub get

      - name: Verify formatting and static analysis
        run: flutter analyze --fatal-infos

      - name: Run unit and widget tests
        run: flutter test --coverage

      - name: Verify Web release build
        run: flutter build web --release

      - name: Install API dependencies
        run: npm --prefix services/watchwatcher-api install

      - name: Run API unit and route tests
        run: npm --prefix services/watchwatcher-api test

```

```

```

# WatchWatcher — Step 5: Autonomous Execution Plan, File-by-File Blueprint & Repository Publishing Specification

This document provides the complete, implementation-ready execution specification for **Step 5** of **WatchWatcher** (`watch_watcher`). It defines the exact workspace scaffolding sequence, dependency manifest, file-by-file contracts, verification commands, and GitHub repository initialization steps so GitHub Copilot can build, test, and validate the entire offline-first Flutter application cleanly.

---

## 5.1 Workspace Scaffolding & Initialization Rules

1. **Preserve Existing Documentation:**
   - Do **not** overwrite or delete `SPEC.md` (or any existing Markdown specification files) in the root `WatchWatcher/` workspace directory.
2. **Flutter Project Initialization:**
   - If `pubspec.yaml` and `lib/` do not yet exist in the current directory, run:
     ```bash
     flutter create . --project-name watch_watcher --org com.czetenyi --platforms=android,linux,web
     ```
   - Remove the default counter app boilerplate (`lib/main.dart` counter widget and `test/widget_test.dart`) before writing the **WatchWatcher** codebase.
3. **Directory Creation:**
   Ensure the following directory tree exists before generating source files:
   ```text
   WatchWatcher/
   ├── .github/workflows/
   ├── assets/syllabus/
   ├── assets/reference/
   ├── lib/models/
   ├── lib/services/
   ├── lib/screens/
   ├── lib/widgets/
   └── test/

   5.2 Dependency & Asset Manifest (pubspec.yaml)
Configure pubspec.yaml with exact dependency versions and bundled offline JSON assets:
name: watch_watcher
description: Offline-first RYA Yachtmaster & ASA Examiner, Visual Vector Plotter, and COLREGs Reference Trainer.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.3.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  shared_preferences: ^2.3.2
  flutter_secure_storage: ^9.2.2
  http: ^1.2.2

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/syllabus/curriculum_seed.json
    - assets/reference/colregs_catalog.json

  ### 5.3 File-by-File Generation Order & Contracts

  Generate in dependency order so each layer has a usable implementation and tests.

  **Phase A — Offline Data Assets**

  - `assets/syllabus/curriculum_seed.json`: all six modules, at least 12 topics and 24 questions, with thresholds, expected and forbidden keywords, explanations, remediation, ASA notes, and visual specs.
  - `assets/reference/colregs_catalog.json`: searchable coverage of Rules 1–41 and Annexes I–IV, with original summaries, key points, International/Inland notes, and one linked scenario exercise per entry.

  **Phase B — Flutter Domain Models and Services**

  - `lib/models/training_models.dart`: immutable serialized models for syllabus standards, modules, topics, questions, visual specs, COLREGs entries, and examiner evaluations.
  - `lib/services/syllabus_repository.dart`: loads and caches both bundled JSON assets.
  - `lib/services/student_memory_service.dart`: stores mastery, weak-spot history, and drill queue locally; supports reset and context summaries.
  - `lib/services/api_client.dart`: calls the WatchWatcher API and attaches the session token without exposing service credentials.
  - `lib/services/auth_service.dart`: optional sign-in, sign-out, and session management using platform secure storage.
  - `lib/services/progress_sync_service.dart`: revision-aware sync of the local progress snapshot; preserves local state on offline, authorization, and conflict errors.
  - `lib/services/examiner_ai_service.dart`: any future client must obtain per-answer consent before calling `POST /api/exam/evaluate`, and must not read `GEMINI_API_KEY`, call Gemini directly, or grade free text with a deterministic fallback.

  **Phase C — Azure Functions API**

  - `services/watchwatcher-api/`: TypeScript, Node.js, Azure Functions, npm, and Vitest.
  - Implement `GET /api/health`, `POST /api/auth/session`, `GET /api/progress`, `PUT /api/progress`, and `POST /api/exam/evaluate` using the request and response contracts in Section 4.3.
  - Store account-scoped progress in PostgreSQL. Read `DATABASE_URL`, `GEMINI_API_KEY`, and `AzureWebJobsStorage` from server configuration; never put these values in Flutter assets or build-time defines.
  - Keep authentication-provider details behind the session endpoint; the API must authenticate and authorize account-scoped progress routes.
  - Test route validation, authentication, revision conflicts, database errors, and Gemini failures with Vitest.

  **Phase D — Visual Widgets and Screens**

  - `lib/widgets/chart_vector_canvas.dart` and `lib/widgets/colregs_animated_view.dart`: implement the exact-scale navigation and COLREGs visuals described in Sections 2 and 4.4.
  - `lib/screens/study_desk_screen.dart`: home dashboard for the next topic, readiness, weak spots, and local/sync status. It must render without a network or signed-in account.
  - `lib/screens/examiner_workspace_screen.dart`: active topic, RYA/ASA toggle, visual aid, scenario response, and threshold-gated remediation.
  - `lib/screens/syllabus_map_screen.dart` and `lib/screens/colregs_reference_screen.dart`: offline syllabus progress and searchable COLREGs reference.
  - `lib/main.dart`: initializes local services and hosts the four-destination responsive navigation shell in Section 4.5.

  **Phase E — Verification**

  - Flutter: `flutter pub get`, `flutter analyze --fatal-infos`, `flutter test`, and `flutter build web --release`.
  - API: `npm --prefix services/watchwatcher-api install` and `npm --prefix services/watchwatcher-api test`.

  ### 5.4 Quality Gate & Verification Pipeline

  Before completing code generation, execute the Flutter and API checks above and fix relevant warnings or errors:
    1. Dependency Resolution:
    flutter pub get
2.    Static Analysis (Zero Issues Allowed):
    flutter analyze --fatal-infos
    3. Automated Unit & Widget Tests (test/navigation_math_test.dart & test/offline_examiner_test.dart):
    flutter test
    4. Release Build Verification (Linux / Web):
    flutter build web --release

    5.5 Documentation & GitHub Repository Publishing Blueprint
1. .gitignore Rules
Ensure standard Flutter/Dart ignores are present alongside .env and local API key protection:

.dart_tool/
.packages
build/
.flutter-plugins
.flutter-plugins-dependencies
.env
*.keystore
*.jks

README.md Structure
Generate a concise, technical README.md containing:

Project Overview: Offline-first architecture, RYA/ASA dual-mode design, and deterministic vector/COLREGs rendering.

Running Offline vs. Online AI Mode:

Offline mode (default): flutter run

Online Gemini structured examiner mode: start the Azure Functions API with `GEMINI_API_KEY` configured server-side, then sign in in the app. Never pass the key to `flutter run` or bundle it in a client build.

API local setup: install dependencies in `services/watchwatcher-api`, configure `DATABASE_URL`, `GEMINI_API_KEY`, and `AzureWebJobsStorage`, then run `func start`. Run API tests with `npm --prefix services/watchwatcher-api test`.

Building Release Artifacts:

Android APK: flutter build apk --release

Linux Desktop: flutter build linux --release

Web PWA: flutter build web --release

3. GitHub Repository Initialization & Push Commands
Once all checks in Section 5.4 pass, publish the repository from the WatchWatcher root directory:

git init -b main
git add .
git commit -m "feat: initial offline-first WatchWatcher Yachtmaster & ASA trainer"
gh repo create WatchWatcher --private --source=. --remote=origin --push