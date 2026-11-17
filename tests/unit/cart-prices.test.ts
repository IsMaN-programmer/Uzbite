import test from 'node:test';
import assert from 'node:assert/strict';
import { cartLinePrice } from '../../apps/frontend/src/lib/cart-prices.js';

test('changed menu prices replace cached cart unit prices and use the server line total', () => {
  const result = cartLinePrice({ dishId: 'pasta', price: 40000, quantity: 2 }, [{ dishId: 'pasta', unitPrice: 45000, total: 90000 }]);
  assert.deepEqual(result, { unitPrice: 45000, total: 90000, verified: true, updated: true });
});

test('equivalent decimal strings do not produce a false price-change notice', () => {
  const result = cartLinePrice({ dishId: 'pasta', price: '42000.00', quantity: 2 }, [{ dishId: 'another-dish', unitPrice: 1, total: 1 }, { dishId: 'pasta', unitPrice: 42000 }]);
  assert.deepEqual(result, { unitPrice: 42000, total: 84000, verified: true, updated: false });
});

test('missing quote lines remain explicitly unverified estimates', () => {
  const result = cartLinePrice({ dishId: 'pasta', price: '42000', quantity: 2 }, [{ dishId: 'another-dish', unitPrice: 1, total: 1 }]);
  assert.deepEqual(result, { unitPrice: 42000, total: 84000, verified: false, updated: false });
});
