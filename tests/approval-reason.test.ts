import assert from 'node:assert/strict';
import { readableApprovalReason } from '../src/utils/approval-reason.ts';

const reason = 'Cash variance: KES -34005.00; Pump variance: INCOMPLETE. Nozzle evidence: ' + JSON.stringify([
  { pumpName: 'pump 01', fuelName: 'petrol', closingMeter: null, posSalesLiters: 0, closingMeterError: 'Unavailable; retry.' },
  { pumpName: 'pump 02', fuelName: 'diesel', openingMeter: 1250.5 },
]) + ' Tank evidence: ' + JSON.stringify([{ tankName: 'tank 01', varianceLiters: -32 }]);
const output = readableApprovalReason(reason);
assert.ok(output.includes('1. pump 01 / petrol'));
assert.ok(output.includes('2. pump 02 / diesel'));
assert.ok(output.includes('• Closing Meter: Not recorded'));
assert.ok(output.includes('• Pos Sales Liters: 0 L'));
assert.ok(output.includes('• Opening Meter: 1,250.5 L'));
assert.ok(output.includes('• Variance Liters: -32 L'));
assert.ok(!output.includes('[{'));
assert.ok(readableApprovalReason('Nozzle evidence: [broken]').includes('[broken]'));
assert.equal(readableApprovalReason(null), '');
console.log('Approval reason formatting checks passed.');
