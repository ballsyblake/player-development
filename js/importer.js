/*
 * Masterfile importer: turns the multi-tab Excel workbook (one tab per program, inconsistent
 * headers, repeated header rows, section titles) into flat player records.
 * Depends on SheetJS (global XLSX in the browser, require('xlsx') in node).
 */
(function (root) {
  'use strict';

  var M = root.PD && root.PD.model ? root.PD.model : require('./model.js');
  var MAX_COLS = 60; // some tabs carry thousands of empty formatted columns

  var SHEET_RULES = [
    { test: /girls/i, programFromColumn: true },
    { test: /boys/i, programId: 'qst-boys' },
    { test: /far north t2|far north.*hub/i, programId: 'fn-hubs', hubFromProgram: true },
    { test: /far north/i, programId: 'fng' },
    { test: /mt\.? ?isa|mount isa/i, programId: 'mtisa', hubFromProgram: true },
    { test: /burdekin/i, programId: 'burdekin', hubFromProgram: true },
    { test: /northern/i, programId: 'nor' },
    { test: /whitsunday/i, programId: 'whc' },
    { test: /central coast/i, programId: 'cc' },
    { test: /wide bay/i, programId: 'wb' },
    { test: /metro/i, programId: 'metro' }
  ];

  var GIRLS_PROGRAMS = [
    { test: /qas/i, id: 'qas-nplw' },
    { test: /u16/i, id: 'qst-girls-u16' },
    { test: /u15/i, id: 'qst-girls-u15' },
    { test: /standby/i, id: 'qst-girls-standby' }
  ];

  function ruleFor(sheetName) {
    for (var i = 0; i < SHEET_RULES.length; i++) if (SHEET_RULES[i].test.test(sheetName)) return SHEET_RULES[i];
    return null;
  }

  // Map one header cell to a field. `state` tracks which caregiver slot we're filling.
  function mapHeader(h, state) {
    var s = M.clean(h).toLowerCase();
    if (!s) return null;
    if (/first name/.test(s)) return { field: 'firstName' };
    if (/last name|surname/.test(s)) return { field: 'lastName' };
    if (/full name|^column\d*$/.test(s)) return null;
    if (/date of birth|^dob$/.test(s)) return { field: 'dob' };
    if (/age group/.test(s)) { var y = s.match(/(\d{4})/); return { field: 'recordedAgeGroup', season: y ? +y[1] : null }; }
    if (/^type$/.test(s)) return { field: 'typeCol' };
    if (/^hub$/.test(s)) return { field: 'hub' };
    if (/type of letter/.test(s)) return { field: 'priorStatus' };
    if (/retention status|offer status|offer type/.test(s)) return { field: 'offerStatus' };
    if (/letter type/.test(s)) return { field: 'letterType' };
    if (/response/.test(s)) return { field: 'response' };
    if (/^\d{4} status$/.test(s)) return { field: 'priorStatus' };
    if (/fee adm|fee amend|adjust/.test(s)) return { field: 'feeAdjustment' };
    if (/fee/.test(s)) return { field: 'fee' };
    if (/note/.test(s)) return { field: 'notes' };
    if (/club/.test(s)) return { field: 'club' };
    if (/position/.test(s)) return { field: 'position' };
    if (/jersey/.test(s)) return { field: 'jersey' };
    if (/short/.test(s)) return { field: 'shorts' };
    if (/sock/.test(s)) return { field: 'sock' };
    if (/registration|rego/.test(s)) return { field: 'registration' };
    if (/^program$|academy program/.test(s)) return { field: 'programCol' };

    var isEmail = /email/.test(s), isPhone = /mobile|phone|contact number/.test(s);
    var isName = !isEmail && !isPhone && /caregiver|parent|guardian|name/.test(s);
    if (!isEmail && !isPhone && !isName) return null;
    var slot;
    if (/secondary/.test(s)) slot = 1;
    else if (/primary/.test(s)) slot = 0;
    else if (isName) slot = state.nameSeen ? 1 : 0;
    else slot = state.slot;
    if (isName) state.nameSeen = true;
    state.slot = slot;
    return { field: 'contact', slot: slot, key: isEmail ? 'email' : isPhone ? 'phone' : 'name' };
  }

  function findHeaderRow(rows) {
    for (var i = 0; i < Math.min(rows.length, 12); i++) {
      if ((rows[i] || []).some(function (c) { return /first name/i.test(M.clean(c)); })) return i;
    }
    return -1;
  }

  // Unlabelled kit columns (the boys tab has sizes with no header).
  function inferUnlabelled(rows, start, col, taken) {
    var kit = 0, sock = 0, status = 0, n = 0;
    for (var r = start; r < Math.min(rows.length, start + 80); r++) {
      var v = M.clean((rows[r] || [])[col]);
      if (!v) continue;
      n++;
      if (/unisex|female cut/i.test(v)) kit++;
      else if (/^\d+ to \d+$/i.test(v)) sock++;
      else if (M.LOOKUPS.offerStatus.indexOf(v) !== -1) status++;
    }
    if (!n) return null;
    if (kit / n > 0.6) return { field: taken.jersey ? 'shorts' : 'jersey' };
    if (sock / n > 0.6) return { field: 'sock' };
    if (status / n > 0.6 && !taken.offerStatus) return { field: 'offerStatus' };
    return null;
  }

  function parseSheet(sheetName, rows, opts) {
    var rule = ruleFor(sheetName);
    var report = { sheet: sheetName, programId: rule && rule.programId || '', rows: 0, imported: 0, skipped: 0, warnings: [] };
    var players = [];
    var hdrIdx = findHeaderRow(rows);
    if (hdrIdx < 0) { report.warnings.push('No header row with "First Name" found - tab skipped'); return { players: players, report: report }; }
    if (!rule) report.warnings.push('Unrecognised tab name - players imported without a program');

    var hdr = rows[hdrIdx] || [];
    var state = { slot: 0, nameSeen: false };
    var map = [], taken = {};
    for (var c = 0; c < Math.min(hdr.length, MAX_COLS); c++) {
      var m = mapHeader(hdr[c], state);
      if (!m && !M.clean(hdr[c])) m = inferUnlabelled(rows, hdrIdx + 1, c, taken);
      // First mapping wins; later duplicates (e.g. a second "Notes") are appended to notes.
      if (m && m.field !== 'contact' && taken[m.field] && m.field !== 'notes') m = null;
      if (m) taken[m.field] = true;
      map[c] = m;
    }

    var section = '';
    for (var r = hdrIdx + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var rec = { contacts: [{ name: '', email: '', phone: '' }, { name: '', email: '', phone: '' }] };
      var extraNotes = [];
      for (var k = 0; k < map.length; k++) {
        var mm = map[k];
        if (!mm) continue;
        var v = row[k];
        if (mm.field === 'contact') {
          var cur = rec.contacts[mm.slot];
          if (mm.key === 'email') cur.email = cur.email || M.normEmail(v);
          else if (mm.key === 'phone') cur.phone = cur.phone || M.normPhone(v);
          else cur.name = cur.name || M.titleName(v);
        } else if (mm.field === 'notes') {
          if (M.clean(v)) extraNotes.push(M.clean(v));
        } else if (mm.field === 'dob') {
          rec.dob = M.normDate(v);
          if (!rec.dob && M.clean(v)) rec.rawDob = M.clean(v);
        } else if (mm.field === 'recordedAgeGroup') {
          rec.recordedAgeGroup = M.clean(v);
          rec.recordedAgeGroupSeason = mm.season;
        } else {
          rec[mm.field] = M.clean(v);
        }
      }
      var first = M.titleName(rec.firstName), last = M.titleName(rec.lastName);
      if (!first && !last) {
        // Section titles ("Leaving the program", "2026 Program Graduates") tag the rows below them.
        var title = M.clean(row[0]);
        if (title.length > 12 && !/^fqa\b/i.test(title) && row.slice(1, 12).every(function (x) { return !M.clean(x); })) section = title;
        continue;
      }
      // Repeated header rows inside a tab (Metro, Girls tabs restart the table per squad).
      if (/first name/i.test(first) || /last name/i.test(last)) continue;
      report.rows++;

      var programId = report.programId;
      var hub = rec.hub || '';
      if (rule && rule.programFromColumn) {
        programId = '';
        for (var g = 0; g < GIRLS_PROGRAMS.length; g++) {
          if (GIRLS_PROGRAMS[g].test.test(rec.programCol || '')) { programId = GIRLS_PROGRAMS[g].id; break; }
        }
        if (!programId) report.warnings.push(first + ' ' + last + ': unknown program "' + (rec.programCol || '') + '"');
      }
      if (rule && rule.hubFromProgram && rec.programCol) hub = rec.programCol;

      var ag = M.parseAgeGroup(rec.recordedAgeGroup);
      var prog = M.program(programId);
      var gender = ag.gender ||
        (/^(male|female)$/i.test(rec.typeCol || '') ? rec.typeCol.charAt(0).toUpperCase() + rec.typeCol.slice(1).toLowerCase() : '') ||
        (prog && prog.gender) || '';

      var rawResponse = rec.response || '';
      var fee = M.normFee(rec.fee);
      if (/^paid$/i.test(rawResponse) && !fee) fee = 'Paid';
      var response = M.normResponse(rawResponse);
      if (response && M.LOOKUPS.response.indexOf(response) === -1) {
        extraNotes.unshift('Response: ' + response);
        response = '';
      }
      var notes = extraNotes.join(' | ');
      var wl = notes.match(/waitlist number (\d+|one|two|three)/i);
      var rank = wl ? ({ one: 1, two: 2, three: 3 }[wl[1].toLowerCase()] || +wl[1]) : '';
      if (rec.rawDob) report.warnings.push(first + ' ' + last + ': unreadable DOB "' + rec.rawDob + '"');

      players.push(M.newPlayer({
        firstName: first, lastName: last, dob: rec.dob || '', gender: gender,
        programId: programId, hub: hub, club: rec.club || '', position: rec.position || '',
        recordedAgeGroup: rec.recordedAgeGroup || '', recordedAgeGroupSeason: rec.recordedAgeGroupSeason || null,
        offerStatus: rec.offerStatus || '', letterType: rec.letterType || '', response: response,
        priorStatus: rec.priorStatus || '', fee: fee, feeAdjustment: rec.feeAdjustment || '',
        registration: rec.registration || '', jersey: rec.jersey || '', shorts: rec.shorts || '', sock: rec.sock || '',
        waitlistRank: rank, notes: notes, contacts: rec.contacts, section: section,
        source: sheetName + ' r' + (r + 1),
        history: [{ at: (opts && opts.now) || new Date().toISOString(), by: (opts && opts.user) || 'Import', what: 'Imported from "' + sheetName + '"' }]
      }));
      report.imported++;
    }
    return { players: players, report: report };
  }

  // workbook: a SheetJS workbook. Returns { players, reports }.
  function importWorkbook(XLSX, wb, opts) {
    var all = [], reports = [];
    wb.SheetNames.forEach(function (name) {
      var ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) return;
      var range = XLSX.utils.decode_range(ws['!ref']);
      if (range.e.c > MAX_COLS - 1) range.e.c = MAX_COLS - 1;
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false, range: range });
      var res = parseSheet(name, rows, opts);
      all = all.concat(res.players);
      reports.push(res.report);
    });
    return { players: all, reports: reports };
  }

  function readFile(XLSX, arrayBuffer, opts) {
    var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, dense: true, cellStyles: false, cellFormula: false, cellHTML: false });
    return importWorkbook(XLSX, wb, opts);
  }

  // Merge imported records into existing ones: same person + same program updates in place.
  var MERGE_FIELDS = ['dob', 'gender', 'hub', 'club', 'position', 'recordedAgeGroup', 'recordedAgeGroupSeason', 'offerStatus',
    'letterType', 'response', 'priorStatus', 'fee', 'feeAdjustment', 'registration', 'jersey', 'shorts', 'sock', 'waitlistRank', 'notes',
    'section'];

  function merge(existing, incoming, opts) {
    var byKey = {};
    existing.forEach(function (p) { byKey[M.dupKey(p) + '|' + p.programId] = p; });
    var added = 0, updated = 0, unchanged = 0;
    var now = (opts && opts.now) || new Date().toISOString();
    incoming.forEach(function (inc) {
      var cur = byKey[M.dupKey(inc) + '|' + inc.programId];
      if (!cur) { existing.push(inc); added++; return; }
      var changes = [];
      MERGE_FIELDS.forEach(function (f) {
        if (inc[f] !== '' && inc[f] !== null && inc[f] !== undefined && inc[f] !== cur[f]) {
          changes.push(f + ': "' + (cur[f] || '') + '" -> "' + inc[f] + '"');
          cur[f] = inc[f];
        }
      });
      inc.contacts.forEach(function (c, i) {
        ['name', 'email', 'phone'].forEach(function (k) {
          if (c[k] && cur.contacts[i][k] !== c[k]) { changes.push('contact ' + (i + 1) + ' ' + k); cur.contacts[i][k] = c[k]; }
        });
      });
      if (changes.length) {
        cur.history.push({ at: now, by: (opts && opts.user) || 'Import', what: 'Import updated ' + changes.join('; ') });
        cur.updatedAt = now;
        updated++;
      } else unchanged++;
    });
    return { added: added, updated: updated, unchanged: unchanged };
  }

  var api = { mapHeader: mapHeader, parseSheet: parseSheet, importWorkbook: importWorkbook, readFile: readFile, merge: merge, ruleFor: ruleFor };
  root.PD = root.PD || {};
  root.PD.importer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
