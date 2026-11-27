import { Component, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import type { Subscription } from 'rxjs';
import { ColregsReferenceService } from '../core/services/colregs-reference.service';
import type { ColregsRule } from '../domain-types';
import { ColregsExerciseCardComponent } from '../shared/colregs-exercise-card.component';
import { LocaleService, TranslationPipe } from '../core/locale.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, ColregsExerciseCardComponent, TranslationPipe],
  template: `
    <main class="page-content colregs-detail-page">
      @if (loading()) {
        <mat-card class="state-card"><p>{{ 'colregsRule.loading' | t }}</p></mat-card>
      } @else if (error()) {
        <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>{{ 'colregsRule.unavailable' | t }}</strong><p>{{ error() }}</p></div><a mat-stroked-button routerLink="/colregs">{{ 'colregsRule.backToReference' | t }}</a></mat-card>
      } @else if (rule(); as entry) {
        <header class="page-heading"><div><span class="eyebrow">{{ 'colregsRule.offlineEntry' | t: { category: entry.category } }}</span><h1>{{ entry.ruleNumber }} · {{ entry.title }}</h1><p>{{ 'colregsRule.description' | t }}</p></div><a mat-stroked-button routerLink="/colregs"><mat-icon>arrow_back</mat-icon> {{ 'colregsRule.referenceList' | t }}</a></header>
        <mat-card class="rule-detail-card"><mat-card-header><mat-icon mat-card-avatar>gavel</mat-icon><mat-card-title>{{ 'colregsRule.summary' | t }}</mat-card-title><mat-card-subtitle>{{ entry.ruleNumber }} · {{ entry.title }}</mat-card-subtitle></mat-card-header><mat-card-content><p class="rule-detail-text">{{ entry.summary }}</p></mat-card-content></mat-card>
        @if (entry.officialText; as officialText) {
          <details class="official-wording">
            <summary><mat-icon>article</mat-icon><span>{{ 'colregsRule.officialWording' | t }}</span><mat-icon class="official-expand-icon">expand_more</mat-icon></summary>
            <div class="official-wording-body">
              <div class="official-source"><span>{{ (officialTextMode() === 'inland' && officialText.inland?.length ? 'colregsRule.inlandRules' : 'colregsRule.internationalRules') | t }}</span><a [href]="officialText.sourceUrl" target="_blank" rel="noopener noreferrer">{{ 'colregsRule.sourceName' | t }}</a><span>{{ 'colregsRule.sourceUpdated' | t: { updatedOn: officialText.sourceUpdatedOn, checkedOn: officialText.checkedOn } }}</span></div>
              @if (officialText.inland?.length) {
                <div class="official-mode-control" role="group" [attr.aria-label]="'colregsRule.officialVariant' | t">
                  <button type="button" [class.active]="officialTextMode() === 'international'" [attr.aria-pressed]="officialTextMode() === 'international'" (click)="setOfficialTextMode('international')">{{ 'colregsRule.international' | t }}</button>
                  <button type="button" [class.active]="officialTextMode() === 'inland'" [attr.aria-pressed]="officialTextMode() === 'inland'" (click)="setOfficialTextMode('inland')">{{ 'colregsRule.usInland' | t }}</button>
                </div>
              }
              <div class="official-paragraphs">@for (paragraph of officialParagraphs(entry); track $index) { <p>{{ paragraph }}</p> }</div>
            </div>
          </details>
        }
        <mat-card class="rule-detail-card"><mat-card-header><mat-icon mat-card-avatar>checklist</mat-icon><mat-card-title>{{ 'colregsRule.keyPoints' | t }}</mat-card-title></mat-card-header><mat-card-content><ul class="rule-key-points">@for (point of entry.keyPoints; track point) { <li>{{ point }}</li> }</ul></mat-card-content></mat-card>
        @if (entry.memoryHook) { <mat-card class="rule-detail-card memory-card"><mat-card-header><mat-icon mat-card-avatar>lightbulb</mat-icon><mat-card-title>{{ 'colregsRule.memoryHook' | t }}</mat-card-title></mat-card-header><mat-card-content><p>{{ entry.memoryHook }}</p></mat-card-content></mat-card> }
        @if (entry.asaInlandNote) { <mat-card class="rule-detail-card"><mat-card-header><mat-icon mat-card-avatar>compare_arrows</mat-icon><mat-card-title>{{ 'colregsRule.asaInlandNote' | t }}</mat-card-title></mat-card-header><mat-card-content><p>{{ entry.asaInlandNote }}</p></mat-card-content></mat-card> }
        <ww-colregs-exercise-card [rule]="entry" />
        <div class="rule-detail-meta"><span><mat-icon>label</mat-icon> {{ 'colregsRule.searchTerms' | t }}</span><div class="keyword-row">@for (keyword of entry.keywords; track keyword) { <span>{{ keyword }}</span> }</div></div>
        <mat-card class="authority-note"><mat-icon>info</mat-icon><p>{{ 'colregsRule.authorityNote' | t }}</p></mat-card>
      }
    </main>
  `,
})
export class ColregsRulePage implements OnDestroy {
  readonly rule = signal<ColregsRule | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  private readonly routeSubscription: Subscription;

  constructor(route: ActivatedRoute, private readonly reference: ColregsReferenceService, private readonly locales: LocaleService = new LocaleService()) {
    this.routeSubscription = route.paramMap.subscribe((params) => {
      const ruleId = params.get('ruleId');
      if (ruleId) void this.load(ruleId);
    });
  }

  ngOnDestroy(): void { this.routeSubscription.unsubscribe(); }

  private async load(ruleId: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.rule.set(null);
    this.officialTextMode.set('international');
    try {
      const entry = (await this.reference.search('')).find((candidate) => candidate.id === ruleId);
      if (!entry) throw new Error(this.locales.translate('colregsRule.notFound'));
      this.rule.set(entry);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.locales.translate('colregsRule.retryFromList'));
    } finally { this.loading.set(false); }
  }

  readonly officialTextMode = signal<'international' | 'inland'>('international');

  setOfficialTextMode(mode: 'international' | 'inland'): void {
    this.officialTextMode.set(mode);
  }

  officialParagraphs(entry: ColregsRule): string[] {
    const officialText = entry.officialText;
    if (!officialText) return [];
    if (this.officialTextMode() === 'inland' && officialText.inland?.length) return officialText.inland;
    return officialText.international;
  }
}
