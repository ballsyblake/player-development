/*
 * Exports: Excel (one tab per program, same shape every tab), CSV of the current view,
 * JSON backups.
 */
(function (root) {
  'use strict';

  var M = root.PD && root.PD.model ? root.PD.model : require('./model.js');

  var COLUMNS = [
    ['Program', function (p) { var g = M.program(p.programId); return g ? g.name : ''; }],
    ['Tier', function (p) { var g = M.program(p.programId); return g ? g.tier : ''; }],
    ['First Name', 'firstName'], ['Last Name', 'lastName'],
    ['Date of Birth', 'dob'],
    ['Age Group', function (p, s) { return M.ageGroupFor(p.dob, s) + (p.gender ? (p.gender === 'Male' ? ' Boys' : ' Girls') : ''); }],
    ['Type', function (p, s) { return M.typeFor(M.ageGroupFor(p.dob, s)); }],
    ['Gender', 'gender'], ['Hub', 'hub'], ['Club', 'club'], ['Position', 'position'],
    ['Offer Status', 'offerStatus'], ['Letter Type', 'letterType'], ['Offer Response', 'response'],
    ['Waitlist Rank', 'waitlistRank'], ['Prior Status', 'priorStatus'],
    ['Program Fee', 'fee'], ['Fee Adjustment', 'feeAdjustment'], ['Registration', 'registration'],
    ['Jersey Size', 'jersey'], ['Short Size', 'shorts'], ['Sock Size', 'sock'],
    ['Section', 'section'], ['Notes', 'notes'],
    ['Primary Caregiver', function (p) { return p.contacts[0].name; }],
    ['Primary Email', function (p) { return p.contacts[0].email; }],
    ['Primary Mobile', function (p) { return p.contacts[0].phone; }],
    ['Secondary Caregiver', function (p) { return p.contacts[1].name; }],
    ['Secondary Email', function (p) { return p.contacts[1].email; }],
    ['Secondary Mobile', function (p) { return p.contacts[1].phone; }],
    ['Last Updated', function (p) { return (p.updatedAt || '').slice(0, 10); }]
  ];

  function toRows(players, season) {
    var rows = [COLUMNS.map(function (c) { return c[0]; })];
    players.forEach(function (p) {
      rows.push(COLUMNS.map(function (c) {
        var v = typeof c[1] === 'function' ? c[1](p, season) : p[c[1]];
        return v === null || v === undefined ? '' : v;
      }));
    });
    return rows;
  }

  function sheetName(s) { return s.replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31); }

  function workbook(XLSX, players, season) {
    var wb = XLSX.utils.book_new();
    var add = function (name, list) {
      var ws = XLSX.utils.aoa_to_sheet(toRows(list, season));
      ws['!cols'] = COLUMNS.map(function (c) { return { wch: Math.max(10, c[0].length + 2) }; });
      ws['!autofilter'] = { ref: ws['!ref'] };
      XLSX.utils.book_append_sheet(wb, ws, sheetName(name));
    };
    add('All Players', players);
    M.PROGRAMS.forEach(function (g) {
      var list = players.filter(function (p) { return p.programId === g.id; });
      if (list.length) add(g.name, list);
    });
    var none = players.filter(function (p) { return !M.program(p.programId); });
    if (none.length) add('Unassigned', none);
    return wb;
  }

  function csv(players, season) {
    return toRows(players, season).map(function (r) {
      return r.map(function (v) {
        var s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  var api = { COLUMNS: COLUMNS, toRows: toRows, workbook: workbook, csv: csv };
  root.PD = root.PD || {};
  root.PD.exporter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
