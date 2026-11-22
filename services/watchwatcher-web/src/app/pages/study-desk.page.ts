import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { api } from '../../api';
import type { StudySnapshot } from '../domain-types';
import { StorageRepository } from '../core/storage-repository.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule],
  template: `
    <section class="hero-panel">
      <span class="hero-kicker"><span class="status-dot"></span> Practice scenario · COLREGs / IRPCS</span>
      <h1>Rule 19 restricted visibility</h1>
        <p>Review radar targets and avoiding action in restricted visibility. Your study record stays available offline.</p>
      <div class="hero-actions">
        <a mat-flat-button routerLink="/examiner"><mat-icon>arrow_forward</mat-icon> Resume Rule 19</a>
        <a mat-stroked-button routerLink="/syllabus"><mat-icon>map</mat-icon> View syllabus</a>
      </div>
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
        <div class="section-heading"><h2 id="mastery-heading"><mat-icon>query_stats</mat-icon> Mastery at a glance</h2><span>{{ snapshot()?.topics?.length ?? 0 }} syllabus topics</span></div>
        @if (loading()) {
          <mat-card class="state-card"><mat-progress-bar mode="indeterminate"/><p>Loading your latest study snapshot</p></mat-card>
        } @else if (error()) {
          <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>Study data unavailable</strong><p>{{ error() }}</p></div><button mat-stroked-button (click)="load()">Try again</button></mat-card>
        } @else if (snapshot()?.topics?.length === 0) {
          <mat-card class="state-card empty-state"><mat-icon>inbox</mat-icon><h3>No active topics yet</h3><p>Choose a module to start building your local study record.</p><a mat-flat-button routerLink="/syllabus">Open syllabus</a></mat-card>
        } @else if (snapshot(); as data) {
          <div class="metrics-grid">
              <mat-card class="metric-card"><div class="metric-icon"><mat-icon>query_stats</mat-icon></div><span class="metric-label">Average mastery</span><strong>{{ data.averageMastery }}%</strong><span>Across the syllabus</span></mat-card>
              <mat-card class="metric-card"><div class="metric-icon"><mat-icon>task_alt</mat-icon></div><span class="metric-label">At pass threshold</span><strong>{{ data.atThreshold }} of {{ data.topics.length }}</strong><span>Topics meeting their pass gate</span></mat-card>
              <mat-card class="metric-card"><div class="metric-icon warning-icon"><mat-icon>flag</mat-icon></div><span class="metric-label">Weak spot records</span><strong>{{ data.weakSpots }}</strong><span>Stored with your local progress</span></mat-card>
          </div>
          <div class="offline-note"><p><mat-icon>offline_bolt</mat-icon> Offline ready: syllabus study, bundled COLREGs lookup, and deterministic grading stay available without a connection.</p><div><button mat-button (click)="syncProgress()" [disabled]="syncing()"><mat-icon>sync</mat-icon> {{ syncing() ? 'Syncing' : 'Sync progress' }}</button>@if (syncMessage()) { <small role="status">{{ syncMessage() }}</small> }</div></div>
          <div class="section-heading topics-heading"><h2><mat-icon>menu_book</mat-icon> Study topics</h2><span>Mastery compared with pass threshold</span></div>
          <div class="topic-list">
            @for (topic of data.topics; track topic.id) {
              <mat-card class="topic-row">
                <div class="topic-title"><div><span class="topic-module">{{ topic.moduleTitle }}</span><h3><a class="content-link" [routerLink]="['/learn', topic.contentId ?? topic.id]">{{ topic.title }}</a></h3></div><span class="state-pill" [class.ready]="topic.state === 'ready'" [class.retry]="topic.state === 'retry'">{{ topic.state === 'ready' ? 'Ready to advance' : topic.state === 'retry' ? 'Retry required' : 'Remediation due' }}</span></div>
                <p>{{ topic.summary }}</p>
                <div class="topic-progress"><mat-progress-bar mode="determinate" [value]="topic.mastery" [class.over-threshold]="topic.mastery >= topic.passThreshold"/><span>Mastery {{ topic.mastery }}% <i>·</i> Pass threshold {{ topic.passThreshold }}%</span></div>
              </mat-card>
            }
          </div>
        }
      </section>
      <footer class="page-footer"><span>WatchWatcher · RYA / ASA training</span><span>Local progress remains available offline</span></footer>
    </main>
  `,
})
export class StudyDeskPage implements OnInit {
  readonly snapshot = signal<StudySnapshot | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly syncing = signal(false);
  readonly syncMessage = signal('');

  constructor(private readonly storage: StorageRepository) {}

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const current = await api.getStudySnapshot();
        let progress = await this.storage.loadProgress();
        if (!progress) {
          try { progress = await api.getProgress(); }
          catch { progress = { topicMastery: {}, weakSpotLog: [], drillQueue: [] }; }
          await this.storage.saveProgress(progress);
      }
        current.topics = current.topics.map((topic) => {
          const mastery = progress.topicMastery[topic.id] ?? 0;
          return { ...topic, mastery, state: mastery >= topic.passThreshold ? 'ready' : mastery > 0 ? 'retry' : 'remediation' };
        });
        current.averageMastery = current.topics.length ? Math.round(current.topics.reduce((total, topic) => total + topic.mastery, 0) / current.topics.length) : 0;
        current.atThreshold = current.topics.filter((topic) => topic.mastery >= topic.passThreshold).length;
        const topicIds = new Set(current.topics.map((topic) => topic.id));
        current.weakSpots = progress.weakSpotLog.filter((entry) => topicIds.has(entry.topicId)).length;
      this.snapshot.set(current);
    }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Try again in a moment.'); }
    finally { this.loading.set(false); }
  }

  async syncProgress(): Promise<void> {
    this.syncing.set(true);
    this.syncMessage.set('');
    try {
        let local = await this.storage.loadProgress();
        if (!local) {
          local = await api.getProgress();
          await this.storage.saveProgress(local);
        }
      const result = await api.syncProgress(local);
      this.syncMessage.set(`Synced ${new Date(result.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      this.syncMessage.set(error instanceof Error ? `${error.message} Local progress is unchanged.` : 'Sync failed. Local progress is unchanged.');
    } finally { this.syncing.set(false); }
  }
}
