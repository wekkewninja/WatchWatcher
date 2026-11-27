import { Component, OnInit, computed, signal } from '@angular/core';
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

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatProgressBarModule, MatSelectModule, ColregsExerciseCardComponent, TranslationPipe],
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
      } @else { <mat-card class="state-card empty-state"><mat-icon>quiz</mat-icon><h2>{{ 'examiner.noEntries' | t }}</h2><p>{{ 'examiner.noEntriesDescription' | t }}</p><a mat-flat-button routerLink="/colregs">{{ 'examiner.openReferenceButton' | t }}</a></mat-card> }
    </main>
  `,
})
export class ExaminerPage implements OnInit {
  readonly rules = signal<ColregsRule[]>([]);
  readonly progress = signal<ProgressSnapshot>(emptyProgressSnapshot());
  readonly selectedRuleId = signal('');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly currentRule = computed(() => this.rules().find((rule) => rule.id === this.selectedRuleId()) ?? null);
  readonly completedCount = computed(() => this.rules().filter((rule) => summarizeRuleExercise(rule.id, this.progress()).completed).length);

  constructor(private readonly memory: StudentMemoryService, private readonly reference: ColregsReferenceService, private readonly locales: LocaleService = new LocaleService()) {}

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [rules, progress] = await Promise.all([this.reference.search(''), this.memory.loadAndMergeCloudProgress()]);
      this.rules.set(rules);
      this.progress.set(progress);
      this.selectedRuleId.set(selectNextRuleExercise(rules, progress)?.id ?? '');
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
}
