import { describe, expect, it } from 'vitest';
import { ColregsAnimatedViewComponent } from './colregs-animated-view.component';

describe('ColregsAnimatedViewComponent', () => {
  it('starts in radar mode with the sailing-vessel aspect', () => {
    const component = new ColregsAnimatedViewComponent();

    expect(component.mode()).toBe('radar');
    expect(component.vessel()).toBe('Sailing');
  });

  it('updates the displayed vessel aspect from the selector event', () => {
    const component = new ColregsAnimatedViewComponent();

    component.setVessel({ target: { value: 'Fishing' } } as unknown as Event);

    expect(component.vessel()).toBe('Fishing');
  });
});