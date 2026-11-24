import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateShippingAmount } from '../src/lib/shipping-estimate';

test('uses the configured base through 500 g, then rounds each extra half-kilo up', () => {
  assert.equal(estimateShippingAmount(20_000, 'Tp Hồ Chí Minh', [{ weightGrams: 500, quantity: 1 }]), 20_000);
  assert.equal(estimateShippingAmount(20_000, 'Tp Hồ Chí Minh', [{ weightGrams: 501, quantity: 1 }]), 30_000);
});

test('adds the interprovincial surcharge for provinces outside Ho Chi Minh City', () => {
  assert.equal(estimateShippingAmount(20_000, 'Hà Nội', [{ weightGrams: 500, quantity: 1 }]), 40_000);
  assert.equal(estimateShippingAmount(20_000, 'TP. Hồ Chí Minh', [{ weightGrams: 500, quantity: 1 }]), 20_000);
  assert.equal(estimateShippingAmount(20_000, 'Thành phố Hồ Chí Minh', [{ weightGrams: 500, quantity: 1 }]), 20_000);
});

test('multiplies item weight by quantity before calculating the fee', () => {
  assert.equal(
    estimateShippingAmount(20_000, 'Hà Nội', [
      { weightGrams: 200, quantity: 2 },
      { weightGrams: 150, quantity: 1 },
    ]),
    50_000,
  );
});

test('rejects invalid weights, quantities, destinations and unrepresentable fees', () => {
  assert.throws(() => estimateShippingAmount(20_000, 'Hà Nội', [{ weightGrams: 0, quantity: 1 }]), RangeError);
  assert.throws(() => estimateShippingAmount(20_000, 'Hà Nội', [{ weightGrams: 100, quantity: 0 }]), RangeError);
  assert.throws(() => estimateShippingAmount(20_000, ' ', [{ weightGrams: 100, quantity: 1 }]), RangeError);
  assert.throws(
    () => estimateShippingAmount(2_147_483_647, 'Hà Nội', [{ weightGrams: 500, quantity: 1 }]),
    RangeError,
  );
});
