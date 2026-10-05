import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePerson } from '../src/lib/person.js';

test('Dwiki dan Dwiky dipetakan ke assignee canonical yang sama', () => {
  assert.equal(normalizePerson('Dwiki'), 'dwiki');
  assert.equal(normalizePerson('Dwiky'), 'dwiki');
  assert.equal(normalizePerson('dwikygobimbel'), 'dwiki');
});

test('Allif dan Allief dipetakan ke assignee canonical yang sama', () => {
  assert.equal(normalizePerson('Allif'), 'allief');
  assert.equal(normalizePerson('Allief'), 'allief');
});
