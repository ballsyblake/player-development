const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/model.js');

test('normPhone restores leading zero and formats', () => {
  assert.equal(M.normPhone(413821163), '0413 821 163');
  assert.equal(M.normPhone('0456 501 470'), '0456 501 470');
  assert.equal(M.normPhone('+61 412 345 678'), '0412 345 678');
  assert.equal(M.normPhone('-'), '');
  assert.equal(M.isValidPhone(M.normPhone('04993444679')), false);
});

test('normDate handles Date, dd/mm/yyyy and ISO', () => {
  assert.equal(M.normDate(new Date(2010, 0, 12)), '2010-01-12');
  assert.equal(M.normDate('13/03/2012'), '2012-03-13');
  assert.equal(M.normDate('2012-07-25'), '2012-07-25');
  assert.equal(M.normDate('05/10/2-12'), '');
  assert.equal(M.normDate('2012'), '');
});

test('age groups follow season minus birth year', () => {
  assert.equal(M.ageGroupFor('2018-11-03', 2027), 'U09');
  assert.equal(M.ageGroupFor('2011-01-01', 2027), 'U16');
  assert.deepEqual(M.parseAgeGroup('Under 09 Boys'), { age: 'U09', gender: 'Male' });
  assert.deepEqual(M.parseAgeGroup('U13 Boys (Born 2014)'), { age: 'U13', gender: 'Male' });
  assert.deepEqual(M.parseAgeGroup('U9 Girls'), { age: 'U09', gender: 'Female' });
  assert.equal(M.typeFor('U12'), 'Junior');
  assert.equal(M.typeFor('U13'), 'Youth');
});

test('normResponse maps spreadsheet variants', () => {
  assert.equal(M.normResponse('Offer Accepted'), 'Accepted');
  assert.equal(M.normResponse('Pending Response'), 'Awaiting Response');
  assert.equal(M.normResponse('SEND OFFER FOR QAS'), 'Please Send');
  assert.equal(M.normResponse('Signing with another club'), 'Signing with another club');
});

test('titleName only fixes single-case names', () => {
  assert.equal(M.titleName('amanda smart'), 'Amanda Smart');
  assert.equal(M.titleName("O'Farrell"), "O'Farrell");
  assert.equal(M.titleName('McKell'), 'McKell');
});

test('issues flag missing contacts, bad email, age mismatch and duplicates', () => {
  const a = M.newPlayer({ firstName: 'Test', lastName: 'Kid', dob: '2018-05-01', programId: 'fng', recordedAgeGroup: 'U10 Boys', recordedAgeGroupSeason: 2027 });
  const b = M.newPlayer({ firstName: 'Test', lastName: 'Kid', dob: '2018-05-01', programId: 'qst-boys' });
  b.contacts[0] = { name: 'P', email: 'bad@', phone: '0412 345 678' };
  const idx = M.buildDupIndex([a, b]);
  const ia = M.issues(a, 2027, idx).map(i => i.msg).join('|');
  assert.match(ia, /No primary contact/);
  assert.match(ia, /Recorded U10 but DOB gives U09/);
  assert.match(ia, /Appears in 2 programs/);
  assert.match(M.issues(b, 2027, idx).map(i => i.msg).join('|'), /email looks invalid/);
});
