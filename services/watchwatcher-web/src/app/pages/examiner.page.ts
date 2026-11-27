import { Component, OnInit, computed, signal } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import type { ColregsRule, ProgressSnapshot } from '../domain-types';
import { StudentMemoryService } from '../core/student-memory.service';
import { selectNextRuleExercise, summarizeRuleExercise, emptyProgressSnapshot } from '../core/student-memory.service';
import { ColregsReferenceService } from '../core/services/colregs-reference.service';
import { ColregsExerciseCardComponent } from '../shared/colregs-exercise-card.component';
import { LocaleService, TranslationPipe } from '../core/locale.service';
import { AssessmentQuestionBankService } from '../core/services/assessment-question-bank.service';
import { ExaminerAiService } from '../core/services/examiner-ai.service';
import { AuthStateService } from '../core/auth-state.service';
import type { AssessmentQuestion } from '../core/services/assessment-question-bank';

interface PracticeSection {
  id: string;
  title: string;
  questionCount: number;
}

interface PracticeAnswerResult {
  correct: boolean | null;
  feedback: string;
}

@Component({
  standalone: true,
  imports: [TitleCasePipe, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatProgressBarModule, MatSelectModule, ColregsExerciseCardComponent, TranslationPipe],
  template: `
    <main class="page-content examiner-page">
      <header class="page-heading"><div><span class="eyebrow">{{ 'examiner.eyebrow' | t }}</span><h1>{{ 'examiner.heading' | t }}</h1><p>{{ 'examiner.description' | t }}</p></div><span class="threshold-badge"><mat-icon>task_alt</mat-icon> {{ 'examiner.completed' | t: { completed: completedCount(), total: rules().length } }}</span></header>
      @if (loading()) { <mat-card class="state-card"><mat-progress-bar mode="indeterminate"/><p>{{ 'examiner.loading' | t }}</p></mat-card> }
      @else if (error()) { <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>{{ 'examiner.unavailable' | t }}</strong><p>{{ error() }}</p></div><button mat-stroked-button (click)="load()">{{ 'examiner.tryAgain' | t }}</button></mat-card> }
      @else if (currentRule(); as rule) {
        <section class="exam-workspace">
          <div class="exam-workspace-heading"><div><span class="eyebrow">{{ rule.category }}</span><h2>{{ rule.ruleNumber }} · {{ rule.title }}</h2><p>{{ rule.summary }}</p></div><mat-form-field appearance="outline"><mat-label>{{ 'examiner.chooseRule' | t }}</mat-label><mat-select [value]="rule.id" (selectionChange)="selectRule($event.value)">@for (entry of rules(); track entry.id) { <mat-option [value]="entry.id">{{ entry.ruleNumber }} · {{ entry.title }}</mat-option> }</mat-select></mat-form-field></div>
          <ww-colregs-exercise-card [rule]="rule" (progressChanged)="updateProgress($event)" />
          <div class="learning-actions"><button mat-stroked-button type="button" (click)="selectNextExercise()"><mat-icon>skip_next</mat-icon>{{ (completedCount() === rules().length ? 'examiner.reviewWeakest' : 'examiner.nextUnfinished') | t }}</button><a mat-button [routerLink]="['/colregs', rule.id]"><mat-icon>menu_book</mat-icon> {{ 'examiner.openReference' | t }}</a></div>
        </section>
        <section class="coverage-practice" aria-labelledby="coverage-practice-heading">
          <header class="coverage-practice-heading"><div><span class="eyebrow">{{ 'examiner.coveragePractice.eyebrow' | t }}</span><h2 id="coverage-practice-heading">{{ 'examiner.coveragePractice.heading' | t }}</h2><p>{{ 'examiner.coveragePractice.description' | t }}</p></div>
            @if (practiceSections().length) {
              <mat-form-field appearance="outline"><mat-label>{{ 'examiner.coveragePractice.sectionLabel' | t }}</mat-label><mat-select [value]="selectedPracticeSectionId()" [disabled]="practiceEvaluating() || practiceSaving()" (selectionChange)="selectPracticeSection($event.value)">@for (section of practiceSections(); track section.id) { <mat-option [value]="section.id">{{ section.title }} · {{ section.questionCount }}</mat-option> }</mat-select></mat-form-field>
            }
          </header>
          @if (currentPracticeQuestion(); as question) {
            <mat-card class="coverage-question">
              <span class="practice-position">{{ 'examiner.coveragePractice.position' | t: { round: practiceRound(), current: practiceIndex() + 1, total: roundQuestions().length } }}</span>
              <div class="practice-question-meta"><span class="priority-label" [class.priority-critical]="question.priority === 'critical'" [class.priority-major]="question.priority === 'major'" [class.priority-minor]="question.priority === 'minor'">{{ question.priority | titlecase }}</span><span>{{ question.sourceRef }}</span></div>
              <h3>{{ question.prompt }}</h3>
              @if (question.type === 'choice') {
                <fieldset class="coverage-options"><legend>{{ 'exam.chooseBestAnswer' | t }}</legend>@for (option of question.options; track option.id) { <label [class.selected]="practiceOption() === option.id"><input type="radio" name="coverage-answer" [value]="option.id" [checked]="practiceOption() === option.id" [disabled]="practiceSaving() || practiceChecked() !== null" (change)="selectPracticeOption(option.id)"><span>{{ option.text }}</span></label> }</fieldset>
              } @else {
                <label class="practice-answer"><span>{{ 'learning.writeAnswer' | t }}</span><textarea rows="4" maxlength="12000" [disabled]="practiceEvaluating() || practiceSaving() || practiceChecked() !== null" [value]="practiceAnswer()" (input)="setPracticeAnswer($event)"></textarea></label>
                @if (practiceChecked() === null) {
                  <p>{{ 'learning.onlineEvaluationDisclosure' | t }}</p>
                  <label class="practice-consent"><input type="checkbox" [checked]="hasPracticeConsent()" (change)="setPracticeConsent($event)"> {{ 'learning.onlineConsent' | t }}</label>
                  <p>{{ 'learning.onlineAccountRequired' | t }} <a routerLink="/login">{{ 'learning.signIn' | t }}</a>{{ 'learning.skipOffline' | t }}</p>
                  <p>{{ 'learning.aiDisclaimer' | t }}</p>
                }
              }
              @if (practiceError()) { <p role="alert">{{ practiceError() }}</p> }
              @if (practiceChecked(); as result) {
                <div class="practice-feedback" [class.correct]="result.correct === true" role="status">
                  <strong>{{ (result.correct === null ? 'learning.notGraded' : result.correct ? 'exercise.correct' : 'exercise.reviewThisOne') | t }}</strong>
                  @if (result.correct !== null) {
                    @if (result.feedback) { <p>{{ result.feedback }}</p> }
                    <p><strong>{{ 'exam.correctAnswer' | t }}</strong> {{ correctPracticeAnswer(question) }}</p>
                    <p><strong>{{ 'exam.explanation' | t }}</strong> {{ question.explanation }}</p>
                    @if (!result.correct) { <p>{{ question.remediation }}</p> }
                  } @else { <p>{{ 'learning.ungradedNotice' | t }}</p> }
                </div>
              }
              <div class="coverage-controls">
                @if (practiceChecked() === null) {
                  <button mat-button type="button" [disabled]="practiceEvaluating() || practiceSaving()" (click)="skipPracticeQuestion()">{{ 'learning.skipUngraded' | t }}</button>
                  <button mat-flat-button type="button" [disabled]="practiceSaving() || practiceEvaluating() || (question.type === 'choice' ? !practiceOption() : !practiceAnswer().trim() || !hasPracticeConsent() || practiceAnswer().trim().length > 12000)" (click)="checkPracticeAnswer()"><mat-icon>check</mat-icon>{{ (practiceEvaluating() ? 'examiner.coveragePractice.evaluating' : practiceSaving() ? 'exercise.saving' : 'examiner.coveragePractice.check') | t }}</button>
                } @else {
                  <button mat-flat-button type="button" (click)="advancePracticeQuestion()">{{ 'learning.nextQuestion' | t }} <mat-icon>arrow_forward</mat-icon></button>
                }
              </div>
            </mat-card>
          } @else if (practiceReviewAvailable()) {
            <mat-card class="coverage-practice-state"><h3>{{ 'learning.roundComplete' | t }}</h3><p>{{ 'learning.missedCount' | t: { count: nextPracticeFailures().length } }}</p><button mat-flat-button type="button" (click)="startPracticeReview()"><mat-icon>replay</mat-icon>{{ 'learning.reviewMissed' | t }}</button></mat-card>
          } @else if (practiceComplete()) {
            <mat-card class="coverage-practice-state"><mat-icon>task_alt</mat-icon><h3>{{ 'learning.practiceComplete' | t }}</h3></mat-card>
          } @else {
            <mat-card class="coverage-practice-state"><p>{{ 'examiner.coveragePractice.empty' | t }}</p></mat-card>
          }
        </section>
      } @else { <mat-card class="state-card empty-state"><mat-icon>quiz</mat-icon><h2>{{ 'examiner.noEntries' | t }}</h2><p>{{ 'examiner.noEntriesDescription' | t }}</p><a mat-flat-button routerLink="/colregs">{{ 'examiner.openReferenceButton' | t }}</a></mat-card> }
    </main>
  `,
  styles: [`
    .coverage-practice { display: grid; gap: 14px; margin-top: 30px; }
    .coverage-practice-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
    .coverage-practice-heading h2, .coverage-practice-heading p { margin: 0; }
    .coverage-practice-heading p { color: var(--muted); }
    .coverage-practice-heading mat-form-field { width: min(100%, 380px); }
    .coverage-question, .coverage-practice-state { display: grid; gap: 14px; padding: 18px; }
    .practice-position, .practice-question-meta { color: var(--muted); font-size: 12px; }
    .practice-question-meta { display: flex; align-items: center; gap: 10px; }
    .priority-label { display: inline-flex; padding: 3px 8px; border: 1px solid var(--line); font-weight: 700; }
    .priority-critical { border-color: var(--danger); color: var(--danger); }
    .priority-major { border-color: var(--brand-primary); color: var(--brand-primary); }
    .priority-minor { color: var(--muted); }
    .coverage-question h3 { margin: 0; font-size: 18px; }
    .coverage-options { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; }
    .coverage-options legend { margin-bottom: 4px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .coverage-options label { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; border: 1px solid var(--line); cursor: pointer; }
    .coverage-options label.selected { border-color: var(--brand-primary); background: color-mix(in srgb, var(--brand-primary) 7%, var(--surface-raised)); }
    .coverage-options input { flex: 0 0 auto; margin: 4px 0 0; accent-color: var(--brand-primary); }
    .practice-answer { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .practice-answer textarea { width: 100%; padding: 10px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: inherit; font-weight: 400; resize: vertical; }
    .practice-consent { display: flex; align-items: flex-start; gap: 8px; color: var(--ink); font-size: 13px; }
    .practice-consent input { flex: 0 0 auto; margin: 3px 0 0; accent-color: var(--brand-primary); }
    .practice-feedback { padding: 12px; border-inline-start: 4px solid var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--surface-raised)); }
    .practice-feedback.correct { border-color: var(--success); background: color-mix(in srgb, var(--success) 8%, var(--surface-raised)); }
    .practice-feedback p { margin: 6px 0 0; color: var(--muted); }
    .coverage-controls { display: flex; justify-content: flex-end; gap: 8px; }
  `],
})
export class ExaminerPage implements OnInit {
  readonly rules = signal<ColregsRule[]>([]);
  readonly progress = signal<ProgressSnapshot>(emptyProgressSnapshot());
  readonly selectedRuleId = signal('');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly practiceSections = signal<PracticeSection[]>([]);
  readonly bankQuestions = signal<AssessmentQuestion[]>([]);
  readonly selectedPracticeSectionId = signal('');
  readonly roundQuestions = signal<AssessmentQuestion[]>([]);
  readonly nextPracticeFailures = signal<AssessmentQuestion[]>([]);
  readonly practiceIndex = signal(0);
  readonly practiceRound = signal(1);
  readonly practiceAnswer = signal('');
  readonly practiceOption = signal<string | null>(null);
  readonly practiceChecked = signal<PracticeAnswerResult | null>(null);
  readonly practiceSaving = signal(false);
  readonly practiceEvaluating = signal(false);
  readonly practiceError = signal('');
  readonly practiceReviewAvailable = signal(false);
  readonly practiceComplete = signal(false);
  private readonly practiceConsent = signal<{ accountId: string; generation: number } | null>(null);
  readonly hasPracticeConsent = computed(() => {
    const consent = this.practiceConsent();
    return !!consent && this.auth.cloudAuth() === 'authenticated' && this.auth.user()?.id === consent.accountId && this.auth.accountGeneration === consent.generation;
  });
  readonly currentRule = computed(() => this.rules().find((rule) => rule.id === this.selectedRuleId()) ?? null);
  readonly completedCount = computed(() => this.rules().filter((rule) => summarizeRuleExercise(rule.id, this.progress()).completed).length);
  readonly currentPracticeQuestion = computed(() => this.practiceReviewAvailable() || this.practiceComplete() ? null : this.roundQuestions()[this.practiceIndex()] ?? null);

  constructor(private readonly memory: StudentMemoryService, private readonly reference: ColregsReferenceService, private readonly bank: AssessmentQuestionBankService, private readonly examiner: ExaminerAiService, private readonly auth: AuthStateService, private readonly locales: LocaleService = new LocaleService()) {}

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [rules, progress, bank] = await Promise.all([this.reference.search(''), this.memory.loadAndMergeCloudProgress(), this.bank.loadBank()]);
      this.rules.set(rules);
      this.progress.set(progress);
      this.selectedRuleId.set(selectNextRuleExercise(rules, progress)?.id ?? '');
      this.bankQuestions.set(bank.questions);
      const sections = new Map<string, PracticeSection>();
      for (const question of bank.questions) {
        const section = sections.get(question.sectionId);
        if (section) section.questionCount += 1;
        else sections.set(question.sectionId, { id: question.sectionId, title: question.sectionTitle, questionCount: 1 });
      }
      this.practiceSections.set([...sections.values()]);
      if (sections.size) this.selectPracticeSection(sections.keys().next().value!);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.locales.translate('examiner.retryFromReference'));
    } finally { this.loading.set(false); }
  }

  selectRule(ruleId: string): void { this.selectedRuleId.set(ruleId); }

  updateProgress(progress: ProgressSnapshot): void {
    this.progress.set(progress);
  }

  selectNextExercise(): void {
    const next = selectNextRuleExercise(this.rules(), this.progress());
    if (next) this.selectedRuleId.set(next.id);
  }

  selectPracticeSection(sectionId: string): void {
    if (this.practiceEvaluating() || this.practiceSaving()) return;
    this.selectedPracticeSectionId.set(sectionId);
    const questions = this.bankQuestions().filter((question) => question.sectionId === sectionId);
    this.roundQuestions.set(questions);
    this.nextPracticeFailures.set([]);
    this.practiceIndex.set(0);
    this.practiceRound.set(1);
    this.practiceAnswer.set('');
    this.practiceOption.set(null);
    this.practiceChecked.set(null);
    this.practiceReviewAvailable.set(false);
    this.practiceComplete.set(false);
    this.practiceError.set('');
    this.practiceConsent.set(null);
  }

  selectPracticeOption(optionId: string): void {
    if (this.practiceChecked() !== null || this.practiceSaving()) return;
    this.practiceOption.set(optionId);
  }

  setPracticeAnswer(event: Event): void {
    if (this.practiceChecked() !== null || this.practiceSaving() || this.practiceEvaluating()) return;
    this.practiceAnswer.set((event.target as HTMLTextAreaElement).value);
    this.practiceConsent.set(null);
    this.practiceError.set('');
  }

  setPracticeConsent(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const accountId = this.auth.user()?.id;
    this.practiceConsent.set(checked && accountId && this.auth.cloudAuth() === 'authenticated' ? { accountId, generation: this.auth.accountGeneration } : null);
    if (checked && !this.hasPracticeConsent()) {
      (event.target as HTMLInputElement).checked = false;
      this.practiceError.set(this.locales.translate('exam.onlineSignInRequired'));
    } else this.practiceError.set('');
  }

  async checkPracticeAnswer(): Promise<void> {
    const question = this.currentPracticeQuestion();
    if (!question || this.practiceChecked() !== null || this.practiceSaving() || this.practiceEvaluating()) return;
    let correct: boolean;
    let feedback = '';
    if (question.type === 'choice') {
      const selected = this.practiceOption();
      if (!selected) return;
      correct = selected === question.answer;
    } else {
      const answer = this.practiceAnswer();
      const consent = this.practiceConsent();
      if (!answer.trim() || answer.trim().length > 12000 || !this.hasPracticeConsent()) return;
      this.practiceConsent.set(null);
      this.practiceEvaluating.set(true);
      this.practiceError.set('');
      try {
        const result = await this.examiner.evaluateFreeText({
          topicId: question.sectionId,
          context: `Question: ${question.prompt}\nReference: ${question.sourceRef}\nModel answer: ${question.modelAnswer}\nExplanation: ${question.explanation}`,
          answer,
          onlineConsent: true,
        });
        if (this.auth.accountGeneration !== consent?.generation || this.auth.user()?.id !== consent.accountId || this.auth.cloudAuth() !== 'authenticated' || this.currentPracticeQuestion()?.id !== question.id || this.practiceAnswer() !== answer) return;
        correct = result.passed;
        feedback = result.feedback;
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
        this.practiceError.set(status === 422 ? this.locales.translate('exam.invalidAnswer') : status === 429 ? this.locales.translate('exam.evaluationLimit') : error instanceof Error ? error.message : this.locales.translate('exam.evaluationUnavailable'));
        return;
      } finally { this.practiceEvaluating.set(false); }
    }
    this.practiceSaving.set(true);
    try {
      await this.memory.recordObjectivePracticeAttempt({ questionId: question.id, topicId: question.sectionId, objectiveIds: question.coverageIds, correct });
      this.practiceChecked.set({ correct, feedback });
      this.practiceError.set('');
    } catch (error) {
      this.practiceError.set(error instanceof Error ? error.message : this.locales.translate('learning.saveAnswerFailed'));
    } finally { this.practiceSaving.set(false); }
  }

  skipPracticeQuestion(): void {
    if (this.currentPracticeQuestion() && this.practiceChecked() === null && !this.practiceSaving() && !this.practiceEvaluating()) {
      this.practiceChecked.set({ correct: null, feedback: '' });
      this.practiceConsent.set(null);
    }
  }

  correctPracticeAnswer(question: AssessmentQuestion): string {
    return question.type === 'choice' ? question.options.find((option) => option.id === question.answer)?.text ?? '' : question.modelAnswer;
  }

  advancePracticeQuestion(): void {
    const question = this.currentPracticeQuestion();
    const result = this.practiceChecked();
    if (!question || !result) return;
    if (result.correct === false) this.nextPracticeFailures.update((failures) => failures.some((item) => item.id === question.id) ? failures : [...failures, question]);
    if (this.practiceIndex() < this.roundQuestions().length - 1) {
      this.practiceIndex.update((index) => index + 1);
      this.resetCurrentPracticeAnswer();
      return;
    }
    if (this.nextPracticeFailures().length) this.practiceReviewAvailable.set(true);
    else this.practiceComplete.set(true);
    this.resetCurrentPracticeAnswer();
  }

  startPracticeReview(): void {
    const failures = this.nextPracticeFailures();
    if (!failures.length) return;
    this.roundQuestions.set(failures);
    this.nextPracticeFailures.set([]);
    this.practiceIndex.set(0);
    this.practiceRound.update((round) => round + 1);
    this.practiceReviewAvailable.set(false);
    this.practiceComplete.set(false);
  }

  private resetCurrentPracticeAnswer(): void {
    this.practiceAnswer.set('');
    this.practiceOption.set(null);
    this.practiceChecked.set(null);
    this.practiceError.set('');
    this.practiceConsent.set(null);
  }
}
