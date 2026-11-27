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
import { LocaleService, TranslationPipe } from '../core/locale.service';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, RouterLink, TranslationPipe],
  template: `
    <main class="page-content">
      <div class="page-heading"><div><span class="eyebrow">{{ 'colregs.eyebrow' | t }}</span><h1>{{ 'colregs.heading' | t }}</h1><p>{{ 'colregs.description' | t }}</p></div><span class="offline-chip"><mat-icon>offline_bolt</mat-icon> {{ 'colregs.availableOffline' | t }}</span></div>
      <form class="search-row" (ngSubmit)="search()"><mat-form-field appearance="outline"><mat-label>{{ 'colregs.searchLabel' | t }}</mat-label><input matInput name="query" [(ngModel)]="query" [placeholder]="'colregs.searchPlaceholder' | t"><mat-icon matPrefix>search</mat-icon></mat-form-field><button mat-flat-button type="submit"><mat-icon>search</mat-icon> {{ 'colregs.searchButton' | t }}</button></form>
      @if (loading()) { <mat-card class="state-card"><div class="skeleton-bar"></div><div class="skeleton-bar short"></div><p>{{ 'colregs.searching' | t }}</p></mat-card> }
      @else if (error()) { <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>{{ 'colregs.lookupFailed' | t }}</strong><p>{{ error() }}</p></div><button mat-stroked-button (click)="search()">{{ 'colregs.tryAgain' | t }}</button></mat-card> }
      @else if (rules().length === 0) { <mat-card class="state-card empty-state"><mat-icon>search_off</mat-icon><h2>{{ 'colregs.noMatches' | t }}</h2><p>{{ 'colregs.noMatchesDescription' | t }}</p><button mat-stroked-button (click)="clearSearch()">{{ 'colregs.clearSearch' | t }}</button></mat-card> }
      @else { <div class="rule-list">@for (rule of rules(); track rule.id) { <mat-card class="rule-row"><span class="rule-number">{{ rule.ruleNumber }}</span><div><span class="rule-category">{{ rule.category }}</span><h2>{{ rule.title }}</h2><p>{{ rule.summary }}</p><div class="keyword-row">@for (keyword of rule.keywords; track keyword) { <span>{{ keyword }}</span> }</div></div><a mat-icon-button class="rule-arrow" [routerLink]="['/colregs', rule.id]" [attr.aria-label]="'colregs.openDetails' | t: { ruleNumber: rule.ruleNumber }" [title]="'colregs.openRuleDetails' | t"><mat-icon>chevron_right</mat-icon></a></mat-card> }</div> }
    </main>
  `,
})
export class ColregsPage implements OnInit {
  query = '';
  readonly rules = signal<ColregsRule[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor(private readonly locales: LocaleService = new LocaleService()) {}

  ngOnInit(): void { void this.search(); }
  async search(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try { this.rules.set(await api.searchColregs(this.query)); }
    catch (error) { this.error.set(error instanceof Error ? error.message : this.locales.translate('common.retrySoon')); }
    finally { this.loading.set(false); }
  }
  clearSearch(): void { this.query = ''; void this.search(); }
}
