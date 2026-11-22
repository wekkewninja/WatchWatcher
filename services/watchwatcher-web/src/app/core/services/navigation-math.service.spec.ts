import { NavigationMathService } from './navigation-math.service';

describe('NavigationMathService', () => {
  const navigation = new NavigationMathService();

  it('combines water and tide vectors into course and speed over ground', () => {
    const result = navigation.calculateGroundVector(90, 6, 180, 2);
    expect(result.courseOverGround).toBeCloseTo(108.435, 2);
    expect(result.speedOverGround).toBeCloseTo(6.325, 2);
  });

  it('normalizes a northbound vector and handles no movement', () => {
    expect(navigation.calculateGroundVector(0, 5, 0, 1).courseOverGround).toBeCloseTo(0, 6);
    expect(navigation.calculateGroundVector(90, 0, 270, 0).speedOverGround).toBe(0);
  });
});
