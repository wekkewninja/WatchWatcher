import { Component, OnInit, computed, signal } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { AuthStateService } from '../core/auth-state.service';
import { LocaleService, TranslationPipe } from '../core/locale.service';
import { ExaminerAiService } from '../core/services/examiner-ai.service';
import { AssessmentQuestionBankService } from '../core/services/assessment-question-bank.service';
import { selectExamQuestions, type AssessmentQuestion } from '../core/services/assessment-question-bank';

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
          <p>{{ 'exam.results' | t: { correct: correctCount(), checked: checkedCount(), unchecked: questions().length - checkedCount() } }}</p>
          <p>{{ 'exam.compositionSummary' | t: { critical: criticalCount(), supplemental: supplementalCount() } }}</p>
          <div class="exam-summary-actions"><button mat-flat-button type="button" (click)="reviewExam()"><mat-icon>fact_check</mat-icon> {{ 'exam.reviewAnswers' | t }}</button><button mat-stroked-button type="button" (click)="startNewExam()"><mat-icon>shuffle</mat-icon> {{ 'exam.newExam' | t }}</button></div>
        </section>
      } @else if (!started()) {
        <section class="exam-intro" aria-labelledby="exam-intro-heading">
          <mat-icon>fact_check</mat-icon>
          <h2 id="exam-intro-heading">{{ 'exam.composition' | t }}</h2>
          <p><strong>{{ 'exam.criticalGuaranteed' | t: { count: criticalCount() } }}</strong></p>
          <p>{{ 'exam.supplementalRandomized' | t: { count: supplementalCount() } }}</p>
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
                  <input type="radio" name="exam-answer" [value]="option.id" [checked]="response() === option.id" (change)="setResponse(option.id)">
                  <span>{{ option.text }}</span>
                </label>
              }
            </fieldset>
          } @else {
            <label class="exam-short-answer"><span>{{ 'exam.yourAnswer' | t }}</span><textarea rows="5" [disabled]="evaluating()" [value]="response()" (input)="setResponseFromEvent($event)" [placeholder]="'exam.writeResponse' | t"></textarea></label>
            @if (!currentResult()) {
              <p>{{ 'exam.onlineEvaluationDisclosure' | t }}</p>
              <label><input type="checkbox" [checked]="hasConsent()" (change)="setConsent($event)"> {{ 'exam.onlineConsent' | t }}</label>
              <p>{{ 'exam.onlineAccountRequired' | t }} <a routerLink="/examiner">{{ 'exam.offlineStructuredPractice' | t }}</a>{{ 'exam.skipWithoutGradingSentence' | t }}</p>
              <p>{{ 'exam.aiDisclaimer' | t }}</p>
              @if (response().trim().length > 12000) { <p role="alert">{{ 'exam.answerTooLong' | t }}</p> }
              @if (evaluationError()) { <p role="alert">{{ evaluationError() }}</p> }
            }
          }

          @if (currentResult(); as result) {
            <div class="exam-feedback" [class.correct]="result.correct" role="status">
              <strong>{{ (result.correct === null ? 'exam.notGraded' : result.correct ? 'exam.correct' : 'exam.reviewAnswer') | t }}</strong>
              @if (result.correct !== null) {
                <p>{{ question.explanation }}</p>
                @if (question.type === 'short-answer') { <p>{{ feedback()[question.id] }}</p> }
                @if (!result.correct) { <p>{{ question.remediation }}</p> }
              }
            </div>
          }

          <div class="exam-controls">
            <button mat-stroked-button type="button" [disabled]="currentIndex() === 0 || evaluating()" (click)="previousQuestion()"><mat-icon>arrow_back</mat-icon> {{ 'exam.previous' | t }}</button>
            @if (!currentResult()) {
              @if (question.type === 'short-answer') { <button mat-stroked-button type="button" [disabled]="evaluating()" (click)="skipAnswer()">{{ 'exam.skipWithoutGrading' | t }}</button> }
              <button mat-flat-button type="button" [disabled]="!response().trim() || evaluating() || (question.type === 'short-answer' && (!hasConsent() || response().trim().length > 12000))" (click)="checkAnswer()">{{ (evaluating() ? 'exam.checking' : 'exam.checkAnswer') | t }}</button>
            }
            @if (currentIndex() < questions().length - 1) {
              <button mat-stroked-button type="button" class="exam-next" [disabled]="!currentResult()" (click)="nextQuestion()">{{ 'exam.next' | t }} <mat-icon>arrow_forward</mat-icon></button>
            } @else {
              <button mat-flat-button type="button" [disabled]="!currentResult()" (click)="finishExam()">{{ 'exam.finish' | t }} <mat-icon>check</mat-icon></button>
            }
          </div>
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
    .exam-feedback { padding: 12px; border-inline-start: 4px solid var(--brand-accent); background: color-mix(in srgb, var(--brand-accent) 8%, var(--surface-raised)); }
    .exam-feedback.correct { border-color: var(--success); background: color-mix(in srgb, var(--success) 8%, var(--surface-raised)); }
    .exam-feedback p { margin: 6px 0 0; color: var(--muted); }
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
  `],
})
export class AssessmentExamPage implements OnInit {
  readonly loading = signal(true);
  readonly error = signal('');
  readonly questions = signal<AssessmentQuestion[]>([]);
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
  readonly checkedCount = computed(() => Object.values(this.results()).filter((result) => result !== null).length);
  readonly correctCount = computed(() => Object.values(this.results()).filter(Boolean).length);
  readonly progressPercent = computed(() => this.questions().length ? ((this.currentIndex() + 1) / this.questions().length) * 100 : 0);

  constructor(private readonly bank: AssessmentQuestionBankService, private readonly examiner: ExaminerAiService, private readonly auth: AuthStateService, private readonly locales: LocaleService = new LocaleService()) {}

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
    try {
      const bank = await this.bank.loadBank();
      this.questions.set(selectExamQuestions(bank.questions));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.locales.translate('exam.tryAgainFromReferences'));
    } finally { this.loading.set(false); }
  }

  beginExam(): void { this.started.set(true); }

  setResponse(value: string): void {
    this.consent.set(null);
    this.evaluationError.set('');
    const question = this.currentQuestion();
    if (!question) return;
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
    if (!question) return;
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
      this.feedback.update((feedback) => ({ ...feedback, [question.id]: result.criticalFailureReason ? `${result.feedback} ${result.criticalFailureReason}` : result.feedback }));
      this.results.update((results) => ({ ...results, [question.id]: result.passed }));
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      this.evaluationError.set(status === 422 ? this.locales.translate('exam.invalidAnswer') : status === 429 ? this.locales.translate('exam.evaluationLimit') : this.locales.translate('exam.evaluationUnavailable'));
    } finally { this.evaluating.set(false); }
  }

  skipAnswer(): void {
    const question = this.currentQuestion();
    if (question?.type === 'short-answer' && !this.evaluating()) this.results.update((results) => ({ ...results, [question.id]: null }));
    this.consent.set(null);
  }

  previousQuestion(): void { this.consent.set(null); this.evaluationError.set(''); this.currentIndex.update((index) => Math.max(0, index - 1)); }
  nextQuestion(): void { this.consent.set(null); this.evaluationError.set(''); this.currentIndex.update((index) => Math.min(this.questions().length - 1, index + 1)); }
  finishExam(): void { this.finished.set(true); }
  reviewExam(): void { this.finished.set(false); this.started.set(true); this.currentIndex.set(0); }
}