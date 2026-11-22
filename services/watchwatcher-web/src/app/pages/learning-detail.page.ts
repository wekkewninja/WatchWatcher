import { Component, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { Subscription } from 'rxjs';

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
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule],
  template: `
    <main class="page-content learning-page">
      @if (loading()) {
        <mat-card class="state-card"><mat-progress-bar mode="indeterminate"/><p>Loading bundled study content</p></mat-card>
      } @else if (error()) {
        <mat-card class="state-card error-state"><mat-icon>error_outline</mat-icon><div><strong>Study content unavailable</strong><p>{{ error() }}</p></div><a mat-stroked-button routerLink="/syllabus">Back to syllabus</a></mat-card>
      } @else if (module(); as moduleContent) {
        <header class="page-heading"><div><span class="eyebrow">Module · {{ moduleContent.pass_threshold * 100 }}% pass threshold</span><h1>{{ moduleContent.title }}</h1><p>Choose a topic to review its briefing, examiner questions, and remediation notes.</p></div><a mat-stroked-button routerLink="/syllabus"><mat-icon>arrow_back</mat-icon> Syllabus map</a></header>
        <section class="learning-topic-list" aria-label="Module topics">
          @for (topic of moduleContent.topics; track topic.id) {
            <mat-card class="learning-topic-row"><span class="learning-topic-ref">{{ topic.rule_ref }}</span><div><h2><a class="content-link" [routerLink]="['/learn', topic.id]">{{ topic.title }}</a></h2><p>{{ topic.summary }}</p><span class="learning-topic-meta">{{ topic.questions.length }} examiner checks · {{ moduleContent.pass_threshold * 100 }}% pass threshold</span></div><a mat-icon-button [routerLink]="['/learn', topic.id]" [attr.aria-label]="'Open ' + topic.title" title="Open topic"><mat-icon>arrow_forward</mat-icon></a></mat-card>
          }
        </section>
      } @else if (topic(); as topicContent) {
        <header class="page-heading learning-heading"><div><span class="eyebrow">{{ topicContent.rule_ref }}</span><h1>{{ topicContent.title }}</h1><p>{{ parentModule()?.title }} · {{ (parentModule()?.pass_threshold ?? 0) * 100 }}% pass threshold</p></div><a mat-stroked-button [routerLink]="['/learn', parentModule()?.id]"><mat-icon>arrow_back</mat-icon> {{ parentModule()?.title }}</a></header>
        <section class="learning-briefing"><mat-card class="learning-briefing-card"><mat-card-header><mat-icon mat-card-avatar>menu_book</mat-icon><mat-card-title>Study briefing</mat-card-title></mat-card-header><mat-card-content><p>{{ topicContent.summary }}</p><div class="comparison-note"><mat-icon>compare_arrows</mat-icon><span><strong>RYA / ASA note</strong>{{ topicContent.asa_note }}</span></div></mat-card-content></mat-card></section>
        <section class="learning-questions" aria-label="Examiner questions"><div class="section-heading"><h2><mat-icon>quiz</mat-icon> Examiner questions</h2><span>{{ topicContent.questions.length }} checks</span></div>
          @for (question of topicContent.questions; track question.id; let index = $index) {
            <mat-card class="learning-question"><span class="question-number">{{ index + 1 }}</span><h2>{{ question.prompt }}</h2><details><summary>Review answer and remediation</summary><p><strong>Key concepts:</strong> {{ question.expected_keywords.join(' · ') }}</p><p><strong>Answer:</strong> {{ question.correct_explanation }}</p><p><strong>Remediation:</strong> {{ question.deep_remediation }}</p></details></mat-card>
          }
        </section>
        <div class="learning-actions"><a mat-flat-button routerLink="/examiner"><mat-icon>grading</mat-icon> Open examiner workspace</a><a mat-button routerLink="/colregs"><mat-icon>search</mat-icon> COLREGs reference</a></div>
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

  constructor(route: ActivatedRoute) {
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
        if (!response.ok) throw new Error('Bundled syllabus could not be loaded.');
        return response.json() as Promise<Curriculum>;
      });
      const moduleContent = this.content.modules.find((item) => item.id === contentId);
      if (moduleContent) this.module.set(moduleContent);
      else {
        const topicContent = this.content.modules.flatMap((item) => item.topics).find((item) => item.id === contentId);
        if (!topicContent) throw new Error('This topic could not be found in the bundled syllabus.');
        this.topic.set(topicContent);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Try again in a moment.');
    } finally { this.loading.set(false); }
  }
}
