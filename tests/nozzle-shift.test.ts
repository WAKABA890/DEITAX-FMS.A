import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calculateShiftVolume } from '../src/utils/nozzle-shift.ts';

test('a new shift starts at zero volume even after a prior 160 litre shift', () => {
  const previousShiftVolume = calculateShiftVolume(510, 350);
  const newShiftVolume = calculateShiftVolume(510, 510);

  assert.equal(previousShiftVolume, 160);
  assert.equal(newShiftVolume, 0);
});

test('current shift volume uses only the current and opening nozzle readings', () => {
  assert.equal(calculateShiftVolume(560, 510), 50);
  assert.equal(calculateShiftVolume(510, 510), 0);
  assert.equal(calculateShiftVolume(500, 510), 0);
});