import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { api } from '../../api';
import type { ColregsRule, StudySnapshot } from '../domain-types';
import { selectNextRuleExercise, StudentMemoryService, summarizeRuleExercise, type RuleExerciseSummary } from '../core/student-memory.service';
import { deriveAssessmentProgress, type AssessmentProgress, type TopicExamState } from '../core/assessment-progress';
import { AssessmentQuestionBankService } from '../core/services/assessment-question-bank.service';
import { LocaleService, TranslationPipe } from '../core/locale.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, TranslationPipe],
  template: `
    <section class="hero-panel">
      <span class="hero-kicker"><span class="status-dot"></span> {{ 'study.hero.kicker' | t }}</span>
      @if (nextRule(); as rule) {
        <h1>{{ rule.ruleNumber }} · {{ rule.title }}</h1>
        <p>{{ 'study.hero.completed' | t: { completed: completedRuleExercises(), total: ruleCount() } }} {{ (nextRuleSummary()?.completed ? 'study.hero.reviewDescription' : 'study.hero.continueDescription') | t }}</p>
        <div class="hero-actions">
          <a mat-flat-button [routerLink]="['/colregs', rule.id]"><mat-icon>arrow_forward</mat-icon> {{ (nextRuleSummary()?.attempts ? 'study.resumeExercise' : 'study.startExercise') | t }}</a>
          <a mat-stroked-button routerLink="/examiner"><mat-icon>quiz</mat-icon> {{ 'study.practiceWorkspace' | t }}</a>
          <a mat-stroked-button routerLink="/syllabus"><mat-icon>map</mat-icon> {{ 'study.viewSyllabus' | t }}</a>
        </div>
      } @else {
        <h1>{{ 'study.unavailable' | t }}</h1><p>{{ 'study.bundledPracticeUnavailable' | t }}</p>
      }
      <svg class="hero-mesh" aria-hidden="true" viewBox="0 0 800 300" preserveAspectRatio="none">
        <defs>
          <radialGradient id="mesh-a"><stop offset="0" stop-color="#e97c62" stop-opacity=".55"/><stop offset="1" stop-color="#e97c62" stop-opacity="0"/></radialGradient>
          <radialGradient id="mesh-b"><stop offset="0" stop-color="#71c1b6" stop-opacity=".5"/><stop offset="1" stop-color="#71c1b6" stop-opacity="0"/></radialGradient>
        </defs>
        <rect width="800" height="300" fill="url(#mesh-a)"/><rect width="800" height="300" fill="url(#mesh-b)"/>
      </svg>
    </section>

    <main class="page-content">
      <section aria-labelledby="mastery-heading">
        <div class="section-heading"><h2 id="mastery-heading"><mat-icon>query_stats</mat-icon> {{ 'study.masteryHeading' | t }}</h2><span>{{ 'study.syllabusTopics' | t: { count: snapshot()?.topics?.length ?? 0 } }}</span></div>
        @if (loading()) {
          <mat-card class="state-card"><mat-progress-bar mode="indeterminate"/><p>{{ 'study.loadingSnapshot' | t }}</p></mat-card>
        } @else if (error()) {
          <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>{{ 'study.dataUnavailable' | t }}</strong><p>{{ error() }}</p></div><button mat-stroked-button (click)="load()">{{ 'study.tryAgain' | t }}</button></mat-card>
        } @else if (snapshot()?.topics?.length === 0) {
          <mat-card class="state-card empty-state"><mat-icon>inbox</mat-icon><h3>{{ 'study.noActiveTopics' | t }}</h3><p>{{ 'study.chooseModule' | t }}</p><a mat-flat-button routerLink="/syllabus">{{ 'study.openSyllabus' | t }}</a></mat-card>
        } @else if (snapshot(); as data) {
          @if (assessment(); as progress) {
            <div class="metrics-grid">
              <mat-card class="metric-card"><div class="metric-icon"><mat-icon>query_stats</mat-icon></div><span class="metric-label">{{ 'study.courseLearningProgress' | t }}</span><strong>{{ displayProgress(progress.courseProgress) }}</strong><span>{{ 'study.progressBreakdown' | t: { critical: displayProgress(progress.priorityCoverage.critical.percentage), major: displayProgress(progress.priorityCoverage.major.percentage), minor: displayProgress(progress.priorityCoverage.minor.percentage) } }}</span></mat-card>
              <mat-card class="metric-card"><div class="metric-icon"><mat-icon>{{ progress.readyForExam ? 'task_alt' : 'school' }}</mat-icon></div><span class="metric-label">{{ 'study.examReadiness' | t }}</span><strong>{{ (progress.readyForExam ? 'study.readyForExam' : 'study.notReadyForExam') | t }}</strong><span>{{ 'study.readinessNote' | t }}</span></mat-card>
              <mat-card class="metric-card"><div class="metric-icon"><mat-icon>fact_check</mat-icon></div><span class="metric-label">{{ 'study.latestExam' | t }}</span>@if (progress.latestExam; as latestExam) { <strong>{{ roundScore(latestExam.score) }}% · {{ (latestExam.passed ? 'study.examPassed' : 'study.examFailed') | t }}</strong><span>{{ 'study.firstAttemptResult' | t }}</span> } @else { <strong>{{ 'study.noExamYet' | t }}</strong><span>{{ 'study.examHistorySeparate' | t }}</span> }</mat-card>
              <mat-card class="metric-card"><div class="metric-icon warning-icon"><mat-icon>flag</mat-icon></div><span class="metric-label">{{ 'study.weakSpotRecords' | t }}</span><strong>{{ data.weakSpots }}</strong><span>{{ 'study.storedLocal' | t }}</span></mat-card>
            </div>
          }
          <div class="offline-note"><p><mat-icon>offline_bolt</mat-icon> {{ 'study.offlineNote' | t }}</p><div><button mat-button (click)="syncProgress()" [disabled]="syncing()"><mat-icon>sync</mat-icon> {{ (syncing() ? 'study.syncing' : 'study.syncProgress') | t }}</button>@if (syncMessage()) { <small role="status">{{ syncMessage() }}</small> }</div></div>
          <div class="section-heading topics-heading"><h2><mat-icon>menu_book</mat-icon> {{ 'study.topicsHeading' | t }}</h2><span>{{ 'study.masteryCompared' | t }}</span></div>
          <div class="topic-list">
            @for (topic of data.topics; track topic.id) {
              <mat-card class="topic-row">
                <div class="topic-title"><div><span class="topic-module">{{ topic.moduleTitle }}</span><h3><a class="content-link" [routerLink]="['/learn', topic.contentId ?? topic.id]">{{ topic.title }}</a></h3></div><span class="state-pill" [class.ready]="topic.state === 'ready'" [class.retry]="topic.state === 'retry'">{{ (topic.state === 'ready' ? 'study.state.ready' : topic.state === 'retry' ? 'study.state.retry' : 'study.state.remediation') | t }}</span></div>
                <p>{{ topic.summary }}</p>
                <div class="topic-progress"><mat-progress-bar mode="determinate" [value]="topic.mastery" [class.over-threshold]="topic.mastery >= topic.passThreshold"/><span>{{ 'study.masteryPercent' | t: { mastery: topic.mastery } }} <i>·</i> {{ 'study.passThresholdPercent' | t: { threshold: topic.passThreshold } }}</span></div>
                @if (assessment(); as progress) {
                  @let examState = topicExamState(topic.id);
                  <div class="topic-exam-state"><mat-icon class="exam-state-icon" [class.exam-passed]="examState.state === 'passed'" [class.exam-failed]="examState.state === 'failed'" [attr.aria-label]="(examState.state === 'passed' ? 'study.examStatePassed' : examState.state === 'failed' ? 'study.examStateFailed' : 'study.examStateUntested') | t" [title]="(examState.state === 'passed' ? 'study.examStatePassed' : examState.state === 'failed' ? 'study.examStateFailed' : 'study.examStateUntested') | t">{{ examState.state === 'passed' ? 'check_circle' : examState.state === 'failed' ? 'error' : 'remove_circle_outline' }}</mat-icon><span>{{ (examState.state === 'passed' ? 'study.examStatePassed' : examState.state === 'failed' ? 'study.examStateFailed' : 'study.examStateUntested') | t }} · {{ 'study.examCoverage' | t: { tested: examState.testedObjectives, total: examState.totalObjectives } }}</span></div>
                }
              </mat-card>
            }
          </div>
        }
      </section>
      <footer class="page-footer"><span>{{ 'study.footerTraining' | t }}</span><span>{{ 'study.footerOffline' | t }}</span></footer>
    </main>
  `,
  styles: [`
    .topic-exam-state { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
    .exam-state-icon { color: var(--muted); }
    .exam-state-icon.exam-passed { color: var(--success); }
    .exam-state-icon.exam-failed { color: var(--danger); }
  `],
})
export class StudyDeskPage implements OnInit {
  readonly snapshot = signal<StudySnapshot | null>(null);
  readonly assessment = signal<AssessmentProgress | null>(null);
  readonly nextRule = signal<ColregsRule | null>(null);
  readonly nextRuleSummary = signal<RuleExerciseSummary | null>(null);
  readonly completedRuleExercises = signal(0);
  readonly ruleCount = signal(0);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly syncing = signal(false);
  readonly syncMessage = signal('');

  constructor(private readonly memory: StudentMemoryService, private readonly bank: AssessmentQuestionBankService, private readonly locales: LocaleService = new LocaleService()) {}

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [current, rules, bank] = await Promise.all([api.getStudySnapshot(), api.searchColregs(''), this.bank.loadBank()]);
      const progress = await this.memory.loadAndMergeCloudProgress();
      const assessment = deriveAssessmentProgress(bank.objectives, progress);
      this.assessment.set(assessment);
      const nextRule = selectNextRuleExercise(rules, progress);
      this.nextRule.set(nextRule);
      this.nextRuleSummary.set(nextRule ? summarizeRuleExercise(nextRule.id, progress) : null);
      this.ruleCount.set(rules.length);
      this.completedRuleExercises.set(rules.filter((rule) => summarizeRuleExercise(rule.id, progress).completed).length);
        current.topics = current.topics.map((topic) => {
          const mastery = assessment.topicPracticeMastery[topic.id] ?? 0;
          return { ...topic, mastery, state: mastery >= topic.passThreshold ? 'ready' : mastery > 0 ? 'retry' : 'remediation' };
        });
        current.averageMastery = current.topics.length ? Math.round(current.topics.reduce((total, topic) => total + topic.mastery, 0) / current.topics.length) : 0;
        current.atThreshold = current.topics.filter((topic) => topic.mastery >= topic.passThreshold).length;
        const topicIds = new Set(current.topics.map((topic) => topic.id));
        current.weakSpots = progress.weakSpotLog.filter((entry) => topicIds.has(entry.topicId)).length;
      this.snapshot.set(current);
    }
    catch (error) { this.error.set(error instanceof Error ? error.message : this.locales.translate('study.tryAgainSoon')); }
    finally { this.loading.set(false); }
  }

  async syncProgress(): Promise<void> {
    this.syncing.set(true);
    this.syncMessage.set('');
    try {
      const result = await this.memory.syncProgress();
      this.syncMessage.set(this.locales.translate('study.syncedAt', { time: new Date(result.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
    } catch (error) {
      this.syncMessage.set(error instanceof Error ? this.locales.translate('study.syncError', { message: error.message }) : this.locales.translate('study.syncFailed'));
    } finally { this.syncing.set(false); }
  }

  displayProgress(value: number | null): string {
    return value === null ? this.locales.translate('study.unavailableScore') : `${value}%`;
  }

  roundScore(value: number): number {
    return Math.round(value);
  }

  topicExamState(topicId: string): TopicExamState {
    const assessment = this.assessment();
    return assessment?.latestExamByTopic[topicId] ?? { state: 'untested', testedObjectives: 0, totalObjectives: assessment?.topicObjectiveTotals[topicId] ?? 0 };
  }
}
