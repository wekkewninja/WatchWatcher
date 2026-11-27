import { Component, OnInit, computed, signal } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { AuthStateService } from '../core/auth-state.service';
import { StudentMemoryService } from '../core/student-memory.service';
import { LocaleService, TranslationPipe } from '../core/locale.service';
import { ExaminerAiService } from '../core/services/examiner-ai.service';
import { AssessmentQuestionBankService } from '../core/services/assessment-question-bank.service';
import { selectExamQuestions, type AssessmentQuestion } from '../core/services/assessment-question-bank';
import type { ExamQuestionResult, ExamSession } from '../domain-types';

@Component({
  standalone: true,
  imports: [TitleCasePipe, RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, TranslationPipe],
  template: `
    <main class="page-content assessment-exam-page">
      <header class="page-heading">
        <div><span class="eyebrow">{{ 'exam.eyebrow' | t }}</span><h1>{{ 'exam.heading' | t }}</h1><p>{{ 'exam.description' | t }}</p></div>
        <button mat-stroked-button type="button" [disabled]="evaluating()" (click)="startNewExam()"><mat-icon>shuffle</mat-icon> {{ 'exam.newExam' | t }}</button>
      </header>
      @if (loading()) {
        <mat-card class="state-card"><mat-progress-bar mode="indeterminate"/><p>{{ 'exam.building' | t }}</p></mat-card>
      } @else if (error()) {
        <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>{{ 'exam.unavailable' | t }}</strong><p>{{ error() }}</p></div><button mat-stroked-button type="button" (click)="startNewExam()">{{ 'exam.tryAgain' | t }}</button></mat-card>
      } @else if (finished()) {
        <section class="exam-summary" aria-live="polite">
          <mat-icon>fact_check</mat-icon>
          <h2>{{ 'exam.complete' | t }}</h2>
          <strong>{{ 'exam.finalScore' | t: { score: displaySession()?.score ?? 0 } }}</strong>
          <p class="exam-outcome" [class.passed]="displaySession()?.passed" [class.failed]="displaySession() && !displaySession()?.passed">{{ displaySession()?.passed ? ('exam.pass' | t) : ('exam.fail' | t) }}</p>
          <p>{{ displaySession()?.criticalGatePassed ? ('exam.criticalGatePassed' | t) : ('exam.criticalGateFailed' | t) }}</p>
          <p>{{ 'exam.compositionSummary' | t: { critical: displaySession()?.questionResults?.filter(isCriticalResult).length ?? 0, supplemental: (displaySession()?.questionResults?.length ?? 0) - (displaySession()?.questionResults?.filter(isCriticalResult).length ?? 0) } }}</p>
          @if (missedQuestions().length) {
            <section class="exam-missed" aria-labelledby="missed-heading">
              <h3 id="missed-heading">{{ 'exam.missedQuestions' | t }}</h3>
              @for (result of missedQuestions(); track result.questionId) {
                @if (questionFor(result.questionId); as question) {
                  <article>
                    <h4>{{ question.prompt }}</h4>
                    <p><strong>{{ 'exam.submittedAnswer' | t }}</strong> {{ submittedAnswer(result, question) }}</p>
                    <p><strong>{{ 'exam.correctAnswer' | t }}</strong> {{ correctAnswer(question) }}</p>
                    <p><strong>{{ 'exam.explanation' | t }}</strong> {{ question.explanation }}</p>
                    <p>{{ question.remediation }}</p>
                  </article>
                }
              }
            </section>
          }
          @if (saveError()) { <p role="alert">{{ saveError() }}</p> }
          <div class="exam-summary-actions"><button mat-stroked-button type="button" (click)="startNewExam()"><mat-icon>shuffle</mat-icon> {{ 'exam.newExam' | t }}</button></div>
        </section>
      } @else if (!started()) {
        <section class="exam-intro" aria-labelledby="exam-intro-heading">
          <mat-icon>fact_check</mat-icon>
          <h2 id="exam-intro-heading">{{ 'exam.composition' | t }}</h2>
          <p><strong>{{ 'exam.criticalGuaranteed' | t: { count: criticalCount() } }}</strong></p>
          <p>{{ 'exam.supplementalRandomized' | t: { count: supplementalCount() } }}</p>
          <p>{{ 'exam.questionCount' | t: { count: questions().length } }}</p>
          <button mat-flat-button type="button" (click)="beginExam()"><mat-icon>play_arrow</mat-icon> {{ 'exam.start' | t }}</button>
        </section>
      } @else if (currentQuestion(); as question) {
        <section class="exam-panel" aria-labelledby="exam-question-heading">
          <div class="exam-progress-meta"><span>{{ question.sectionTitle }}</span><span>{{ 'exam.questionPosition' | t: { current: currentIndex() + 1, total: questions().length } }}</span></div>
          <mat-progress-bar mode="determinate" [value]="progressPercent()" [attr.aria-label]="'exam.progress' | t"/>
          <div class="exam-question-meta"><span class="priority-label" [class.priority-critical]="question.priority === 'critical'" [class.priority-major]="question.priority === 'major'" [class.priority-minor]="question.priority === 'minor'" [title]="question.priorityRationale">{{ question.priority | titlecase }}</span><span>{{ question.sourceRef }}</span></div>
          <h2 id="exam-question-heading">{{ question.prompt }}</h2>

          @if (question.type === 'choice') {
            <fieldset class="exam-options">
              <legend>{{ 'exam.chooseBestAnswer' | t }}</legend>
              @for (option of question.options; track option.id) {
                <label [class.selected]="response() === option.id">
                  <input type="radio" name="exam-answer" [value]="option.id" [checked]="response() === option.id" [disabled]="currentResult() !== null" (change)="setResponse(option.id)">
                  <span>{{ option.text }}</span>
                </label>
              }
            </fieldset>
          } @else {
            <label class="exam-short-answer"><span>{{ 'exam.yourAnswer' | t }}</span><textarea rows="5" [disabled]="evaluating() || currentResult() !== null" [value]="response()" (input)="setResponseFromEvent($event)" [placeholder]="'exam.writeResponse' | t"></textarea></label>
            @if (!currentResult()) {
              <p>{{ 'exam.onlineEvaluationDisclosure' | t }}</p>
              <label><input type="checkbox" [checked]="hasConsent()" (change)="setConsent($event)"> {{ 'exam.onlineConsent' | t }}</label>
              <p>{{ 'exam.onlineAccountRequired' | t }} <a routerLink="/examiner">{{ 'exam.offlineStructuredPractice' | t }}</a>{{ 'exam.skipWithoutGradingSentence' | t }}</p>
              <p>{{ 'exam.aiDisclaimer' | t }}</p>
              @if (response().trim().length > 12000) { <p role="alert">{{ 'exam.answerTooLong' | t }}</p> }
              @if (evaluationError()) { <p role="alert">{{ evaluationError() }}</p> }
            }
          }

          @if (saveError()) { <p role="alert">{{ saveError() }}</p> }

          <div class="exam-controls">
            <button mat-stroked-button type="button" [disabled]="currentIndex() === 0 || evaluating()" (click)="previousQuestion()"><mat-icon>arrow_back</mat-icon> {{ 'exam.previous' | t }}</button>
            @if (!currentResult()) {
              @if (question.type === 'short-answer') { <button mat-stroked-button type="button" [disabled]="evaluating()" (click)="skipAnswer()">{{ 'exam.skipWithoutGrading' | t }}</button> }
              <button mat-flat-button type="button" [disabled]="!response().trim() || evaluating() || (question.type === 'short-answer' && (!hasConsent() || response().trim().length > 12000))" (click)="checkAnswer()">{{ (evaluating() ? 'exam.checking' : 'exam.checkAnswer') | t }}</button>
            }
            @if (currentIndex() < questions().length - 1) {
              <button mat-stroked-button type="button" class="exam-next" [disabled]="!currentResult()" (click)="nextQuestion()">{{ 'exam.next' | t }} <mat-icon>arrow_forward</mat-icon></button>
            } @else {
              <button mat-flat-button type="button" [disabled]="!currentResult() || savingExam()" (click)="finishExam()">{{ (savingExam() ? 'exam.saving' : 'exam.finish') | t }} <mat-icon>check</mat-icon></button>
            }
          </div>
        </section>
      }
      @if (!loading() && savedSessions().length) {
        <section class="exam-history" aria-labelledby="exam-history-heading">
          <header><h2 id="exam-history-heading">{{ 'exam.history' | t }}</h2><button mat-stroked-button type="button" [disabled]="savingExam() || deletingHistory()" (click)="confirmHistoryDelete.set(true)"><mat-icon>delete</mat-icon> {{ 'exam.deleteHistory' | t }}</button></header>
          @if (confirmHistoryDelete()) {
            <div class="history-confirm" role="alertdialog" [attr.aria-label]="'exam.confirmDeleteHistory' | t">
              <p>{{ 'exam.confirmDeleteHistory' | t }}</p>
              <button mat-stroked-button type="button" [disabled]="deletingHistory()" (click)="confirmHistoryDelete.set(false)">{{ 'exam.cancelDelete' | t }}</button>
              <button mat-flat-button type="button" [disabled]="deletingHistory()" (click)="deleteHistory()"><mat-icon>delete</mat-icon> {{ (deletingHistory() ? 'exam.deletingHistory' : 'exam.confirmDelete') | t }}</button>
            </div>
          }
          @if (historyError()) { <p role="alert">{{ historyError() }}</p> }
          @for (session of savedSessions(); track session.id) {
            <mat-card class="exam-history-row">
              <div><strong>{{ formatExamDate(session.completedAt) }}</strong><span>{{ 'exam.historyScore' | t: { score: session.score } }} · {{ session.passed ? ('exam.pass' | t) : ('exam.fail' | t) }}</span></div>
              <button mat-stroked-button type="button" [disabled]="started() && !finished()" (click)="reviewSavedExam(session)"><mat-icon>fact_check</mat-icon> {{ 'exam.reviewSaved' | t }}</button>
            </mat-card>
          }
        </section>
      }
    </main>
  `,
  styles: [`
    .assessment-exam-page { max-width: 900px; }
    .exam-panel { display: grid; gap: 16px; padding: 20px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); }
    .exam-progress-meta, .exam-question-meta, .exam-controls, .exam-summary-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .exam-progress-meta { justify-content: space-between; color: var(--muted); font-size: 12px; }
    .exam-question-meta { color: var(--muted); font-size: 12px; }
    .priority-label { display: inline-flex; padding: 3px 8px; border: 1px solid var(--line); font-weight: 700; }
    .priority-critical { border-color: var(--danger); color: var(--danger); }
    .priority-major { border-color: var(--brand-primary); color: var(--brand-primary); }
    .priority-minor { color: var(--muted); }
    .exam-panel h2 { margin: 0; font-size: 20px; line-height: 1.4; }
    .exam-options { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; }
    .exam-options legend { margin-bottom: 4px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .exam-options label { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; border: 1px solid var(--line); cursor: pointer; line-height: 1.45; }
    .exam-options label.selected { border-color: var(--brand-primary); background: color-mix(in srgb, var(--brand-primary) 7%, var(--surface-raised)); }
    .exam-options input { flex: 0 0 auto; margin: 4px 0 0; accent-color: var(--brand-primary); }
    .exam-short-answer { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .exam-short-answer textarea { width: 100%; padding: 10px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: inherit; font-weight: 400; resize: vertical; }
    .exam-controls { justify-content: flex-end; padding-top: 4px; border-top: 1px solid var(--line); }
    .exam-controls .exam-next { margin-left: auto; }
    .exam-summary { display: grid; justify-items: center; gap: 8px; padding: 30px 18px; border-top: 3px solid var(--brand-primary); background: var(--surface-raised); text-align: center; }
    .exam-summary > mat-icon { color: var(--brand-primary); }
    .exam-summary h2, .exam-summary p { margin: 0; }
    .exam-summary p { color: var(--muted); }
    .exam-summary-actions { justify-content: center; margin-top: 10px; }
    .exam-intro { display: grid; justify-items: center; gap: 8px; padding: 28px 18px; border-top: 3px solid var(--brand-accent); background: var(--surface-raised); text-align: center; }
    .exam-intro > mat-icon { color: var(--brand-primary); }
    .exam-intro h2, .exam-intro p { margin: 0; }
    .exam-intro p { color: var(--muted); }
    .exam-intro button { margin-top: 8px; }
    .exam-outcome { font-weight: 700; }
    .exam-outcome.passed { color: var(--success); }
    .exam-outcome.failed { color: var(--danger); }
    .exam-missed { display: grid; gap: 12px; width: min(100%, 720px); margin-top: 8px; text-align: start; }
    .exam-missed h3, .exam-missed h4, .exam-missed p { margin: 0; }
    .exam-missed article { display: grid; gap: 6px; padding: 12px; border-inline-start: 3px solid var(--danger); background: var(--surface); }
    .exam-missed p { color: var(--muted); }
    .exam-history { display: grid; gap: 10px; margin-top: 28px; }
    .exam-history > header, .exam-history-row, .history-confirm { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .exam-history > header h2 { margin: 0; }
    .exam-history-row { padding: 12px; }
    .exam-history-row > div { display: grid; gap: 4px; }
    .exam-history-row span, .history-confirm p { color: var(--muted); }
    .history-confirm { justify-content: flex-start; padding: 12px; border: 1px solid var(--danger); }
  `],
})
export class AssessmentExamPage implements OnInit {
  readonly loading = signal(true);
  readonly error = signal('');
  readonly questions = signal<AssessmentQuestion[]>([]);
  readonly bankQuestions = signal<AssessmentQuestion[]>([]);
  readonly currentIndex = signal(0);
  readonly answers = signal<Record<string, string>>({});
  readonly results = signal<Record<string, boolean | null>>({});
  readonly feedback = signal<Record<string, string>>({});
  readonly evaluating = signal(false);
  readonly evaluationError = signal('');
  private readonly consent = signal<{ accountId: string; generation: number } | null>(null);
  readonly hasConsent = computed(() => {
    const consent = this.consent();
    return !!consent && this.auth.cloudAuth() === 'authenticated' && this.auth.user()?.id === consent.accountId && this.auth.accountGeneration === consent.generation;
  });
  readonly started = signal(false);
  readonly finished = signal(false);
  readonly savingExam = signal(false);
  readonly saveError = signal('');
  readonly historyError = signal('');
  readonly deletingHistory = signal(false);
  readonly confirmHistoryDelete = signal(false);
  readonly savedSessions = signal<ExamSession[]>([]);
  readonly completedSession = signal<ExamSession | null>(null);
  readonly reviewedSession = signal<ExamSession | null>(null);
  readonly examSessionId = signal('');
  readonly examStartedAt = signal('');
  readonly displaySession = computed(() => this.reviewedSession() ?? this.completedSession());
  readonly missedQuestions = computed(() => (this.displaySession()?.questionResults ?? []).filter((result) => result.correct !== true));
  readonly currentQuestion = computed(() => this.questions()[this.currentIndex()] ?? null);
  readonly response = computed(() => {
    const question = this.currentQuestion();
    return question ? this.answers()[question.id] ?? '' : '';
  });
  readonly currentResult = computed(() => {
    const question = this.currentQuestion();
    if (!question || !Object.hasOwn(this.results(), question.id)) return null;
    return { correct: this.results()[question.id] };
  });
  readonly criticalCount = computed(() => this.questions().filter((question) => question.priority === 'critical').length);
  readonly supplementalCount = computed(() => this.questions().filter((question) => question.priority !== 'critical').length);
  readonly correctCount = computed(() => Object.values(this.results()).filter(Boolean).length);
  readonly scorePercent = computed(() => this.questions().length ? (this.correctCount() / this.questions().length) * 100 : 0);
  readonly criticalGatePassed = computed(() => this.questions().filter((question) => question.priority === 'critical').every((question) => this.results()[question.id] === true));
  readonly examPassed = computed(() => this.scorePercent() >= 85 && this.criticalGatePassed());
  readonly progressPercent = computed(() => this.questions().length ? ((this.currentIndex() + 1) / this.questions().length) * 100 : 0);

  constructor(private readonly bank: AssessmentQuestionBankService, private readonly examiner: ExaminerAiService, private readonly auth: AuthStateService, private readonly memory: StudentMemoryService, private readonly locales: LocaleService = new LocaleService()) {}

  ngOnInit(): void { void this.startNewExam(); }

  async startNewExam(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.started.set(false);
    this.finished.set(false);
    this.currentIndex.set(0);
    this.answers.set({});
    this.results.set({});
    this.feedback.set({});
    this.consent.set(null);
    this.evaluationError.set('');
    this.saveError.set('');
    this.historyError.set('');
    this.completedSession.set(null);
    this.reviewedSession.set(null);
    this.examSessionId.set('');
    this.examStartedAt.set('');
    try {
      const bank = await this.bank.loadBank();
      this.bankQuestions.set(bank.questions);
      this.questions.set(selectExamQuestions(bank.questions));
      try {
        const progress = await this.memory.loadProgress();
        this.savedSessions.set([...(progress?.examSessions ?? [])].sort((first, second) => second.completedAt.localeCompare(first.completedAt)));
      } catch (error) {
        this.historyError.set(error instanceof Error ? error.message : this.locales.translate('exam.historyUnavailable'));
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.locales.translate('exam.tryAgainFromReferences'));
    } finally { this.loading.set(false); }
  }

  beginExam(): void {
    if (!this.questions().length) return;
    this.examSessionId.set(crypto.randomUUID());
    this.examStartedAt.set(new Date().toISOString());
    this.started.set(true);
  }

  setResponse(value: string): void {
    this.consent.set(null);
    this.evaluationError.set('');
    const question = this.currentQuestion();
    if (!question || Object.hasOwn(this.results(), question.id)) return;
    this.answers.update((answers) => ({ ...answers, [question.id]: value }));
    this.results.update((results) => {
      const next = { ...results };
      delete next[question.id];
      return next;
    });
  }

  setResponseFromEvent(event: Event): void {
    this.setResponse((event.target as HTMLTextAreaElement).value);
  }

  setConsent(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const accountId = this.auth.user()?.id;
    this.consent.set(checked && accountId && this.auth.cloudAuth() === 'authenticated' ? { accountId, generation: this.auth.accountGeneration } : null);
    if (checked && !this.hasConsent()) {
      (event.target as HTMLInputElement).checked = false;
      this.evaluationError.set(this.locales.translate('exam.onlineSignInRequired'));
    }
    else this.evaluationError.set('');
  }

  async checkAnswer(): Promise<void> {
    const question = this.currentQuestion();
    if (!question || Object.hasOwn(this.results(), question.id)) return;
    const answer = this.response();
    if (question.type === 'choice') {
      this.results.update((results) => ({ ...results, [question.id]: answer === question.answer }));
      return;
    }
    if (!this.hasConsent() || this.consent()?.generation !== this.auth.accountGeneration || this.evaluating()) return;
    if (answer.trim().length > 12000) {
      this.evaluationError.set(this.locales.translate('exam.answerTooLong'));
      return;
    }
    const consent = this.consent();
    this.consent.set(null);
    this.evaluationError.set('');
    this.evaluating.set(true);
    try {
      const result = await this.examiner.evaluateFreeText({ topicId: question.sectionId, context: `Question: ${question.prompt}\nReference: ${question.sourceRef}\nModel answer: ${question.modelAnswer}\nExplanation: ${question.explanation}`, answer, onlineConsent: true });
      if (this.auth.accountGeneration !== consent?.generation || this.auth.user()?.id !== consent.accountId || this.auth.cloudAuth() !== 'authenticated' || this.currentQuestion()?.id !== question.id || this.response() !== answer) return;
      this.results.update((results) => ({ ...results, [question.id]: result.passed }));
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      this.evaluationError.set(status === 422 ? this.locales.translate('exam.invalidAnswer') : status === 429 ? this.locales.translate('exam.evaluationLimit') : this.locales.translate('exam.evaluationUnavailable'));
    } finally { this.evaluating.set(false); }
  }

  skipAnswer(): void {
    const question = this.currentQuestion();
    if (question?.type === 'short-answer' && !this.evaluating() && !Object.hasOwn(this.results(), question.id)) this.results.update((results) => ({ ...results, [question.id]: null }));
    this.consent.set(null);
  }

  previousQuestion(): void { this.consent.set(null); this.evaluationError.set(''); this.currentIndex.update((index) => Math.max(0, index - 1)); }
  nextQuestion(): void { this.consent.set(null); this.evaluationError.set(''); this.currentIndex.update((index) => Math.min(this.questions().length - 1, index + 1)); }
  async finishExam(): Promise<void> {
    if (this.savingExam() || !this.currentQuestion() || this.currentResult() === null) return;
    const now = new Date().toISOString();
    const questionResults: ExamQuestionResult[] = this.questions().map((question) => ({
      questionId: question.id,
      topicId: question.sectionId,
      objectiveIds: [...question.coverageIds],
      priority: question.priority,
      submittedAnswer: this.answers()[question.id] ?? '',
      correct: this.results()[question.id] ?? null,
    }));
    const criticalGatePassed = questionResults.filter((result) => result.priority === 'critical').every((result) => result.correct === true);
    const score = this.questions().length ? (questionResults.filter((result) => result.correct === true).length / this.questions().length) * 100 : 0;
    const session: ExamSession = {
      id: this.examSessionId() || crypto.randomUUID(),
      startedAt: this.examStartedAt() || now,
      completedAt: now,
      questionResults,
      score,
      passed: score >= 85 && criticalGatePassed,
      criticalGatePassed,
    };
    this.savingExam.set(true);
    this.saveError.set('');
    try {
      const progress = await this.memory.recordExamSession(session);
      this.savedSessions.set([...(progress.examSessions ?? [])].sort((first, second) => second.completedAt.localeCompare(first.completedAt)));
      this.completedSession.set(session);
      this.reviewedSession.set(null);
      this.finished.set(true);
    } catch (error) {
      this.saveError.set(error instanceof Error ? error.message : this.locales.translate('exam.saveFailed'));
    } finally { this.savingExam.set(false); }
  }

  questionFor(questionId: string): AssessmentQuestion | null {
    return this.bankQuestions().find((question) => question.id === questionId) ?? null;
  }

  correctAnswer(question: AssessmentQuestion): string {
    return question.type === 'choice' ? question.options.find((option) => option.id === question.answer)?.text ?? '' : question.modelAnswer;
  }

  submittedAnswer(result: ExamQuestionResult, question: AssessmentQuestion): string {
    if (!result.submittedAnswer) return this.locales.translate('exam.notAnswered');
    return question.type === 'choice'
      ? question.options.find((option) => option.id === result.submittedAnswer)?.text ?? result.submittedAnswer
      : result.submittedAnswer;
  }

  formatExamDate(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  isCriticalResult(result: ExamQuestionResult): boolean {
    return result.priority === 'critical';
  }

  reviewSavedExam(session: ExamSession): void {
    this.reviewedSession.set(session);
    this.completedSession.set(null);
    this.started.set(false);
    this.finished.set(true);
  }

  async deleteHistory(): Promise<void> {
    if (this.deletingHistory()) return;
    this.deletingHistory.set(true);
    this.historyError.set('');
    try {
      await this.memory.deleteExamHistory();
      this.savedSessions.set([]);
      this.completedSession.set(null);
      this.reviewedSession.set(null);
      this.finished.set(false);
      this.started.set(false);
      this.answers.set({});
      this.results.set({});
      this.confirmHistoryDelete.set(false);
    } catch (error) {
      this.historyError.set(error instanceof Error ? error.message : this.locales.translate('exam.deleteFailed'));
    } finally { this.deletingHistory.set(false); }
  }
}