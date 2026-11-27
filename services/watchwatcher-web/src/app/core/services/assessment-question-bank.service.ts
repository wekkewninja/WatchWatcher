import { Injectable } from '@angular/core';
import { ColregsReferenceService } from './colregs-reference.service';
import { buildAssessmentBank, type AssessmentBank, type CurriculumAssessmentAsset } from './assessment-question-bank';
import { LocaleService } from '../locale.service';

@Injectable({ providedIn: 'root' })
export class AssessmentQuestionBankService {
  private bankPromise: Promise<AssessmentBank> | null = null;

  constructor(private readonly reference: ColregsReferenceService, private readonly locales: LocaleService = new LocaleService()) {}

  loadBank(): Promise<AssessmentBank> {
    this.bankPromise ??= this.load();
    return this.bankPromise;
  }

  private async load(): Promise<AssessmentBank> {
    const [rules, response] = await Promise.all([
      this.reference.search(''),
      fetch(new URL('assets/syllabus/curriculum_seed.json', document.baseURI)),
    ]);
    if (!response.ok) throw new Error(this.locales.translate('examBank.loadFailed', { status: response.status }));
    const curriculum = await response.json() as CurriculumAssessmentAsset;
    return buildAssessmentBank(rules, curriculum);
  }
}