import { Component, OnDestroy, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import type { EvaluationResult } from '../domain-types';
import { StudentMemoryService } from '../core/student-memory.service';
import { ExaminerAiService } from '../core/services/examiner-ai.service';
import type { StructuredRule19Answer } from '../../../../shared/evaluation/offline-evaluator';
import { ChartVectorCanvasComponent } from '../shared/chart-vector-canvas.component';
import { ColregsAnimatedViewComponent } from '../shared/colregs-animated-view.component';

@Component({
  standalone: true,
  imports: [DecimalPipe, FormsModule, MatButtonModule, MatButtonToggleModule, MatCardModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule, ChartVectorCanvasComponent, ColregsAnimatedViewComponent],
  template: `
    <main class="page-content examiner-page">
      <div class="page-heading"><div><span class="eyebrow">Threshold-gated practice</span><h1>Examiner workspace</h1><p>Work the scenario, state the rule, then explain the safety decision.</p></div><span class="threshold-badge"><mat-icon>verified_user</mat-icon> 85% pass threshold</span></div>
      <mat-card class="offline-evaluation" role="status"><mat-icon>cloud_off</mat-icon><div><strong>Deterministic offline evaluation is ready</strong><span>Online Gemini grading is optional. A network or service failure never blocks core practice.</span></div></mat-card>
      <div class="exam-grid">
        <section class="exam-column">
          <mat-card class="scenario-card">
            <mat-card-header><div mat-card-avatar class="scenario-avatar"><mat-icon>radar</mat-icon></div><mat-card-title>Rule 19 · Restricted visibility</mat-card-title><mat-card-subtitle>Target on port bow · 315° relative</mat-card-subtitle></mat-card-header>
            <mat-card-content><p>A steady radar echo is detected in dense fog. Your vessel is making way and the target is forward of the beam. Describe the action you would take and the rule that governs it.</p>
              <mat-button-toggle-group [value]="answerMode()" (change)="setAnswerMode($event.value)" aria-label="Answer mode" class="answer-mode-toggle"><mat-button-toggle value="structured">Structured · offline</mat-button-toggle>@if (online()) { <mat-button-toggle value="free-text">Free text · AI</mat-button-toggle> }</mat-button-toggle-group>
              @if (answerMode() === 'structured') {
                <p class="structured-hint">Complete the key Rule 19 choices. This check runs locally and works offline.</p>
                <div class="structured-answer-grid">
                  <mat-form-field appearance="outline"><mat-label>Rule number</mat-label><input matInput type="number" min="1" max="41" name="ruleNumber" [(ngModel)]="ruleNumber"></mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>Rule 19(d) prohibits</mat-label><mat-select name="prohibitedAction" [(ngModel)]="prohibitedAction"><mat-option value="port">Port alterations</mat-option><mat-option value="starboard">Starboard alterations</mat-option><mat-option value="toward-target">Alterations toward the target</mat-option></mat-select></mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>For this target forward of the beam, choose</mat-label><mat-select name="chosenAlteration" [(ngModel)]="chosenAlteration"><mat-option value="starboard">A clear starboard alteration</mat-option><mat-option value="port">A port alteration</mat-option><mat-option value="toward-target">An alteration toward the target</mat-option></mat-select></mat-form-field>
                </div>
                <mat-checkbox name="safeSpeedConfirmed" [(ngModel)]="safeSpeedConfirmed">Proceed at safe speed with engines ready</mat-checkbox>
              } @else {
                <p class="online-only-note"><mat-icon>cloud_done</mat-icon> Free-text scores count only when verified by online AI. Offline fallback does not grade text.</p>
                <mat-form-field appearance="outline" class="answer-field"><mat-label>Your answer</mat-label><textarea matInput rows="5" name="answer" [(ngModel)]="answer" placeholder="Name the applicable rule, target aspect, and safe action"></textarea><mat-hint>Free-text answers require an online AI-verified result.</mat-hint></mat-form-field>
              }
              <button mat-flat-button (click)="evaluate()" [disabled]="busy() || (answerMode() === 'structured' ? !canSubmitStructured : answer.trim().length < 20)"><mat-icon>grading</mat-icon> {{ answerMode() === 'structured' ? 'Check structured answer' : 'Submit for AI assessment' }}</button>
              @if (busy()) { <mat-progress-bar mode="indeterminate" class="assessment-progress"/> }
              @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
              @if (result(); as evaluation) {
                <div class="evaluation-result" [class.passed]="evaluation.passed"><div class="evaluation-score"><strong>{{ evaluation.score * 100 | number:'1.0-0' }}%</strong><span>{{ evaluation.passed ? 'Threshold met' : 'Retry required' }}</span></div><p>{{ evaluation.feedback }}</p><small>{{ evaluation.followUpDrill }}</small></div>
              }
            </mat-card-content>
          </mat-card>
          <ww-colregs-animated-view />
        </section>
        <section class="exam-column"><ww-chart-vector-canvas /><mat-card class="safety-card"><mat-card-header><mat-icon mat-card-avatar>priority_high</mat-icon><mat-card-title>Safety gate</mat-card-title></mat-card-header><mat-card-content><p>Unsafe actions fail the scenario regardless of keyword coverage. Progress remains locked until a safe answer meets the topic threshold.</p></mat-card-content></mat-card></section>
      </div>
    </main>
  `,
})
export class ExaminerPage implements OnDestroy {
  answer = '';
  readonly answerMode = signal<'structured' | 'free-text'>('structured');
  readonly online = signal(typeof navigator !== 'undefined' && navigator.onLine);
  ruleNumber = 19;
  prohibitedAction: StructuredRule19Answer['prohibits'] | '' = '';
  chosenAlteration: StructuredRule19Answer['alteration'] | '' = '';
  safeSpeedConfirmed = false;
  readonly result = signal<EvaluationResult | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');

  constructor(private readonly memory: StudentMemoryService, private readonly examiner: ExaminerAiService) {
    window.addEventListener('online', this.updateConnection);
    window.addEventListener('offline', this.updateConnection);
  }

  get canSubmitStructured(): boolean {
    return Number.isInteger(this.ruleNumber) && this.ruleNumber >= 1 && this.ruleNumber <= 41 && this.prohibitedAction !== '' && this.chosenAlteration !== '';
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.updateConnection);
    window.removeEventListener('offline', this.updateConnection);
  }

  setAnswerMode(mode: 'structured' | 'free-text'): void {
    this.answerMode.set(mode === 'free-text' && this.online() ? mode : 'structured');
    this.error.set('');
    this.result.set(null);
  }

  private readonly updateConnection = (): void => {
    this.online.set(navigator.onLine);
    if (!navigator.onLine) this.setAnswerMode('structured');
  };

  async evaluate(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.result.set(null);
    try {
      const evaluation = this.answerMode() === 'structured'
        ? this.examiner.evaluateStructuredRule19({
          ruleNumber: this.ruleNumber,
          prohibits: this.prohibitedAction as StructuredRule19Answer['prohibits'],
          alteration: this.chosenAlteration as StructuredRule19Answer['alteration'],
          safeSpeedConfirmed: this.safeSpeedConfirmed,
        })
        : await this.examiner.evaluateFreeText({ topicId: 'colregs_rule_19d', context: 'Rule 19(d), restricted visibility, target forward of the beam', answer: this.answer });
      this.result.set(evaluation);
      const progress = await this.memory.loadProgress();
      if (!progress) await this.memory.saveProgress({ topicMastery: {}, weakSpotLog: [], drillQueue: [] });
      await this.memory.recordEvaluation('colregs_rule_19d', evaluation, 0);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Assessment unavailable. Your offline rubric remains ready.');
    } finally { this.busy.set(false); }
  }
}
