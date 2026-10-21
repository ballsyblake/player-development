const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const I = require('../js/importer.js');
const E = require('../js/exporter.js');

// Synthetic workbook reproducing the masterfile's quirks with fictional people.
function workbook() {
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
  add('QSTQAS - Girls Full Time', [
    [null, '2027 Girls State Team and QAS Program'],
    [null, 'Program', "Athlete's First Name", "Athlete's Last Name", 'Column1', 'Date of Birth', '2026 Club/Program', 'Offer Response', 'Program Fee Admendments', '2027 Retention Status2', 'Notes', 'Position', null, 'Primary Parent/Caregiver', 'Email Address', 'Mobile Number', 'Secondary Parent/Caregiver', 'Email Address3', 'Mobile Number4', 'Jersey Size', 'Short Size', 'Sock Size'],
    [1, 'QAS NPLW', 'Ava', 'Sample', 'Ava Sample', new Date(2010, 0, 12), 'Demo FC', 'Offer Accepted', '100% No Fee', 'Retain', 'Monitoring', 'Goalkeeper', null, 'Pat Sample', 'PAT@EXAMPLE.COM', 412000111, 'Lee Sample', 'lee@example.com', 412000222, 'Female Cut - Small', 'Female Cut - Medium', '2 to 7'],
    [null, 'Program', "Athlete's First Name", "Athlete's Last Name"],
    [2, 'QST U15', 'Mia', 'Example', 'Mia Example', '13/03/2012', 'Demo FC', 'Paid', null, 'New QST Intake', null, 'Outfield']
  ]);
  add('QST - Boys Full Time', [
    ['2026 Boys State Team Program'],
    ['Program', "Athlete's First Name", "Athlete's Last Name", null, 'Date of Birth', 'Fee Admendments', '2027 Retention Status', 'Response to Offer', 'Notes', null, 'Position', 'Primary Parent/Caregiver', 'Email Address', 'Mobile Number', 'Secondary Parent/Caregiver', 'Email Address', 'Mobile Number', 'Unisex - Large', 'Unisex - Large', '7 to 11'],
    ['QST Boys', 'Leo', 'Demo', 'Leo Demo', new Date(2011, 2, 10), null, 'Offer Renewal', 'Pending Response', null, null, 'Outfield', 'Sam Demo', 'sam@example.com', '0415000333', null, null, null, 'Unisex - Medium', 'Unisex - Large', '7 to 11']
  ]);
  add('Central Coast', [
    ['2027 Emerging Program - Central Coast'],
    ['Program', "Athlete's First Name", "Athlete's Last Name", null, 'DOB', '2027 Age Group', 'Type', 'Hub', '2027 Offer Status', '2027 Letter Type', '2027 Offer Response', 'Notes', 'Primary Caregiver (Prefered)', 'Email Address', 'Contact Number', 'Secondary Caregiver', 'Email Address', 'Contact Number'],
    [],
    ['FQA - CC', 'Kai', 'Testwood', 'Kai Testwood', new Date(2018, 10, 3), 'U09 Boys', 'Junior ', 'Gladstone Hub (Blue)', 'Waitlist', 'Waitlist Letter', 'Notice Sent', 'Waitlist number 2', 'Jo Testwood', 'jo@example.com', 478000444],
    ['FQA - CC'],
    ['2026 Program Graduates'],
    ['FQA - CC', 'Zara', 'Mock', 'Zara Mock', new Date(2010, 4, 1), 'U17 Girls', 'Youth', 'Rockhampton Hub (White)', 'Graduate', 'Graduate Letter', 'Notice Sent', null, 'Kim Mock', 'kim@example.com', '0400 000 555']
  ]);
  add('Burdekin T2 Hub', [
    ['Burdekin Development Hub'],
    ['Program', "Athlete's First Name", "Athlete's Last Name", null, 'Date of Birth', '2026 Age Group', 'Type of Letter', 'Letter Type', '2026 Program Fee', '2027 Retention Status', 'Notes', 'Primary Caregiver Name', 'Primary Email Address', 'Primary Mobile Number'],
    ['Burdekin Hub', 'Eli', 'Draftly', 'Eli Draftly', new Date(2017, 7, 31), 'U09 Boys', 'New Player Offer', 'Letter of Offer', 'No Response', 'Early Retention', null, 'Drew Draftly', 'drew@example.com', '0418000666']
  ]);
  add('Random Notes', [['nothing here']]);
  return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellDates: true });
}

test('imports every tab, skipping headers, placeholders and titles', () => {
  const { players, reports } = I.importWorkbook(XLSX, workbook(), { now: '2026-10-21T00:00:00Z' });
  assert.equal(players.length, 6);
  const byName = Object.fromEntries(players.map(p => [p.firstName, p]));

  const ava = byName.Ava;
  assert.equal(ava.programId, 'qas-nplw');
  assert.equal(ava.gender, 'Female');
  assert.equal(ava.dob, '2010-01-12');
  assert.equal(ava.response, 'Accepted');
  assert.equal(ava.offerStatus, 'Retain');
  assert.equal(ava.position, 'Goalkeeper');
  assert.deepEqual(ava.contacts[0], { name: 'Pat Sample', email: 'pat@example.com', phone: '0412 000 111' });
  assert.equal(ava.contacts[1].phone, '0412 000 222');
  assert.equal(ava.jersey, 'Female Cut - Small');
  assert.equal(ava.sock, '2 to 7');

  assert.equal(byName.Mia.programId, 'qst-girls-u15');
  assert.equal(byName.Mia.dob, '2012-03-13');
  assert.equal(byName.Mia.fee, 'Paid');

  // Boys tab: kit sizes live in columns whose headers are size values, not labels.
  assert.equal(byName.Leo.response, 'Awaiting Response');
  assert.equal(byName.Leo.offerStatus, 'Offer Renewal');

  const kai = byName.Kai;
  assert.equal(kai.programId, 'cc');
  assert.equal(kai.hub, 'Gladstone Hub (Blue)');
  assert.equal(kai.waitlistRank, 2);
  assert.equal(kai.recordedAgeGroupSeason, 2027);
  assert.equal(byName.Zara.section, '2026 Program Graduates');
  assert.equal(byName.Zara.gender, 'Female');

  const eli = byName.Eli;
  assert.equal(eli.programId, 'burdekin');
  assert.equal(eli.hub, 'Burdekin Hub');
  assert.equal(eli.priorStatus, 'New Player Offer');
  assert.equal(eli.offerStatus, 'Early Retention');
  assert.equal(eli.fee, 'No Response');

  const unknown = reports.find(r => r.sheet === 'Random Notes');
  assert.match(unknown.warnings[0], /No header row/);
});

test('merge updates matching players and records history', () => {
  const first = I.importWorkbook(XLSX, workbook()).players;
  const again = I.importWorkbook(XLSX, workbook()).players;
  again.find(p => p.firstName === 'Leo').response = 'Accepted';
  again.push({ ...again[0], id: 'new', firstName: 'Newbie', contacts: [{ name: '', email: '', phone: '' }, { name: '', email: '', phone: '' }] });
  const res = I.merge(first, again, { now: '2026-10-22T00:00:00Z', user: 'Tester' });
  assert.deepEqual(res, { added: 1, updated: 1, unchanged: 5 });
  const leo = first.find(p => p.firstName === 'Leo');
  assert.equal(leo.response, 'Accepted');
  assert.match(leo.history.at(-1).what, /response: "Awaiting Response" -> "Accepted"/);
});

test('export workbook round-trips through the importer', () => {
  const players = I.importWorkbook(XLSX, workbook()).players;
  const out = E.workbook(XLSX, players, 2027);
  assert.ok(out.SheetNames.includes('All Players'));
  assert.ok(out.SheetNames.includes('Central Coast'));
  const rows = XLSX.utils.sheet_to_json(out.Sheets['All Players']);
  assert.equal(rows.length, players.length);
  assert.equal(rows.find(r => r['First Name'] === 'Kai')['Age Group'], 'U09 Boys');
  assert.match(E.csv(players, 2027).split('\r\n')[0], /^Program,Tier,First Name/);
});
