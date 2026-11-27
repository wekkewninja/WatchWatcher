import { Component, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { Subscription } from 'rxjs';
import { LocaleService, TranslationPipe } from '../core/locale.service';

interface CurriculumQuestion {
  id: string;
  prompt: string;
  expected_keywords: string[];
  forbidden_keywords: string[];
  correct_explanation: string;
  deep_remediation: string;
}

interface CurriculumTopic {
  id: string;
  rule_ref: string;
  title: string;
  summary: string;
  asa_note: string;
  questions: CurriculumQuestion[];
}

interface CurriculumModule {
  id: string;
  title: string;
  pass_threshold: number;
  topics: CurriculumTopic[];
}

interface Curriculum {
  modules: CurriculumModule[];
}

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, TranslationPipe],
  template: `
    <main class="page-content learning-page">
      @if (loading()) {
        <mat-card class="state-card"><mat-progress-bar mode="indeterminate"/><p>{{ 'learning.loading' | t }}</p></mat-card>
      } @else if (error()) {
        <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>{{ 'learning.unavailable' | t }}</strong><p>{{ error() }}</p></div><a mat-stroked-button routerLink="/syllabus">{{ 'learning.backToSyllabus' | t }}</a></mat-card>
      } @else if (module(); as moduleContent) {
        <header class="page-heading"><div><span class="eyebrow">{{ 'learning.moduleThreshold' | t: { threshold: moduleContent.pass_threshold * 100 } }}</span><h1>{{ moduleContent.title }}</h1><p>{{ 'learning.moduleDescription' | t }}</p></div><a mat-stroked-button routerLink="/syllabus"><mat-icon>arrow_back</mat-icon> {{ 'learning.syllabusMap' | t }}</a></header>
        <section class="learning-topic-list" [attr.aria-label]="'learning.moduleTopics' | t">
          @for (topic of moduleContent.topics; track topic.id) {
            <mat-card class="learning-topic-row"><span class="learning-topic-ref">{{ topic.rule_ref }}</span><div><h2><a class="content-link" [routerLink]="['/learn', topic.id]">{{ topic.title }}</a></h2><p>{{ topic.summary }}</p><span class="learning-topic-meta">{{ 'learning.topicChecks' | t: { count: topic.questions.length, threshold: moduleContent.pass_threshold * 100 } }}</span></div><a mat-icon-button [routerLink]="['/learn', topic.id]" [attr.aria-label]="'learning.openTopic' | t: { title: topic.title }" [title]="'learning.openTopic' | t: { title: topic.title }"><mat-icon>arrow_forward</mat-icon></a></mat-card>
          }
        </section>
      } @else if (topic(); as topicContent) {
        <header class="page-heading learning-heading"><div><span class="eyebrow">{{ topicContent.rule_ref }}</span><h1>{{ topicContent.title }}</h1><p>{{ parentModule()?.title }} · {{ (parentModule()?.pass_threshold ?? 0) * 100 }}% pass threshold</p></div><a mat-stroked-button [routerLink]="['/learn', parentModule()?.id]"><mat-icon>arrow_back</mat-icon> {{ parentModule()?.title }}</a></header>
        <section class="learning-briefing"><mat-card class="learning-briefing-card"><mat-card-header><mat-icon mat-card-avatar>menu_book</mat-icon><mat-card-title>{{ 'learning.studyBriefing' | t }}</mat-card-title></mat-card-header><mat-card-content><p>{{ topicContent.summary }}</p><div class="comparison-note"><mat-icon>compare_arrows</mat-icon><span><strong>{{ 'learning.ryaAsaNote' | t }}</strong>{{ topicContent.asa_note }}</span></div></mat-card-content></mat-card></section>
        <section class="learning-questions" [attr.aria-label]="'learning.examinerQuestions' | t"><div class="section-heading"><h2><mat-icon>quiz</mat-icon> {{ 'learning.examinerQuestions' | t }}</h2><span>{{ 'learning.questionChecks' | t: { count: topicContent.questions.length } }}</span></div>
          @for (question of topicContent.questions; track question.id; let index = $index) {
            <mat-card class="learning-question"><span class="question-number">{{ index + 1 }}</span><h2>{{ question.prompt }}</h2><details><summary>{{ 'learning.reviewAnswer' | t }}</summary><p><strong>{{ 'learning.keyConcepts' | t }}</strong> {{ question.expected_keywords.join(' · ') }}</p><p><strong>{{ 'learning.answer' | t }}</strong> {{ question.correct_explanation }}</p><p><strong>{{ 'learning.remediation' | t }}</strong> {{ question.deep_remediation }}</p></details></mat-card>
          }
        </section>
        <div class="learning-actions"><a mat-flat-button routerLink="/examiner"><mat-icon>grading</mat-icon> {{ 'learning.openExaminer' | t }}</a><a mat-button routerLink="/colregs"><mat-icon>search</mat-icon> {{ 'learning.colregsReference' | t }}</a></div>
      }
    </main>
  `,
})
export class LearningDetailPage implements OnDestroy {
  readonly loading = signal(true);
  readonly error = signal('');
  readonly module = signal<CurriculumModule | null>(null);
  readonly topic = signal<CurriculumTopic | null>(null);
  private content?: Curriculum;
  private readonly routeSubscription: Subscription;

  constructor(route: ActivatedRoute, private readonly locales: LocaleService = new LocaleService()) {
    this.routeSubscription = route.paramMap.subscribe((params) => {
      const contentId = params.get('contentId');
      if (contentId) void this.load(contentId);
    });
  }

  ngOnDestroy(): void { this.routeSubscription.unsubscribe(); }

  parentModule(): CurriculumModule | undefined {
    const topicId = this.topic()?.id;
    return this.content?.modules.find((moduleContent) => moduleContent.topics.some((topicContent) => topicContent.id === topicId));
  }

  private async load(contentId: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.module.set(null);
    this.topic.set(null);
    try {
      this.content ??= await fetch(new URL('assets/syllabus/curriculum_seed.json', document.baseURI)).then((response) => {
        if (!response.ok) throw new Error(this.locales.translate('learning.bundleLoadFailed'));
        return response.json() as Promise<Curriculum>;
      });
      const moduleContent = this.content.modules.find((item) => item.id === contentId);
      if (moduleContent) this.module.set(moduleContent);
      else {
        const topicContent = this.content.modules.flatMap((item) => item.topics).find((item) => item.id === contentId);
        if (!topicContent) throw new Error(this.locales.translate('learning.topicNotFound'));
        this.topic.set(topicContent);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.locales.translate('common.retrySoon'));
    } finally { this.loading.set(false); }
  }
}
