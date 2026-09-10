import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { getPageSlice, getTotalPages } from '../src/components/PaginationControls.tsx';

const inventoryIds = Array.from({ length: 25 }, (_, index) => `item-${index + 1}`);

test('pagination splits a filtered inventory result into ten-item pages', () => {
  assert.equal(getTotalPages(inventoryIds.length), 3);
  assert.deepEqual(getPageSlice(inventoryIds, 1), inventoryIds.slice(0, 10));
  assert.deepEqual(getPageSlice(inventoryIds, 2), inventoryIds.slice(10, 20));
  assert.deepEqual(getPageSlice(inventoryIds, 3), inventoryIds.slice(20, 25));
});

test('pagination leaves source items unchanged and returns no duplicate rows between pages', () => {
  const firstPage = getPageSlice(inventoryIds, 1);
  const secondPage = getPageSlice(inventoryIds, 2);
  const thirdPage = getPageSlice(inventoryIds, 3);

  assert.equal(inventoryIds.length, 25);
  assert.equal(new Set([...firstPage, ...secondPage, ...thirdPage]).size, 25);
});

test('pagination safely reduces the last page when filtered results shrink', () => {
  const filteredIds = inventoryIds.slice(0, 11);

  assert.equal(getTotalPages(filteredIds.length), 2);
  assert.deepEqual(getPageSlice(filteredIds, 2), ['item-11']);
  assert.equal(getTotalPages(filteredIds.slice(0, 10).length), 1);
});
