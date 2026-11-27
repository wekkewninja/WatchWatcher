# Issue #22: Learning Progress Design

## Source of truth

The assessment bank remains the canonical catalog of stable objective IDs, topic IDs (`sectionId`), and Critical/Major/Minor priority. No second objective catalog is added. Repeated questions that map to one objective contribute that objective only once.

Progress is derived from immutable, account-scoped events. New practice submissions store question ID, topic ID, mapped objective IDs, correctness, and timestamp. Legacy `ruleExerciseAttempts` map only to the known rule scenario objective `colregs:${ruleId}:scenario`; they do not imply correctness on key-point objectives. Existing `topicMastery` values are preserved for compatibility but are not used in the objective-based course or topic scores.

Completed exam sessions store their selected question IDs, objective mappings, topics, priorities, first-attempt submitted answers/results, start/completion times, score, and pass gates. A session passes only when at least 85% of selected questions are correct on the first attempt and every Critical question is correct. Only correct objectives from passed exams add course coverage; exam evidence never changes practice topic mastery or a session's outcome.

## Calculations

For each priority tier, coverage is unique correctly credited objectives divided by all objectives in that tier. Course progress is `70% Critical + 20% Major + 10% Minor`, rounded to a whole percent for display. If a tier has no objectives, its coverage and course progress are unavailable. Practice topic mastery is the unweighted percentage of unique topic objectives answered correctly at least once in practice. Readiness is available only at course progress of at least 75% and after every Critical objective has a correct practice answer.

The latest completed exam alone determines topic exam states. A topic absent from that exam is untested; a tested topic is green only when all its selected questions were correct, otherwise red. The UI also reports tested unique objectives over all objectives in that topic.

## Persistence and sync

Objective practice events, completed exam sessions, deleted exam-session IDs, and an exam-history clear watermark extend the existing revision-aware progress snapshot. IndexedDB remains namespaced by account/guest. Local/remote event sets merge by stable IDs; deletion IDs and the latest clear timestamp suppress both known and previously unseen older remote sessions, so offline deletion cannot be undone by synchronization. Sessions completed after the clear timestamp remain eligible. A Postgres migration adds JSONB arrays with empty-array defaults, array checks, and a nullable timestamp; old snapshots gain no inferred objective evidence. Account deletion continues to cascade through the progress snapshot.

Exam answers stay local/offline and account-scoped. The exam flow does not disclose correctness, answers, or explanations until completion and does not permit a second answer in the same exam. Deleting exam history removes local sessions immediately and synchronizes tombstones when online.

## Practice and presentation

The Examiner exposes every question-bank section for objective practice, including Critical key points and explicit checks; curriculum topic pages expose their own question sets. Choice questions are checked locally. Free-text questions use the approved per-answer-consent online evaluator; offline learners can skip without recording evidence, and no local keyword grader is used as an AI fallback. Incorrect graded answers reveal the model answer and explanation, then leave the active round; failed questions return in a delayed end-of-session review round. Each retry remains a separate event. Answer reveals and ungraded skips create no evidence.

The Study Desk and syllabus display objective-derived course progress, practice-only topic mastery, readiness, and latest-exam status separately. The legacy 70/30 `recordEvaluation` calculation is retired rather than combined with these scores. Exam selection remains the existing Critical-inclusive, five-random-supplemental behavior; accuracy/content corrections remain outside this issue.

## Verification

Tests cover weighted tiers with unequal objective counts, duplicate mappings, empty tiers, practice-only topic mastery, readiness gating, exam credit/pass rules, delayed practice retries, reveal timing, account isolation, idempotent/offline merge, tombstone deletion, and persistence/sync contracts.