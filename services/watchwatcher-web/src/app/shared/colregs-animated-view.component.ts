import { Component, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'ww-colregs-animated-view',
  standalone: true,
  imports: [MatButtonToggleModule, MatCardModule, MatIconModule],
  template: `
    <mat-card class="encounter-card"><mat-card-header><mat-icon mat-card-avatar>visibility</mat-icon><mat-card-title>Visual recognition</mat-card-title><mat-card-subtitle>Rule 19 · restricted visibility</mat-card-subtitle></mat-card-header><mat-card-content>
      <mat-button-toggle-group [value]="mode()" (change)="mode.set($event.value)" aria-label="Visual aid mode"><mat-button-toggle value="radar">Radar encounter</mat-button-toggle><mat-button-toggle value="lights">Navigation lights</mat-button-toggle></mat-button-toggle-group>
      @if (mode() === 'radar') { <div class="radar-screen" role="img" aria-label="Radar scope with target at 315 degrees relative"><div class="radar-rings"></div><div class="radar-sweep"></div><mat-icon class="own-ship">navigation</mat-icon><span class="radar-target"></span><span class="bearing-label">315° REL</span><span class="radar-caption">PORT BOW · STEADY BEARING</span></div><p class="visual-note"><mat-icon>north_east</mat-icon> Rule 19(d): do not alter to port for a target forward of the beam.</p> }
      @else { <div class="lights-view"><div class="night-horizon"><span class="mast-light" [class.red]="vessel() !== 'Sailing'" [class.white]="vessel() === 'Sailing'"></span><span class="mast-light second" [class.green]="vessel() === 'Sailing' || vessel() === 'Trawling'" [class.white]="vessel() === 'Fishing' || vessel() === 'Pilot'"></span><span class="mast-light third" [class.red]="vessel() === 'NUC' || vessel() === 'RAM'" [class.white]="vessel() === 'Pilot'"></span></div><label>Vessel aspect<select [value]="vessel()" (change)="setVessel($event)"><option>Sailing</option><option>Fishing</option><option>Trawling</option><option>NUC</option><option>RAM</option><option>Pilot</option></select></label></div> }
    </mat-card-content></mat-card>
  `,
})
export class ColregsAnimatedViewComponent {
  readonly mode = signal<'radar' | 'lights'>('radar');
  readonly vessel = signal('Sailing');
  setVessel(event: Event): void { this.vessel.set((event.target as HTMLSelectElement).value); }
}
