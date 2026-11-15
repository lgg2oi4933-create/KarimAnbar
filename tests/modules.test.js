import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, flatten, descendantIds, pathNames, wouldCycle } from '../js/modules/products/tree.js';
import { partyName, isValidMobile, normalizeMobile, isValidNationalId } from '../js/modules/parties/model.js';
import { suggestName, dimsText } from '../js/modules/products/model.js';

const cats = [
  { id: 'a', name: 'ورق', parentId: '' },
  { id: 'b', name: 'سه میل', parentId: 'a' },
  { id: 'c', name: 'پنج میل', parentId: 'a' },
  { id: 'd', name: 'ریز', parentId: 'b' },
  { id: 'e', name: 'چسب', parentId: '' },
];

test('tree: build, flatten, descendants, path', () => {
  const flat = flatten(cats);
  // ترتیب الفبایی فارسی در هر سطح: چسب، ورق (پنج میل، سه میل (ریز))
  assert.deepEqual(flat.map((x) => [x.cat.id, x.depth]), [['e', 0], ['a', 0], ['c', 1], ['b', 1], ['d', 2]]);
  assert.deepEqual([...descendantIds(cats, 'a')].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(pathNames(cats, 'd'), 'ورق › سه میل › ریز');
  assert.equal(buildTree(cats).length, 2);
});

test('tree: cycle detection and orphan handling', () => {
  assert.equal(wouldCycle(cats, 'a', 'd'), true);
  assert.equal(wouldCycle(cats, 'a', 'a'), true);
  assert.equal(wouldCycle(cats, 'd', 'e'), false);
  assert.equal(wouldCycle(cats, 'd', ''), false);
  const orphan = [{ id: 'x', name: 'یتیم', parentId: 'gone' }];
  assert.equal(buildTree(orphan).length, 1);
});

test('parties: names, mobile, national id', () => {
  assert.equal(partyName({ firstName: 'علی', lastName: 'کریمی' }), 'علی کریمی');
  assert.equal(partyName({ company: 'پارس', firstName: 'علی' }), 'پارس (علی)');
  assert.equal(normalizeMobile('+98 912 345 6789'), '09123456789');
  assert.equal(normalizeMobile('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
  assert.equal(isValidMobile('9123456789'), true);
  assert.equal(isValidMobile('0212345'), false);
  assert.equal(isValidNationalId('0499370899'), true);
  assert.equal(isValidNationalId('1111111111'), false);
  assert.equal(isValidNationalId('0499370890'), false);
});

test('products: auto name from dimensions', () => {
  assert.equal(suggestName('tray', 20, 30), 'سینی ۲۰×۳۰');
  assert.equal(suggestName('glue', 20, 30), '');
  assert.equal(dimsText({ length: 20.5, width: 30 }), '۲۰٫۵×۳۰');
});
