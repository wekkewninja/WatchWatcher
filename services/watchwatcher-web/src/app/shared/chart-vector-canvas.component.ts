import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import * as L from 'leaflet';
import { NavigationMathService } from '../core/services/navigation-math.service';
import { LocaleService, TranslationPipe } from '../core/locale.service';

interface ChartRegion {
  id: string;
  name: string;
  center: L.LatLngExpression;
  fix: L.LatLngExpression;
}

const chartRegions: ChartRegion[] = [
  { id: 'solent', name: 'Solent · UK', center: [50.78, -1.30], fix: [50.78, -1.30] },
  { id: 'chesapeake', name: 'Chesapeake Bay · US', center: [37.15, -76.35], fix: [37.15, -76.35] },
  { id: 'san-francisco', name: 'San Francisco Bay · US', center: [37.78, -122.35], fix: [37.78, -122.35] },
];

@Component({
  selector: 'ww-chart-vector-canvas',
  standalone: true,
  imports: [FormsModule, MatCardModule, MatFormFieldModule, MatIconModule, MatSelectModule, MatSliderModule, TranslationPipe],
  template: `
    <mat-card class="vector-card"><mat-card-header><mat-icon mat-card-avatar>explore</mat-icon><mat-card-title>{{ 'chart.title' | t }}</mat-card-title><mat-card-subtitle>{{ 'chart.subtitle' | t: { hours } }}</mat-card-subtitle></mat-card-header>
      <mat-card-content>
        <div class="chart-toolbar"><mat-form-field appearance="outline" class="region-control"><mat-label>{{ 'chart.area' | t }}</mat-label><mat-select [(ngModel)]="regionKey" (ngModelChange)="changeRegion($event)">@for (region of regions; track region.id) { <mat-option [value]="region.id">{{ region.name }}</mat-option> }</mat-select></mat-form-field><span class="chart-scale"><mat-icon>straighten</mat-icon> {{ 'chart.scale' | t: { region: regionName, hours } }}</span></div>
        <div #chartMap class="nautical-chart" role="application" [attr.aria-label]="'chart.mapAria' | t"></div>
        <div class="chart-legend" [attr.aria-label]="'chart.legendAria' | t"><span><i class="legend-fix"></i>Fix</span><span><i class="legend-dr"></i>DR</span><span><i class="legend-ep"></i>EP</span><span>{{ 'chart.water' | t }} <b>›</b><small>{{ waterDistance }} NM</small></span><span>{{ 'chart.ground' | t }} <b>››</b><small>{{ groundDistance }} NM</small></span><span>{{ 'chart.tide' | t }} <b>›››</b><small>{{ tideDistance }} NM</small></span><strong>{{ 'chart.cogSog' | t: { cog, sog } }}</strong></div>
      <div class="vector-controls"><label>{{ 'chart.boatSpeed' | t }} <strong>{{ boatSpeed.toFixed(1) }} kn</strong><mat-slider min="1" max="10" step="0.5"><input matSliderThumb [(ngModel)]="boatSpeed" (ngModelChange)="updatePlot()"></mat-slider></label><label>{{ 'chart.tideRate' | t }} <strong>{{ tideRate.toFixed(1) }} kn</strong><mat-slider min="0" max="5" step="0.25"><input matSliderThumb [(ngModel)]="tideRate" (ngModelChange)="updatePlot()"></mat-slider></label><label>{{ 'chart.waterHeading' | t }} <strong>{{ heading }}°T</strong><mat-slider min="0" max="359" step="1"><input matSliderThumb [(ngModel)]="heading" (ngModelChange)="updatePlot()"></mat-slider></label><label>{{ 'chart.tideSet' | t }} <strong>{{ tideSet }}°T</strong><mat-slider min="0" max="359" step="1"><input matSliderThumb [(ngModel)]="tideSet" (ngModelChange)="updatePlot()"></mat-slider></label><label>{{ 'chart.elapsedTime' | t }} <strong>{{ hours.toFixed(1) }} h</strong><mat-slider min="0.5" max="6" step="0.5"><input matSliderThumb [(ngModel)]="hours" (ngModelChange)="updatePlot()"></mat-slider></label></div>
      @if (tideRate > boatSpeed) { <p class="vector-warning"><mat-icon>warning</mat-icon> {{ 'chart.warning' | t }}</p> }
      </mat-card-content>
    </mat-card>
  `,
})
export class ChartVectorCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartMap', { static: true }) private chartElement!: ElementRef<HTMLDivElement>;

  constructor(private readonly navigationMath: NavigationMathService, private readonly locales: LocaleService = new LocaleService()) {}

  readonly regions = chartRegions;
  regionKey = 'solent';
  boatSpeed = 5;
  tideRate = 1;
  heading = 90;
  tideSet = 180;
  hours = 1;

  private map?: L.Map;
  private vectors?: L.LayerGroup;
  private scaleLabel?: HTMLSpanElement;
  private scaleLine?: HTMLSpanElement;

  ngAfterViewInit(): void {
    const region = this.selectedRegion;
    this.map = L.map(this.chartElement.nativeElement, {
      center: region.center,
      zoom: 11,
      zoomControl: true,
      scrollWheelZoom: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(this.map);
    L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openseamap.org/">OpenSeaMap</a>',
    }).addTo(this.map);
    this.vectors = L.layerGroup().addTo(this.map);
    const scaleControl = new L.Control({ position: 'bottomleft' });
    scaleControl.onAdd = () => {
      const container = L.DomUtil.create('div', 'leaflet-nautical-scale');
      this.scaleLabel = L.DomUtil.create('span', 'nautical-scale-label', container);
      this.scaleLine = L.DomUtil.create('span', 'nautical-scale-line', container);
      L.DomEvent.disableClickPropagation(container);
      return container;
    };
    scaleControl.addTo(this.map);
    this.map.on('zoomend moveend', this.updateScaleBar);
    this.updatePlot();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  ngOnDestroy(): void { this.map?.remove(); }

  changeRegion(regionKey: string): void {
    this.regionKey = regionKey;
    const region = this.selectedRegion;
    this.map?.setView(region.center, 11, { animate: false });
    this.updatePlot();
  }

  updatePlot(): void {
    if (!this.map || !this.vectors) return;
    const fix = L.latLng(this.selectedRegion.fix);
    const waterVector = this.components(this.heading, this.boatSpeed * this.hours);
    const dr = this.offset(fix, waterVector.east, waterVector.north);
    const tideVector = this.components(this.tideSet, this.tideRate * this.hours);
    const ep = this.offset(dr, tideVector.east, tideVector.north);
    const ground = this.navigationMath.calculateGroundVector(this.heading, this.boatSpeed, this.tideSet, this.tideRate);

    this.vectors.clearLayers();
    this.addTrack([fix, dr], 'water', 1, this.heading);
    this.addTrack([dr, ep], 'tide', 3, this.tideSet);
    this.addTrack([fix, ep], 'ground', 2, ground.courseOverGround);
    this.addPoint(fix, 'fix', 'FIX');
    this.addPoint(dr, 'dr', 'DR');
    this.addPoint(ep, 'ep', 'EP');
    this.map.fitBounds(L.latLngBounds([fix, dr, ep]), {
      paddingTopLeft: [72, 72],
      paddingBottomRight: [96, 72],
      maxZoom: 11,
      animate: false,
    });
    this.updateScaleBar();
  }

  get groundVector() { return this.navigationMath.calculateGroundVector(this.heading, this.boatSpeed, this.tideSet, this.tideRate); }
  get cog(): number { return Math.round(this.groundVector.courseOverGround); }
  get sog(): string { return this.groundVector.speedOverGround.toFixed(2); }
  get waterDistance(): string { return (this.boatSpeed * this.hours).toFixed(1); }
  get tideDistance(): string { return (this.tideRate * this.hours).toFixed(1); }
  get groundDistance(): string { return (this.groundVector.speedOverGround * this.hours).toFixed(2); }
  get regionName(): string { return this.selectedRegion.name; }

  private updateScaleBar = (): void => {
    if (!this.map || !this.scaleLabel || !this.scaleLine) return;
    const center = this.map.getCenter();
    const longitudePerNm = 1 / (60 * Math.cos(center.lat * Math.PI / 180));
    const start = this.map.latLngToContainerPoint(center);
    const end = this.map.latLngToContainerPoint([center.lat, center.lng + longitudePerNm]);
    const pixelsPerNm = Math.abs(end.x - start.x);
    if (!Number.isFinite(pixelsPerNm) || pixelsPerNm <= 0) return;
    const approximateNm = 72 / pixelsPerNm;
    const magnitude = 10 ** Math.floor(Math.log10(approximateNm));
    const factor = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= approximateNm) ?? 10;
    const scaleNm = factor * magnitude;
    this.scaleLabel.textContent = this.locales.translate('chart.scaleNm', { distance: scaleNm });
    this.scaleLine.style.width = `${scaleNm * pixelsPerNm}px`;
  };

  private get selectedRegion(): ChartRegion { return chartRegions.find((region) => region.id === this.regionKey) ?? chartRegions[0]; }

  private components(bearing: number, distance: number): { east: number; north: number } {
    const radians = bearing * Math.PI / 180;
    return { east: Math.sin(radians) * distance, north: Math.cos(radians) * distance };
  }

  private offset(origin: L.LatLng, eastNm: number, northNm: number): L.LatLng {
    const latitude = origin.lat + northNm / 60;
    const longitude = origin.lng + eastNm / (60 * Math.cos(origin.lat * Math.PI / 180));
    return L.latLng(latitude, longitude);
  }

  private addTrack(points: L.LatLng[], type: 'water' | 'ground' | 'tide', arrowCount: number, bearing: number): void {
    if (!this.vectors) return;
    L.polyline(points, { color: '#303936', weight: 1.6, opacity: 0.9, lineCap: 'round' }).addTo(this.vectors);
    const arrowPoint = L.latLng(
      points[0].lat + (points[1].lat - points[0].lat) * 0.67,
      points[0].lng + (points[1].lng - points[0].lng) * 0.67,
    );
    const arrows = '›'.repeat(arrowCount);
    const icon = L.divIcon({
      className: 'chart-arrow-icon',
      html: `<span class="chart-arrowheads chart-arrow-${type}" style="transform:rotate(${bearing - 90}deg)">${arrows}</span>`,
      iconSize: [arrowCount * 8 + 4, 18],
      iconAnchor: [arrowCount * 4 + 2, 9],
    });
    L.marker(arrowPoint, { icon, interactive: false, keyboard: false }).addTo(this.vectors);
  }

  private addPoint(position: L.LatLng, type: 'fix' | 'dr' | 'ep', label: string): void {
    const icon = L.divIcon({
      className: `chart-point-icon chart-point-${type}`,
      html: `<span class="chart-point-symbol"></span><span class="chart-point-name">${label}</span>`,
      iconSize: [60, 20],
      iconAnchor: [8, 8],
    });
    L.marker(position, { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(this.vectors!);
  }
}
