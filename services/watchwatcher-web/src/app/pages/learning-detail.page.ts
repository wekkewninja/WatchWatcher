import { Component, OnDestroy, computed, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { Subscription } from 'rxjs';
import { AuthStateService } from '../core/auth-state.service';
import { StudentMemoryService } from '../core/student-memory.service';
import { ExaminerAiService } from '../core/services/examiner-ai.service';
import { AssessmentQuestionBankService } from '../core/services/assessment-question-bank.service';
import type { ShortAnswerAssessmentQuestion } from '../core/services/assessment-question-bank';
import { LocaleService, TranslationPipe } from '../core/locale.service';

interface PracticeAnswerResult {
  correct: boolean | null;
  feedback: string;
}

interface CurriculumQuestion {
  id: string;
  prompt: string;
  expected_keywords: string[];
  forbidden_keywords: string[];
  correct_explanation: string;
  deep_remediation: string;
}

interface CurriculumTopic {
  id: string;
  rule_ref: string;
  title: string;
  summary: string;
  asa_note: string;
  questions: CurriculumQuestion[];
}

interface CurriculumModule {
  id: string;
  title: string;
  pass_threshold: number;
  topics: CurriculumTopic[];
}

interface Curriculum {
  modules: CurriculumModule[];
}

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, TranslationPipe],
  template: `
    <main class="page-content learning-page">
      @if (loading()) {
        <mat-card class="state-card"><mat-progress-bar mode="indeterminate"/><p>{{ 'learning.loading' | t }}</p></mat-card>
      } @else if (error()) {
        <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>{{ 'learning.unavailable' | t }}</strong><p>{{ error() }}</p></div><a mat-stroked-button routerLink="/syllabus">{{ 'learning.backToSyllabus' | t }}</a></mat-card>
      } @else if (module(); as moduleContent) {
        <header class="page-heading"><div><span class="eyebrow">{{ 'learning.moduleThreshold' | t: { threshold: moduleContent.pass_threshold * 100 } }}</span><h1>{{ moduleContent.title }}</h1><p>{{ 'learning.moduleDescription' | t }}</p></div><a mat-stroked-button routerLink="/syllabus"><mat-icon>arrow_back</mat-icon> {{ 'learning.syllabusMap' | t }}</a></header>
        <section class="learning-topic-list" [attr.aria-label]="'learning.moduleTopics' | t">
          @for (topic of moduleContent.topics; track topic.id) {
            <mat-card class="learning-topic-row"><span class="learning-topic-ref">{{ topic.rule_ref }}</span><div><h2><a class="content-link" [routerLink]="['/learn', topic.id]">{{ topic.title }}</a></h2><p>{{ topic.summary }}</p><span class="learning-topic-meta">{{ 'learning.topicChecks' | t: { count: topic.questions.length, threshold: moduleContent.pass_threshold * 100 } }}</span></div><a mat-icon-button [routerLink]="['/learn', topic.id]" [attr.aria-label]="'learning.openTopic' | t: { title: topic.title }" [title]="'learning.openTopic' | t: { title: topic.title }"><mat-icon>arrow_forward</mat-icon></a></mat-card>
          }
        </section>
      } @else if (topic(); as topicContent) {
        <header class="page-heading learning-heading"><div><span class="eyebrow">{{ topicContent.rule_ref }}</span><h1>{{ topicContent.title }}</h1><p>{{ parentModule()?.title }} · {{ (parentModule()?.pass_threshold ?? 0) * 100 }}% pass threshold</p></div><a mat-stroked-button [routerLink]="['/learn', parentModule()?.id]"><mat-icon>arrow_back</mat-icon> {{ parentModule()?.title }}</a></header>
        <section class="learning-briefing"><mat-card class="learning-briefing-card"><mat-card-header><mat-icon mat-card-avatar>menu_book</mat-icon><mat-card-title>{{ 'learning.studyBriefing' | t }}</mat-card-title></mat-card-header><mat-card-content><p>{{ topicContent.summary }}</p><div class="comparison-note"><mat-icon>compare_arrows</mat-icon><span><strong>{{ 'learning.ryaAsaNote' | t }}</strong>{{ topicContent.asa_note }}</span></div></mat-card-content></mat-card></section>
        <section class="learning-questions" [attr.aria-label]="'learning.examinerQuestions' | t"><div class="section-heading"><h2><mat-icon>quiz</mat-icon> {{ 'learning.examinerQuestions' | t }}</h2><span>{{ 'learning.questionChecks' | t: { count: practiceQuestions().length } }}</span></div>
          @if (currentPracticeQuestion(); as question) {
            <mat-card class="learning-question learning-practice" aria-live="polite">
              <span class="learning-topic-meta">{{ 'learning.roundProgress' | t: { round: practiceRound(), current: roundIndex() + 1, total: roundQuestions().length } }}</span>
              <h2>{{ question.prompt }}</h2>
              <label class="practice-answer"><span>{{ 'learning.writeAnswer' | t }}</span><textarea rows="4" maxlength="12000" [disabled]="saving() || evaluating() || checked() !== null" [value]="answer()" (input)="setAnswer($event)"></textarea></label>
              @if (answerError()) { <p role="alert">{{ answerError() }}</p> }
              @if (checked() === null) {
                <p>{{ 'learning.onlineEvaluationDisclosure' | t }}</p>
                <label class="practice-consent"><input type="checkbox" [checked]="hasConsent()" (change)="setConsent($event)"> {{ 'learning.onlineConsent' | t }}</label>
                <p>{{ 'learning.onlineAccountRequired' | t }} <a routerLink="/login">{{ 'learning.signIn' | t }}</a>{{ 'learning.skipOffline' | t }}</p>
                <p>{{ 'learning.aiDisclaimer' | t }}</p>
                @if (evaluationError()) { <p role="alert">{{ evaluationError() }}</p> }
              }
              @if (checked(); as result) {
                <div class="practice-feedback" [class.correct]="result.correct" role="status">
                  <strong>{{ (result.correct === null ? 'learning.notGraded' : result.correct ? 'learning.correct' : 'learning.reviewAnswer') | t }}</strong>
                  @if (result.correct !== null) {
                    <p>{{ result.feedback }}</p>
                    @if (!result.correct) { <p><strong>{{ 'learning.modelAnswer' | t }}</strong> {{ question.modelAnswer }}</p> }
                    <p><strong>{{ 'learning.explanation' | t }}</strong> {{ question.explanation }}</p>
                    @if (!result.correct) { <p><strong>{{ 'learning.remediation' | t }}</strong> {{ question.remediation }}</p> }
                  } @else { <p>{{ 'learning.ungradedNotice' | t }}</p> }
                </div>
              }
              <div class="practice-actions">
                @if (checked() === null) {
                  <button mat-button type="button" [disabled]="saving() || evaluating()" (click)="skipAnswer()">{{ 'learning.skipUngraded' | t }}</button>
                  <button mat-flat-button type="button" [disabled]="saving() || evaluating() || !answer().trim() || !hasConsent() || answer().trim().length > 12000" (click)="checkAnswer()"><mat-icon>check</mat-icon> {{ (evaluating() ? 'learning.evaluatingAnswer' : saving() ? 'learning.savingAnswer' : 'learning.checkAnswer') | t }}</button>
                } @else {
                  <button mat-flat-button type="button" (click)="advancePractice()">{{ 'learning.nextQuestion' | t }} <mat-icon>arrow_forward</mat-icon></button>
                }
              </div>
            </mat-card>
          } @else if (reviewAvailable()) {
            <mat-card class="learning-practice-state"><h3>{{ 'learning.roundComplete' | t }}</h3><p>{{ 'learning.missedCount' | t: { count: nextRoundFailures().length } }}</p><button mat-flat-button type="button" (click)="startReviewRound()"><mat-icon>replay</mat-icon> {{ 'learning.reviewMissed' | t }}</button></mat-card>
          } @else if (practiceComplete()) {
            <mat-card class="learning-practice-state"><mat-icon>task_alt</mat-icon><h3>{{ 'learning.practiceComplete' | t }}</h3></mat-card>
          } @else {
            <mat-card class="learning-practice-state"><p>{{ 'learning.noPracticeQuestions' | t }}</p></mat-card>
          }
        </section>
        <div class="learning-actions"><a mat-flat-button routerLink="/examiner"><mat-icon>grading</mat-icon> {{ 'learning.openExaminer' | t }}</a><a mat-button routerLink="/colregs"><mat-icon>search</mat-icon> {{ 'learning.colregsReference' | t }}</a></div>
      }
    </main>
  `,
  styles: [`
    .learning-practice, .learning-practice-state { display: grid; gap: 14px; }
    .practice-answer { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .practice-answer textarea { width: 100%; padding: 10px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: inherit; font-weight: 400; resize: vertical; }
    .practice-consent { display: flex; align-items: flex-start; gap: 8px; color: var(--ink); font-size: 13px; }
    .practice-consent input { flex: 0 0 auto; margin: 3px 0 0; accent-color: var(--brand-primary); }
    .practice-feedback { padding: 12px; border-inline-start: 4px solid var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--surface-raised)); }
    .practice-feedback.correct { border-color: var(--success); background: color-mix(in srgb, var(--success) 8%, var(--surface-raised)); }
    .practice-feedback p { margin: 6px 0 0; color: var(--muted); }
    .practice-actions { display: flex; justify-content: flex-end; }
  `],
})
export class LearningDetailPage implements OnDestroy {
  readonly loading = signal(true);
  readonly error = signal('');
  readonly module = signal<CurriculumModule | null>(null);
  readonly topic = signal<CurriculumTopic | null>(null);
  readonly practiceQuestions = signal<ShortAnswerAssessmentQuestion[]>([]);
  readonly roundQuestions = signal<ShortAnswerAssessmentQuestion[]>([]);
  readonly nextRoundFailures = signal<ShortAnswerAssessmentQuestion[]>([]);
  readonly roundIndex = signal(0);
  readonly practiceRound = signal(1);
  readonly answer = signal('');
  readonly checked = signal<PracticeAnswerResult | null>(null);
  readonly saving = signal(false);
  readonly evaluating = signal(false);
  readonly answerError = signal('');
  readonly evaluationError = signal('');
  readonly reviewAvailable = signal(false);
  readonly practiceComplete = signal(false);
  private readonly consent = signal<{ accountId: string; generation: number } | null>(null);
  readonly hasConsent = computed(() => {
    const consent = this.consent();
    return !!consent && this.auth.cloudAuth() === 'authenticated' && this.auth.user()?.id === consent.accountId && this.auth.accountGeneration === consent.generation;
  });
  readonly currentPracticeQuestion = computed(() => this.reviewAvailable() || this.practiceComplete() ? null : this.roundQuestions()[this.roundIndex()] ?? null);
  private content?: Curriculum;
  private readonly routeSubscription: Subscription;

  constructor(route: ActivatedRoute, private readonly bank: AssessmentQuestionBankService, private readonly memory: StudentMemoryService, private readonly examiner: ExaminerAiService, private readonly auth: AuthStateService, private readonly locales: LocaleService = new LocaleService()) {
    this.routeSubscription = route.paramMap.subscribe((params) => {
      const contentId = params.get('contentId');
      if (contentId) void this.load(contentId);
    });
  }

  ngOnDestroy(): void { this.routeSubscription.unsubscribe(); }

  parentModule(): CurriculumModule | undefined {
    const topicId = this.topic()?.id;
    return this.content?.modules.find((moduleContent) => moduleContent.topics.some((topicContent) => topicContent.id === topicId));
  }

  private async load(contentId: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.module.set(null);
    this.topic.set(null);
    this.practiceQuestions.set([]);
    this.roundQuestions.set([]);
    this.nextRoundFailures.set([]);
    this.roundIndex.set(0);
    this.practiceRound.set(1);
    this.answer.set('');
    this.checked.set(null);
    this.answerError.set('');
    this.evaluationError.set('');
    this.consent.set(null);
    this.reviewAvailable.set(false);
    this.practiceComplete.set(false);
    try {
      this.content ??= await fetch(new URL('assets/syllabus/curriculum_seed.json', document.baseURI)).then((response) => {
        if (!response.ok) throw new Error(this.locales.translate('learning.bundleLoadFailed'));
        return response.json() as Promise<Curriculum>;
      });
      const moduleContent = this.content.modules.find((item) => item.id === contentId);
      if (moduleContent) this.module.set(moduleContent);
      else {
        const topicContent = this.content.modules.flatMap((item) => item.topics).find((item) => item.id === contentId);
        if (!topicContent) throw new Error(this.locales.translate('learning.topicNotFound'));
        this.topic.set(topicContent);
        const bank = await this.bank.loadBank();
        const questions = bank.questions.filter((question): question is ShortAnswerAssessmentQuestion => question.sectionId === contentId && question.type === 'short-answer');
        this.practiceQuestions.set(questions);
        this.roundQuestions.set(questions);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.locales.translate('common.retrySoon'));
    } finally { this.loading.set(false); }
  }

  setAnswer(event: Event): void {
    if (this.checked() !== null || this.saving()) return;
    this.answer.set((event.target as HTMLTextAreaElement).value);
    this.answerError.set('');
    this.evaluationError.set('');
    this.consent.set(null);
  }

  setConsent(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const accountId = this.auth.user()?.id;
    this.consent.set(checked && accountId && this.auth.cloudAuth() === 'authenticated' ? { accountId, generation: this.auth.accountGeneration } : null);
    if (checked && !this.hasConsent()) {
      (event.target as HTMLInputElement).checked = false;
      this.evaluationError.set(this.locales.translate('exam.onlineSignInRequired'));
    } else this.evaluationError.set('');
  }

  async checkAnswer(): Promise<void> {
    const question = this.currentPracticeQuestion();
    const answer = this.answer();
    if (!question || this.checked() !== null || !answer.trim() || answer.trim().length > 12000 || !this.hasConsent() || this.evaluating() || this.saving()) return;
    const consent = this.consent();
    this.consent.set(null);
    this.evaluating.set(true);
    this.answerError.set('');
    this.evaluationError.set('');
    try {
      const evaluation = await this.examiner.evaluateFreeText({
        topicId: question.sectionId,
        context: `Question: ${question.prompt}\nReference: ${question.sourceRef}\nModel answer: ${question.modelAnswer}\nExplanation: ${question.explanation}`,
        answer,
        onlineConsent: true,
      });
      if (this.auth.accountGeneration !== consent?.generation || this.auth.user()?.id !== consent.accountId || this.auth.cloudAuth() !== 'authenticated' || this.currentPracticeQuestion()?.id !== question.id || this.answer() !== answer) return;
      const result = { correct: evaluation.passed, feedback: evaluation.feedback };
      this.saving.set(true);
      await this.memory.recordObjectivePracticeAttempt({ questionId: question.id, topicId: question.sectionId, objectiveIds: question.coverageIds, correct: result.correct });
      this.checked.set(result);
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      this.evaluationError.set(status === 422 ? this.locales.translate('exam.invalidAnswer') : status === 429 ? this.locales.translate('exam.evaluationLimit') : error instanceof Error ? error.message : this.locales.translate('exam.evaluationUnavailable'));
    } finally { this.evaluating.set(false); this.saving.set(false); }
  }

  skipAnswer(): void {
    if (this.currentPracticeQuestion() && this.checked() === null && !this.evaluating() && !this.saving()) {
      this.checked.set({ correct: null, feedback: '' });
      this.consent.set(null);
    }
  }

  advancePractice(): void {
    const question = this.currentPracticeQuestion();
    const result = this.checked();
    if (!question || !result) return;
    if (result.correct === false) this.nextRoundFailures.update((failures) => failures.some((item) => item.id === question.id) ? failures : [...failures, question]);
    if (this.roundIndex() < this.roundQuestions().length - 1) {
      this.roundIndex.update((index) => index + 1);
      this.answer.set('');
      this.checked.set(null);
      this.consent.set(null);
      return;
    }
    if (this.nextRoundFailures().length) this.reviewAvailable.set(true);
    else this.practiceComplete.set(true);
    this.answer.set('');
    this.checked.set(null);
    this.consent.set(null);
  }

  startReviewRound(): void {
    const failures = this.nextRoundFailures();
    if (!failures.length) return;
    this.roundQuestions.set(failures);
    this.nextRoundFailures.set([]);
    this.roundIndex.set(0);
    this.practiceRound.update((round) => round + 1);
    this.reviewAvailable.set(false);
    this.practiceComplete.set(false);
    this.answer.set('');
    this.checked.set(null);
    this.consent.set(null);
  }
}
