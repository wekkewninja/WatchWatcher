import { Injectable } from '@angular/core';
import { api } from '../../../api';
import type { ColregsRule } from '../../domain-types';

@Injectable({ providedIn: 'root' })
export class ColregsReferenceService {
  search(query: string): Promise<ColregsRule[]> {
    return api.searchColregs(query);
  }
}