import { Injectable } from '@angular/core';

export interface GroundVector {
  eastKnots: number;
  northKnots: number;
  courseOverGround: number;
  speedOverGround: number;
}

@Injectable({ providedIn: 'root' })
export class NavigationMathService {
  calculateGroundVector(waterHeading: number, boatSpeed: number, tideSet: number, tideRate: number): GroundVector {
    const water = this.components(waterHeading, boatSpeed);
    const tide = this.components(tideSet, tideRate);
    const eastKnots = water.east + tide.east;
    const northKnots = water.north + tide.north;
    const speedOverGround = Math.hypot(eastKnots, northKnots);
    const courseOverGround = speedOverGround === 0
      ? 0
      : (Math.atan2(eastKnots, northKnots) * 180 / Math.PI + 360) % 360;
    return { eastKnots, northKnots, courseOverGround, speedOverGround };
  }

  private components(bearing: number, speed: number): { east: number; north: number } {
    const radians = bearing * Math.PI / 180;
    return { east: Math.sin(radians) * speed, north: Math.cos(radians) * speed };
  }
}
