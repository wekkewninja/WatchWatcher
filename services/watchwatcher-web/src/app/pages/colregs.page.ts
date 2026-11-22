import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { api } from '../../api';
import type { ColregsRule } from '../domain-types';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, RouterLink],
  template: `
    <main class="page-content">
      <div class="page-heading"><div><span class="eyebrow">Offline reference · 72 entries</span><h1>COLREGs reference</h1><p>Search rules, safety duties, lights, shapes, and sound signals.</p></div><span class="offline-chip"><mat-icon>offline_bolt</mat-icon> Available offline</span></div>
      <form class="search-row" (ngSubmit)="search()"><mat-form-field appearance="outline"><mat-label>Search rules or terms</mat-label><input matInput name="query" [(ngModel)]="query" placeholder="Try: fog, overtaking, whistle"><mat-icon matPrefix>search</mat-icon></mat-form-field><button mat-flat-button type="submit"><mat-icon>search</mat-icon> Search</button></form>
      @if (loading()) { <mat-card class="state-card"><div class="skeleton-bar"></div><div class="skeleton-bar short"></div><p>Searching bundled reference</p></mat-card> }
      @else if (error()) { <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>Reference lookup failed</strong><p>{{ error() }}</p></div><button mat-stroked-button (click)="search()">Try again</button></mat-card> }
      @else if (rules().length === 0) { <mat-card class="state-card empty-state"><mat-icon>search_off</mat-icon><h2>No matching rules</h2><p>Try a rule number or a broader term such as “sound” or “visibility”.</p><button mat-stroked-button (click)="clearSearch()">Clear search</button></mat-card> }
      @else { <div class="rule-list">@for (rule of rules(); track rule.id) { <mat-card class="rule-row"><span class="rule-number">{{ rule.ruleNumber }}</span><div><span class="rule-category">{{ rule.category }}</span><h2>{{ rule.title }}</h2><p>{{ rule.summary }}</p><div class="keyword-row">@for (keyword of rule.keywords; track keyword) { <span>{{ keyword }}</span> }</div></div><a mat-icon-button class="rule-arrow" [routerLink]="['/colregs', rule.id]" [attr.aria-label]="'Open details for ' + rule.ruleNumber" title="Open rule details"><mat-icon>chevron_right</mat-icon></a></mat-card> }</div> }
    </main>
  `,
})
export class ColregsPage implements OnInit {
  query = '';
  readonly rules = signal<ColregsRule[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  ngOnInit(): void { void this.search(); }
  async search(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try { this.rules.set(await api.searchColregs(this.query)); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Try again in a moment.'); }
    finally { this.loading.set(false); }
  }
  clearSearch(): void { this.query = ''; void this.search(); }
}
