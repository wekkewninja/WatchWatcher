import { Component, input, output, signal, type OnChanges } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import type { ColregsRule, ProgressSnapshot } from '../domain-types';
import { StudentMemoryService, summarizeRuleExercise, type RuleExerciseSummary } from '../core/student-memory.service';
import { LocaleService, TranslationPipe } from '../core/locale.service';

@Component({
  selector: 'ww-colregs-exercise-card',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule, TranslationPipe],
  template: `
    <mat-card class="rule-detail-card rule-practice-card">
      <mat-card-header><mat-icon mat-card-avatar>quiz</mat-icon><mat-card-title>{{ 'exercise.practiceScenario' | t }}</mat-card-title><mat-card-subtitle>{{ 'exercise.chooseSafest' | t }}</mat-card-subtitle></mat-card-header>
      <mat-card-content>
        <p class="exercise-prompt">{{ rule().exercise.prompt }}</p>
        <fieldset class="exercise-options">
          <legend>{{ 'exercise.answerChoices' | t }}</legend>
          @for (option of rule().exercise.options; track option.id) {
            <label [class.selected]="selectedOption() === option.id">
              <input type="radio" [name]="'exercise-' + rule().id" [value]="option.id" [checked]="selectedOption() === option.id" [disabled]="saving() || (exerciseChecked() && !saveFailed())" (change)="selectOption(option.id)">
              <span>{{ option.text }}</span>
            </label>
          }
        </fieldset>
        <button mat-flat-button type="button" [disabled]="!selectedOption() || saving() || (exerciseChecked() && !saveFailed())" (click)="checkAnswer()">
          <mat-icon>{{ saving() ? 'hourglass_top' : 'task_alt' }}</mat-icon>{{ (saving() ? 'exercise.saving' : 'exercise.checkAnswer') | t }}
        </button>
        @if (summary().attempts) { <p class="exercise-history">{{ (summary().completed ? 'exercise.historyCompleted' : 'exercise.historyInProgress') | t: { count: summary().attempts, mastery: summary().mastery } }}</p> }
        @if (exerciseChecked()) {
          <div class="exercise-feedback" [class.correct]="selectedOption() === rule().exercise.answer" role="status">
            <strong>{{ (selectedOption() === rule().exercise.answer ? 'exercise.correct' : 'exercise.reviewThisOne') | t }}</strong>
            <p>{{ rule().exercise.explanation }}</p>
            @if (selectedOption() !== rule().exercise.answer) {
              <p><strong>{{ 'exercise.correctAnswer' | t }}</strong> {{ correctAnswer() }}</p>
              <p><strong>{{ 'exercise.review' | t }}</strong> {{ rule().exercise.remediation }}</p>
            }
          </div>
        }
        @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
      </mat-card-content>
    </mat-card>
  `,
})
export class ColregsExerciseCardComponent implements OnChanges {
  readonly rule = input.required<ColregsRule>();
  readonly progressChanged = output<ProgressSnapshot>();
  readonly selectedOption = signal<string | null>(null);
  readonly exerciseChecked = signal(false);
  readonly saving = signal(false);
  readonly saveFailed = signal(false);
  readonly error = signal('');
  readonly summary = signal<RuleExerciseSummary>({ attempts: 0, correctAttempts: 0, completed: false, mastery: 0, lastAttemptAt: null });

  constructor(private readonly memory: StudentMemoryService, private readonly locales: LocaleService = new LocaleService()) {}

  ngOnChanges(): void {
    this.selectedOption.set(null);
    this.exerciseChecked.set(false);
    this.saveFailed.set(false);
    this.error.set('');
    void this.loadSummary();
  }

  selectOption(optionId: string): void {
    if (this.exerciseChecked() && !this.saveFailed()) return;
    this.selectedOption.set(optionId);
    this.exerciseChecked.set(false);
    this.saveFailed.set(false);
    this.error.set('');
  }

  correctAnswer(): string {
    return this.rule().exercise.options.find((option) => option.id === this.rule().exercise.answer)?.text ?? '';
  }

  async checkAnswer(): Promise<void> {
    const selected = this.selectedOption();
    if (!selected || (this.exerciseChecked() && !this.saveFailed())) return;
    this.saving.set(true);
    this.error.set('');
    this.saveFailed.set(false);
    const rule = this.rule();
    try {
      const progress = await this.memory.recordRuleExerciseAttempt(rule.id, selected, rule.exercise.answer);
      this.summary.set(summarizeRuleExercise(rule.id, progress));
      this.progressChanged.emit(progress);
    } catch (error) {
      this.saveFailed.set(true);
      this.error.set(error instanceof Error ? this.locales.translate('exercise.saveFailed', { message: error.message }) : this.locales.translate('exercise.saveFailedGeneric'));
    } finally {
      this.exerciseChecked.set(true);
      this.saving.set(false);
    }
  }

  private async loadSummary(): Promise<void> {
    const ruleId = this.rule().id;
    const progress = await this.memory.loadProgress();
    this.summary.set(summarizeRuleExercise(ruleId, progress ?? {
      topicMastery: {},
      weakSpotLog: [],
      drillQueue: [],
      ruleExerciseAttempts: [],
    }));
  }
}
