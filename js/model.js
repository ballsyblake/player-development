/*
 * Domain model: lookup lists, normalisers and validation rules.
 * Pure functions only - no DOM - so it runs in the browser and under node --test.
 */
(function (root) {
  'use strict';

  var TIERS = ['Full Time', 'Emerging', 'Development Hub'];

  // Region / program catalogue derived from the masterfile tabs.
  var PROGRAMS = [
    { id: 'qas-nplw', name: 'QAS NPLW', tier: 'Full Time', region: 'State', gender: 'Female' },
    { id: 'qst-girls-u16', name: 'QST Girls U16', tier: 'Full Time', region: 'State', gender: 'Female' },
    { id: 'qst-girls-u15', name: 'QST Girls U15', tier: 'Full Time', region: 'State', gender: 'Female' },
    { id: 'qst-girls-standby', name: 'QST Girls Standby', tier: 'Full Time', region: 'State', gender: 'Female' },
    { id: 'qst-boys', name: 'QST Boys', tier: 'Full Time', region: 'State', gender: 'Male' },
    { id: 'fng', name: 'Far North & Gulf', tier: 'Emerging', region: 'Far North & Gulf' },
    { id: 'nor', name: 'Northern', tier: 'Emerging', region: 'Northern' },
    { id: 'whc', name: 'Whitsunday Coast', tier: 'Emerging', region: 'Whitsunday Coast' },
    { id: 'cc', name: 'Central Coast', tier: 'Emerging', region: 'Central Coast' },
    { id: 'wb', name: 'Wide Bay', tier: 'Emerging', region: 'Wide Bay' },
    { id: 'metro', name: 'Metro', tier: 'Emerging', region: 'Metro' },
    { id: 'mtisa', name: 'Mt Isa Hub', tier: 'Development Hub', region: 'Northern' },
    { id: 'fn-hubs', name: 'Far North Hubs', tier: 'Development Hub', region: 'Far North & Gulf' },
    { id: 'burdekin', name: 'Burdekin Hub', tier: 'Development Hub', region: 'Northern' }
  ];

  // Suggested values per field (union of the dropdown lists in the workbook).
  var LOOKUPS = {
    offerStatus: ['New Player Offer', 'Early Retention', 'Offer Renewal', 'Review', 'Review to Retain',
      'Review to Release', 'Waitlist', 'Graduate', 'Release', 'Retain', 'Promote', 'New Intake', 'Standby',
      'Withdrawn', 'Hold'],
    letterType: ['Letter of Offer', 'Retrial Letter', 'Review Letter', 'Waitlist Letter', 'Release Letter',
      'Graduate Letter', 'Unsuccessful Letter', 'No Letter Required'],
    response: ['Please Send', 'Awaiting Response', 'Accepted', 'Declined', 'Notice Sent', 'Hold'],
    fee: ['Paid', 'Unpaid', 'No Response', 'Payment Plan', 'Exempt'],
    feeAdjustment: ['', '100% No Fee', '50% Fee', 'Financial Hardship', 'Payment Extension'],
    registration: ['', 'Registered', 'Not Registered', 'Failed Registration'],
    position: ['', 'Outfield', 'Goalkeeper'],
    gender: ['Male', 'Female', ''],
    jersey: ['', 'Unisex - Extra Small', 'Unisex - Small', 'Unisex - Medium', 'Unisex - Large',
      'Unisex - Extra Large', 'Female Cut - Extra Small', 'Female Cut - Small', 'Female Cut - Medium',
      'Female Cut - Large', 'Female Cut - Extra Large'],
    sock: ['', '2 to 7', '7 to 11', '11 to 14']
  };

  // Response values that mean the family still owes us an answer.
  var OPEN_RESPONSES = ['Please Send', 'Awaiting Response', 'Hold', ''];

  var RESPONSE_SYNONYMS = {
    'offer accepted': 'Accepted', 'accepted': 'Accepted', 'paid': 'Accepted',
    'offer declined': 'Declined', 'declined': 'Declined',
    'pending response': 'Awaiting Response', 'awaiting response': 'Awaiting Response',
    'please send': 'Please Send', 'send offer': 'Please Send', 'notice sent': 'Notice Sent', 'hold': 'Hold'
  };

  function clean(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\s+/g, ' ').trim();
    return s === '-' ? '' : s;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Accepts Date, Excel serial, ISO string or dd/mm/yyyy (Australian). Returns YYYY-MM-DD or ''.
  function normDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date && !isNaN(v)) {
      // SheetJS dates can land a few seconds before midnight; round to nearest day.
      var d = new Date(v.getTime() + 12 * 3600 * 1000);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var ms = Math.round((v - 25569) * 86400000);
      var u = new Date(ms);
      return u.getUTCFullYear() + '-' + pad(u.getUTCMonth() + 1) + '-' + pad(u.getUTCDate());
    }
    var s = clean(v);
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (m) {
      var y = +m[3]; if (y < 100) y += 2000;
      if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return y + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    }
    return '';
  }

  // Australian mobile/landline: restores the leading zero Excel strips from numeric cells.
  function normPhone(v) {
    var s = clean(v);
    if (!s) return '';
    var digits = s.replace(/[^\d+]/g, '');
    if (digits.indexOf('+61') === 0) digits = '0' + digits.slice(3);
    if (/^61\d{9}$/.test(digits)) digits = '0' + digits.slice(2);
    if (/^[2-9]\d{8}$/.test(digits)) digits = '0' + digits;
    if (/^04\d{8}$/.test(digits)) return digits.slice(0, 4) + ' ' + digits.slice(4, 7) + ' ' + digits.slice(7);
    if (/^0[2378]\d{8}$/.test(digits)) return digits.slice(0, 2) + ' ' + digits.slice(2, 6) + ' ' + digits.slice(6);
    return s;
  }

  function isValidPhone(p) { return !p || /^0\d{3} \d{3} \d{3}$|^0\d \d{4} \d{4}$/.test(p); }

  function normEmail(v) { return clean(v).replace(/^mailto:/i, '').toLowerCase(); }
  function isValidEmail(e) { return !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

  function titleName(v) {
    var s = clean(v);
    if (!s) return '';
    // Only fix names typed in a single case; leave intentional casing (McKell, O'Farrell) alone.
    if (s === s.toLowerCase() || s === s.toUpperCase()) {
      return s.toLowerCase().replace(/(^|[\s'\-])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); });
    }
    return s;
  }

  // Football age group for a season: season year minus birth year (born 2018 -> U09 in 2027).
  function ageGroupFor(dob, season) {
    if (!dob) return '';
    var age = season - (+dob.slice(0, 4));
    if (age < 5 || age > 23) return '';
    return 'U' + pad(age);
  }

  // "Under 09 Boys", "U9 Boys North", "U13 Boys (Born 2014)" -> { age: 'U09', gender: 'Male' }
  function parseAgeGroup(v) {
    var s = clean(v);
    var out = { age: '', gender: '' };
    var m = s.match(/(?:U|Under)\s*(\d{1,2})/i);
    if (m) out.age = 'U' + pad(+m[1]);
    if (/girl|female|women/i.test(s)) out.gender = 'Female';
    else if (/boy|male|men/i.test(s)) out.gender = 'Male';
    return out;
  }

  function typeFor(ageGroup) {
    var n = +String(ageGroup).slice(1);
    if (!n) return '';
    return n <= 12 ? 'Junior' : 'Youth';
  }

  function normResponse(v) {
    var s = clean(v);
    if (!s) return '';
    var k = s.toLowerCase();
    if (RESPONSE_SYNONYMS[k]) return RESPONSE_SYNONYMS[k];
    for (var key in RESPONSE_SYNONYMS) if (k.indexOf(key) === 0) return RESPONSE_SYNONYMS[key];
    return s;
  }

  function normFee(v) {
    var s = clean(v);
    if (/^paid$/i.test(s)) return 'Paid';
    if (/^no response$/i.test(s)) return 'No Response';
    return s;
  }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emptyContact() { return { name: '', email: '', phone: '' }; }

  function newPlayer(fields) {
    var p = {
      id: uid(),
      firstName: '', lastName: '', dob: '', gender: '',
      programId: '', hub: '', club: '', position: '',
      recordedAgeGroup: '', offerStatus: '', letterType: '', response: '',
      priorStatus: '', fee: '', feeAdjustment: '', registration: '',
      jersey: '', shorts: '', sock: '', waitlistRank: '', section: '',
      notes: '', flags: [],
      contacts: [emptyContact(), emptyContact()],
      history: [], source: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    for (var k in fields) if (fields[k] !== undefined) p[k] = fields[k];
    return p;
  }

  function program(id) {
    for (var i = 0; i < PROGRAMS.length; i++) if (PROGRAMS[i].id === id) return PROGRAMS[i];
    return null;
  }

  function fullName(p) { return (p.firstName + ' ' + p.lastName).trim(); }

  function isOpen(p) { return OPEN_RESPONSES.indexOf(p.response || '') !== -1; }

  // Data-quality issues for one player, given the whole list (for duplicate detection).
  function issues(p, season, dupIndex) {
    var out = [];
    if (!p.dob) out.push({ level: 'warn', msg: 'Missing date of birth' });
    var c1 = p.contacts[0] || emptyContact();
    if (!c1.email && !c1.phone) out.push({ level: 'error', msg: 'No primary contact details' });
    p.contacts.forEach(function (c, i) {
      var who = i === 0 ? 'Primary' : 'Secondary';
      if (!isValidEmail(c.email)) out.push({ level: 'error', msg: who + ' email looks invalid: ' + c.email });
      if (!isValidPhone(c.phone)) out.push({ level: 'warn', msg: who + ' phone looks invalid: ' + c.phone });
    });
    if (p.recordedAgeGroup && p.dob) {
      var calc = ageGroupFor(p.dob, season);
      var rec = parseAgeGroup(p.recordedAgeGroup).age;
      if (rec && calc && rec !== calc && p.recordedAgeGroupSeason === season) {
        out.push({ level: 'warn', msg: 'Recorded ' + rec + ' but DOB gives ' + calc + ' for ' + season });
      }
    }
    if (dupIndex) {
      var key = dupKey(p);
      if (key && dupIndex[key] && dupIndex[key].length > 1) {
        out.push({ level: 'info', msg: 'Appears in ' + dupIndex[key].length + ' programs' });
      }
    }
    if (!p.programId) out.push({ level: 'warn', msg: 'No program assigned' });
    return out;
  }

  function dupKey(p) {
    var n = fullName(p).toLowerCase().replace(/[^a-z]/g, '');
    return n ? n + '|' + (p.dob || '') : '';
  }

  function buildDupIndex(players) {
    var idx = {};
    players.forEach(function (p) {
      var k = dupKey(p);
      if (!k) return;
      (idx[k] = idx[k] || []).push(p.id);
    });
    return idx;
  }

  var api = {
    TIERS: TIERS, PROGRAMS: PROGRAMS, LOOKUPS: LOOKUPS, OPEN_RESPONSES: OPEN_RESPONSES,
    clean: clean, normDate: normDate, normPhone: normPhone, normEmail: normEmail, isValidEmail: isValidEmail,
    isValidPhone: isValidPhone, titleName: titleName, ageGroupFor: ageGroupFor, parseAgeGroup: parseAgeGroup,
    typeFor: typeFor, normResponse: normResponse, normFee: normFee, newPlayer: newPlayer, program: program,
    fullName: fullName, isOpen: isOpen, issues: issues, dupKey: dupKey, buildDupIndex: buildDupIndex, uid: uid
  };

  root.PD = root.PD || {};
  root.PD.model = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
