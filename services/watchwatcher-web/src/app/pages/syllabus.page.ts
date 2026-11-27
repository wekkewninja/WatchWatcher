import { DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { api } from '../../api';
import type { StudyModule } from '../domain-types';
import { StudentMemoryService } from '../core/student-memory.service';
import { LocaleService, TranslationPipe } from '../core/locale.service';

@Component({
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, MatTableModule, MatTabsModule, RouterLink, TranslationPipe],
  template: `
    <main class="page-content">
      <div class="page-heading"><div><span class="eyebrow">{{ 'syllabus.eyebrow' | t }}</span><h1>{{ 'syllabus.heading' | t }}</h1><p>{{ 'syllabus.description' | t }}</p></div><div class="standard-toggle" role="group" [attr.aria-label]="'syllabus.trainingStandard' | t"><button [class.selected]="standard() === 'RYA'" (click)="standard.set('RYA')">RYA</button><button [class.selected]="standard() === 'ASA'" (click)="standard.set('ASA')">ASA</button></div></div>
      <mat-card class="standard-note"><mat-icon>info</mat-icon>{{ (standard() === 'RYA' ? 'syllabus.ryaNote' : 'syllabus.asaNote') | t }}</mat-card>
      @if (loading()) { <mat-card class="state-card"><mat-progress-bar mode="indeterminate"/><p>{{ 'syllabus.loading' | t }}</p></mat-card> }
      @else if (error()) { <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>{{ 'syllabus.unavailable' | t }}</strong><p>{{ error() }}</p></div><button mat-stroked-button (click)="load()">{{ 'syllabus.tryAgain' | t }}</button></mat-card> }
      @else if (modules().length === 0) { <mat-card class="state-card empty-state"><mat-icon>menu_book</mat-icon><h2>{{ 'syllabus.noModules' | t }}</h2><p>{{ 'syllabus.noModulesDescription' | t }}</p><button mat-flat-button (click)="load()">{{ 'syllabus.reload' | t }}</button></mat-card> }
      @else {
        <mat-tab-group animationDuration="180ms" class="syllabus-tabs">
          <mat-tab [label]="'syllabus.tab.modules' | t"><div class="module-table-wrap"><table mat-table [dataSource]="modules()" class="module-table" [attr.aria-label]="'syllabus.tableLabel' | t">
            <ng-container matColumnDef="module"><th mat-header-cell *matHeaderCellDef>{{ 'syllabus.column.module' | t }}</th><td mat-cell *matCellDef="let module"><strong><a class="content-link" [routerLink]="['/learn', module.id]">{{ module.title }}</a></strong></td></ng-container>
            <ng-container matColumnDef="topics"><th mat-header-cell *matHeaderCellDef>{{ 'syllabus.column.topics' | t }}</th><td mat-cell *matCellDef="let module">{{ module.completed }} / {{ module.topicCount }}</td></ng-container>
            <ng-container matColumnDef="mastery"><th mat-header-cell *matHeaderCellDef>{{ 'syllabus.column.mastery' | t }}</th><td mat-cell *matCellDef="let module">{{ module.mastery }}%</td></ng-container>
            <ng-container matColumnDef="threshold"><th mat-header-cell *matHeaderCellDef>{{ 'syllabus.column.passGate' | t }}</th><td mat-cell *matCellDef="let module">{{ module.passThreshold }}%</td></ng-container>
            <ng-container matColumnDef="progress"><th mat-header-cell *matHeaderCellDef>{{ 'syllabus.column.masteryProgress' | t }}</th><td mat-cell *matCellDef="let module"><mat-progress-bar mode="determinate" [value]="module.mastery" [class.over-threshold]="module.mastery >= module.passThreshold"/></td></ng-container>
            <ng-container matColumnDef="gate"><th mat-header-cell *matHeaderCellDef>{{ 'syllabus.column.progression' | t }}</th><td mat-cell *matCellDef="let module"><span class="gate-state" [class.passed]="module.mastery >= module.passThreshold">{{ (module.mastery >= module.passThreshold ? 'syllabus.gatePassed' : 'syllabus.gateLocked') | t: { points: module.passThreshold - module.mastery } }}</span></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr><tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
          </table></div></mat-tab>
          <mat-tab [label]="'syllabus.tab.weakSpots' | t">
            @if (weakSpots().length === 0) {
              <div class="weak-empty"><mat-card class="state-card empty-state"><mat-icon>task_alt</mat-icon><h2>{{ 'syllabus.noWeakSpots' | t }}</h2><p>{{ 'syllabus.weakSpotDescription' | t }}</p></mat-card></div>
            } @else {
              <div class="weak-spot-list">
                @for (spot of weakSpots(); track spot.timestamp + spot.topicId) {
                  <mat-card class="state-card"><mat-icon>flag</mat-icon><div><strong>{{ topicTitles()[spot.topicId] ?? spot.topicId }}</strong><p>{{ spot.tag }} · {{ spot.timestamp | date:'medium' }}</p></div><a mat-stroked-button routerLink="/examiner">{{ 'syllabus.review' | t }}</a></mat-card>
                }
              </div>
            }
          </mat-tab>
        </mat-tab-group>
      }
    </main>
  `,
})
export class SyllabusPage implements OnInit {
  readonly displayedColumns = ['module', 'topics', 'mastery', 'threshold', 'progress', 'gate'];
  readonly modules = signal<StudyModule[]>([]);
  readonly weakSpots = signal<Array<{ topicId: string; tag: string; timestamp: string }>>([]);
  readonly topicTitles = signal<Record<string, string>>({});
  readonly loading = signal(true);
  readonly error = signal('');
  readonly standard = signal<'RYA' | 'ASA'>('RYA');

  constructor(private readonly memory: StudentMemoryService, private readonly locales: LocaleService = new LocaleService()) {}

  ngOnInit(): void { void this.load(); }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const modules = await api.getModules();
      const progress = await this.memory.loadAndMergeCloudProgress();
      this.modules.set(modules.map((module) => {
        const masteryValues = module.topicIds.map((topicId) => progress.topicMastery[topicId] ?? 0);
        const mastery = masteryValues.length ? Math.round(masteryValues.reduce((total, value) => total + value, 0) / masteryValues.length) : 0;
        return { ...module, mastery, completed: masteryValues.filter((value) => value >= module.passThreshold).length };
      }));
      const titles = Object.fromEntries(modules.flatMap((module) => module.topicIds.map((topicId, index) => [topicId, module.topics[index]])));
      this.topicTitles.set(titles);
      const topicIds = new Set(Object.keys(titles));
      this.weakSpots.set(progress.weakSpotLog.filter((spot) => topicIds.has(spot.topicId)));
    }
    catch (error) { this.error.set(error instanceof Error ? error.message : this.locales.translate('syllabus.tryAgainSoon')); }
    finally { this.loading.set(false); }
  }
}
