import * as L from 'leaflet';
import { describe, expect, it, vi } from 'vitest';
import { NavigationMathService } from '../core/services/navigation-math.service';
import { ChartVectorCanvasComponent } from './chart-vector-canvas.component';

function createChart() {
  const navigationMath = {
    calculateGroundVector: vi.fn().mockReturnValue({ courseOverGround: 105, speedOverGround: 5.2 }),
  } as unknown as NavigationMathService;
  const chart = new ChartVectorCanvasComponent(navigationMath);
  const map = {
    fitBounds: vi.fn(),
    getCenter: () => L.latLng(50.78, -1.30),
    latLngToContainerPoint: (position: L.LatLng | [number, number]) => {
      const point = Array.isArray(position) ? position : [position.lat, position.lng];
      return L.point(point[1] * 10000, point[0] * 10000);
    },
    remove: vi.fn(),
    setView: vi.fn(),
  };
  const internals = chart as unknown as {
    map: L.Map;
    vectors: L.LayerGroup;
    scaleLabel: HTMLSpanElement;
    scaleLine: HTMLSpanElement;
  };
  internals.map = map as unknown as L.Map;
  internals.vectors = L.layerGroup();
  internals.scaleLabel = document.createElement('span');
  internals.scaleLine = document.createElement('span');
  return { chart, map, internals, navigationMath };
}

describe('ChartVectorCanvasComponent', () => {
  it('plots fix, dead reckoning, estimated position, vector tracks, and a nautical scale', () => {
    const { chart, internals, navigationMath } = createChart();

    chart.updatePlot();

    expect(internals.vectors.getLayers()).toHaveLength(9);
    expect(internals.map.fitBounds).toHaveBeenCalledOnce();
    expect(internals.scaleLabel.textContent).toMatch(/\d+ NM/);
    expect(Number.parseFloat(internals.scaleLine.style.width)).toBeGreaterThan(0);
    expect(chart.waterDistance).toBe('5.0');
    expect(chart.tideDistance).toBe('1.0');
    expect(chart.cog).toBe(105);
    expect(chart.sog).toBe('5.20');
    expect(chart.groundDistance).toBe('5.20');
    expect(navigationMath.calculateGroundVector).toHaveBeenCalledWith(90, 5, 180, 1);
  });

  it('changes chart regions, falls back to the default region, and removes the map on destroy', () => {
    const { chart, map } = createChart();

    chart.changeRegion('chesapeake');
    expect(chart.regionName).toBe('Chesapeake Bay · US');
    expect(map.setView).toHaveBeenCalledWith([37.15, -76.35], 11, { animate: false });
    expect(map.fitBounds).toHaveBeenCalledOnce();

    chart.changeRegion('unknown');
    expect(chart.regionName).toBe('Solent · UK');
    expect(map.setView).toHaveBeenLastCalledWith([50.78, -1.3], 11, { animate: false });
    chart.ngOnDestroy();
    expect(map.remove).toHaveBeenCalledOnce();
  });

  it('does nothing before map initialization', () => {
    const chart = new ChartVectorCanvasComponent({
      calculateGroundVector: () => ({ courseOverGround: 0, speedOverGround: 0 }),
    } as unknown as NavigationMathService);

    expect(() => chart.updatePlot()).not.toThrow();
    chart.ngOnDestroy();
  });
});