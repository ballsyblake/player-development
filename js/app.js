/*
 * UI controller. One state object, re-rendered per view; events are delegated on #main and #drawer.
 */
(function () {
  'use strict';

  var M = PD.model, I = PD.importer, E = PD.exporter, S = PD.store;

  var state = { version: 1, players: [], settings: { season: 2027, user: '', squadTarget: 18 }, importedAt: null };
  var ui = {
    view: 'dashboard', f: defaultFilters(), sort: { key: 'name', dir: 1 }, selected: new Set(), limit: 100,
    drawer: null, pendingImport: null, undo: null, kitIncludeAwaiting: false, qualityLevel: 'all'
  };
  var cache = { rev: -1, dup: null, issues: null };
  var rev = 0;

  var STATUS_COLORS = { 'Accepted': 'good', 'Awaiting Response': 'warning', 'Please Send': 'serious', 'Declined': 'critical', 'Notice Sent': 'neutral', 'Hold': 'serious', '': 'empty' };
  var RESPONSE_ORDER = ['Accepted', 'Awaiting Response', 'Please Send', 'Declined', 'Notice Sent', ''];

  function defaultFilters() {
    return { q: '', programId: '', tier: '', hub: '', age: '', gender: '', offerStatus: '', letterType: '', response: '', fee: '', openOnly: false, issuesOnly: false };
  }

  // ---------- helpers ----------
  function $(sel, el) { return (el || document).querySelector(sel); }
  function h(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function season() { return +state.settings.season || new Date().getFullYear() + 1; }
  function byId(id) { for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i]; return null; }
  function progName(id) { var g = M.program(id); return g ? g.name : 'Unassigned'; }
  function ageOf(p) { return M.ageGroupFor(p.dob, season()); }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = iso.slice(0, 10).split('-');
    return d.length === 3 ? d[2] + '/' + d[1] + '/' + d[0] : iso;
  }
  function ago(iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
    return fmtDate(iso);
  }
  function pill(v) {
    var cls = STATUS_COLORS[v] || 'neutral';
    return '<span class="pill pill-' + cls + '">' + h(v || 'None') + '</span>';
  }
  function options(list, current, blankLabel) {
    var vals = list.slice();
    if (current && vals.indexOf(current) === -1) vals.push(current);
    return vals.map(function (v) {
      return '<option value="' + h(v) + '"' + (v === current ? ' selected' : '') + '>' + h(v || blankLabel || '-') + '</option>';
    }).join('');
  }
  function datalist(id, list) {
    return '<datalist id="' + id + '">' + list.filter(Boolean).map(function (v) { return '<option value="' + h(v) + '">'; }).join('') + '</datalist>';
  }
  function uniq(arr) { var s = {}; return arr.filter(function (v) { if (!v || s[v]) return false; s[v] = 1; return true; }).sort(); }
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  var toastTimer;
  function toast(msg, undoable) {
    var t = $('#toast');
    t.innerHTML = h(msg) + (undoable ? ' <button class="link-btn" data-action="undo">Undo</button>' : '');
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, undoable ? 7000 : 3500);
  }

  // ---------- derived data ----------
  function derived() {
    if (cache.rev === rev) return cache;
    cache.dup = M.buildDupIndex(state.players);
    cache.issues = {};
    var errors = 0;
    state.players.forEach(function (p) {
      var list = M.issues(p, season(), cache.dup);
      cache.issues[p.id] = list;
      if (list.some(function (i) { return i.level === 'error'; })) errors++;
    });
    cache.errors = errors;
    cache.rev = rev;
    return cache;
  }

  function matches(p, f, d) {
    if (f.programId && p.programId !== f.programId) return false;
    if (f.tier) { var g = M.program(p.programId); if (!g || g.tier !== f.tier) return false; }
    if (f.hub && p.hub !== f.hub) return false;
    if (f.age && ageOf(p) !== f.age) return false;
    if (f.gender && p.gender !== f.gender) return false;
    if (f.offerStatus && p.offerStatus !== f.offerStatus) return false;
    if (f.letterType && p.letterType !== f.letterType) return false;
    if (f.response && (f.response === '(none)' ? p.response : p.response !== f.response)) return false;
    if (f.fee && (f.fee === '(none)' ? p.fee : f.fee === '(outstanding)' ? !feeOutstanding(p) : p.fee !== f.fee)) return false;
    if (f.openOnly && !M.isOpen(p)) return false;
    if (f.issuesOnly && !d.issues[p.id].some(function (i) { return i.level !== 'info'; })) return false;
    if (f.q) {
      var hay = [M.fullName(p), p.club, p.hub, p.notes, p.offerStatus, p.section].concat(p.contacts.map(function (c) { return c.name + ' ' + c.email + ' ' + c.phone.replace(/\s/g, ''); })).join(' ').toLowerCase();
      var terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i].replace(/\s/g, '')) === -1) return false;
    }
    return true;
  }

  function feeOutstanding(p) { return p.fee === 'Unpaid' || p.fee === 'No Response'; }

  function filtered() {
    var d = derived();
    var list = state.players.filter(function (p) { return matches(p, ui.f, d); });
    var k = ui.sort.key, dir = ui.sort.dir;
    var val = {
      name: function (p) { return (p.lastName + ' ' + p.firstName).toLowerCase(); },
      age: function (p) { return ageOf(p) + (p.gender || ''); },
      dob: function (p) { return p.dob; },
      program: function (p) { return progName(p.programId) + ' ' + p.hub; },
      updated: function (p) { return p.updatedAt; }
    }[k] || function (p) { return (p[k] || '').toString().toLowerCase(); };
    list.sort(function (a, b) { var x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : 0; });
    return list;
  }

  // ---------- mutations ----------
  var LABELS = {
    offerStatus: 'Offer status', letterType: 'Letter', response: 'Response', fee: 'Fee', feeAdjustment: 'Fee adjustment',
    registration: 'Registration', programId: 'Program', hub: 'Hub', club: 'Club', firstName: 'First name', lastName: 'Last name',
    dob: 'DOB', gender: 'Gender', position: 'Position', jersey: 'Jersey', shorts: 'Shorts', sock: 'Socks',
    waitlistRank: 'Waitlist rank', priorStatus: 'Prior status', notes: 'Notes', section: 'Section'
  };

  function apply(ids, patch, label) {
    var now = new Date().toISOString(), by = state.settings.user || 'Staff';
    var snapshot = [];
    ids.forEach(function (id) {
      var p = byId(id);
      if (!p) return;
      snapshot.push(JSON.parse(JSON.stringify(p)));
      var changes = [];
      Object.keys(patch).forEach(function (f) {
        if (f === 'contacts') {
          patch.contacts.forEach(function (c, i) {
            ['name', 'email', 'phone'].forEach(function (k) {
              if ((p.contacts[i][k] || '') !== (c[k] || '')) { changes.push((i ? 'Secondary ' : 'Primary ') + k + ' updated'); p.contacts[i][k] = c[k]; }
            });
          });
          return;
        }
        var nv = patch[f], ov = p[f];
        if ((ov === null || ov === undefined ? '' : String(ov)) === String(nv === null || nv === undefined ? '' : nv)) return;
        var fmt = function (v) { return f === 'programId' ? progName(v) : (v || 'blank'); };
        changes.push(f === 'notes' ? 'Notes edited' : (LABELS[f] || f) + ': ' + fmt(ov) + ' -> ' + fmt(nv));
        p[f] = nv;
      });
      if (changes.length) {
        p.history.push({ at: now, by: by, what: changes.join('; ') });
        p.updatedAt = now;
      } else snapshot.pop();
    });
    if (!snapshot.length) return 0;
    ui.undo = { type: 'restore', players: snapshot, label: label };
    commit();
    if (label) toast(label.replace('{n}', snapshot.length), true);
    return snapshot.length;
  }

  function undo() {
    var u = ui.undo;
    if (!u) return;
    if (u.type === 'restore') {
      u.players.forEach(function (old) {
        var i = state.players.findIndex(function (p) { return p.id === old.id; });
        if (i >= 0) state.players[i] = old; else state.players.push(old);
      });
    } else if (u.type === 'replace') {
      state.players = u.players;
    } else if (u.type === 'remove-added') {
      var gone = new Set(u.ids);
      state.players = state.players.filter(function (p) { return !gone.has(p.id); });
    }
    ui.undo = null;
    commit();
    toast('Undone');
  }

  function commit() {
    rev++;
    S.save(state, function (ok) { if (!ok) storageNote(); });
    render();
  }

  function removePlayers(ids) {
    var gone = new Set(ids);
    var removed = state.players.filter(function (p) { return gone.has(p.id); });
    state.players = state.players.filter(function (p) { return !gone.has(p.id); });
    ui.undo = { type: 'restore', players: removed };
    ids.forEach(function (id) { ui.selected.delete(id); });
    commit();
    toast(removed.length + ' player' + (removed.length === 1 ? '' : 's') + ' deleted', true);
  }

  // ---------- chrome ----------
  var TITLES = { dashboard: 'Dashboard', players: 'Players', squads: 'Squads', kit: 'Kit orders', quality: 'Data quality', data: 'Import / export', settings: 'Settings' };

  function renderChrome() {
    var d = derived();
    $('#season-label').textContent = season() + ' season · ' + state.players.length + ' players';
    $('#view-title').textContent = ui.view === 'players' && ui.f.programId ? progName(ui.f.programId) : TITLES[ui.view];
    document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.view === ui.view && !(ui.view === 'players' && ui.f.programId)); });
    $('#issue-count').textContent = d.errors ? d.errors : '';
    var counts = {};
    state.players.forEach(function (p) { counts[p.programId] = (counts[p.programId] || 0) + 1; });
    var html = '';
    M.TIERS.forEach(function (tier) {
      html += '<div class="nav-tier">' + h(tier) + '</div>';
      M.PROGRAMS.filter(function (g) { return g.tier === tier; }).forEach(function (g) {
        html += '<a href="#/players" data-program="' + g.id + '" class="' + (ui.view === 'players' && ui.f.programId === g.id ? 'active' : '') + '">' +
          h(g.name) + '<span class="nav-count">' + (counts[g.id] || 0) + '</span></a>';
      });
    });
    $('#program-nav').innerHTML = html;
    if ($('#global-search') !== document.activeElement) $('#global-search').value = ui.f.q;
  }

  function storageNote() {
    $('#storage-note').innerHTML = S.persistent()
      ? 'Saved in this browser only. Export a backup regularly.'
      : '<strong>Storage unavailable.</strong> Changes are lost when you close this tab - export before leaving.';
  }

  // ---------- views ----------
  function render() {
    renderChrome();
    var main = $('#main');
    var fn = { dashboard: viewDashboard, players: viewPlayers, squads: viewSquads, kit: viewKit, quality: viewQuality, data: viewData, settings: viewSettings }[ui.view] || viewDashboard;
    var scroll = main.scrollTop;
    main.innerHTML = state.players.length || ui.view === 'data' || ui.view === 'settings' ? fn() : viewEmpty();
    main.scrollTop = scroll;
    if (ui.drawer) renderDrawer();
  }

  function viewEmpty() {
    return '<section class="empty">' +
      '<h2>No players yet</h2>' +
      '<p>Import the masterfile workbook to bring every program tab into one database, or explore with demo data first.</p>' +
      '<div class="empty-actions"><a class="btn primary" href="#/data">Import Excel masterfile</a>' +
      '<button class="btn" data-action="load-demo">Load demo data</button></div>' +
      '<p class="muted small">Data never leaves this device. Nothing is uploaded.</p></section>';
  }

  function stat(label, value, sub, link) {
    return '<a class="tile" href="#/players" data-filter=\'' + h(JSON.stringify(link || {})) + '\'>' +
      '<div class="tile-label">' + h(label) + '</div><div class="tile-value">' + h(value) + '</div>' +
      (sub ? '<div class="tile-sub">' + h(sub) + '</div>' : '') + '</a>';
  }

  function viewDashboard() {
    var d = derived(), P = state.players;
    var count = function (fn) { return P.filter(fn).length; };
    var accepted = count(function (p) { return p.response === 'Accepted'; });
    var offered = count(function (p) { return p.letterType === 'Letter of Offer' || p.response; });
    var open = count(function (p) { return p.response === 'Awaiting Response' || p.response === 'Please Send'; });
    var declined = count(function (p) { return p.response === 'Declined'; });
    var feesOut = count(feeOutstanding);
    var pct = offered ? Math.round(accepted / offered * 100) : 0;

    var html = '<section class="tiles">' +
      stat('Players', P.length, M.TIERS.map(function (t) { return count(function (p) { var g = M.program(p.programId); return g && g.tier === t; }) + ' ' + t.toLowerCase(); }).join(' · '), {}) +
      stat('Accepted', accepted, pct + '% of offers', { response: 'Accepted' }) +
      stat('Needs response', open, 'Awaiting or not yet sent', { openOnly: true }) +
      stat('Declined', declined, '', { response: 'Declined' }) +
      stat('Fees outstanding', feesOut, 'Unpaid or no response', { fee: '(outstanding)' }) +
      stat('Data issues', d.errors, 'Players with blocking errors', { issuesOnly: true }) +
      '</section>';

    // Response breakdown per program: stacked horizontal bars.
    var rows = M.PROGRAMS.map(function (g) {
      var list = P.filter(function (p) { return p.programId === g.id; });
      var by = {};
      list.forEach(function (p) { var r = RESPONSE_ORDER.indexOf(p.response) === -1 ? '' : p.response; by[r] = (by[r] || 0) + 1; });
      return { g: g, total: list.length, by: by };
    }).filter(function (r) { return r.total; });
    var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
    html += '<section class="card"><div class="card-head"><h2>Offer responses by program</h2>' +
      '<div class="legend">' + RESPONSE_ORDER.map(function (r) { return '<span><i class="sw sw-' + STATUS_COLORS[r] + '"></i>' + h(r || 'Other / none') + '</span>'; }).join('') + '</div></div>' +
      '<div class="bars">' + rows.map(function (r) {
        return '<div class="bar-row"><a class="bar-label" href="#/players" data-filter=\'' + h(JSON.stringify({ programId: r.g.id })) + '\'>' + h(r.g.name) + '</a>' +
          '<div class="bar-track"><div class="bar" style="width:' + (r.total / max * 100) + '%">' +
          RESPONSE_ORDER.filter(function (k) { return r.by[k]; }).map(function (k) {
            return '<a href="#/players" class="seg seg-' + STATUS_COLORS[k] + '" style="flex:' + r.by[k] + '" data-tip="' + h(r.g.name + ': ' + (k || 'Other / none') + ' - ' + r.by[k] + ' (' + Math.round(r.by[k] / r.total * 100) + '%)') + '" data-filter=\'' + h(JSON.stringify({ programId: r.g.id, response: k || '(none)' })) + '\'></a>';
          }).join('') + '</div></div><div class="bar-total">' + r.total + '</div></div>';
      }).join('') + '</div></section>';

    // Follow-up list and activity feed.
    var follow = P.filter(function (p) { return p.response === 'Awaiting Response' || p.response === 'Please Send'; })
      .sort(function (a, b) { return a.updatedAt < b.updatedAt ? -1 : 1; }).slice(0, 10);
    var feed = [];
    P.forEach(function (p) { p.history.forEach(function (e) { feed.push({ p: p, e: e }); }); });
    feed.sort(function (a, b) { return a.e.at < b.e.at ? 1 : -1; });
    feed = feed.filter(function (x) { return !/^Imported|^Created as demo/.test(x.e.what); }).slice(0, 10);

    html += '<div class="two-col"><section class="card"><div class="card-head"><h2>Longest waiting for a response</h2>' +
      '<a class="link" href="#/players" data-filter=\'{"openOnly":true}\'>View all ' + open + '</a></div>' +
      (follow.length ? '<ul class="list">' + follow.map(function (p) {
        return '<li><button class="link-btn" data-open="' + p.id + '">' + h(M.fullName(p)) + '</button> <span class="muted">' + h(progName(p.programId)) + ' · ' + h(ageOf(p)) + '</span>' +
          '<span class="right">' + pill(p.response) + ' <span class="muted small">' + ago(p.updatedAt) + '</span></span></li>';
      }).join('') + '</ul>' : '<p class="muted">Nobody is waiting on a response.</p>') + '</section>' +
      '<section class="card"><div class="card-head"><h2>Recent changes</h2></div>' +
      (feed.length ? '<ul class="list">' + feed.map(function (x) {
        return '<li><button class="link-btn" data-open="' + x.p.id + '">' + h(M.fullName(x.p)) + '</button> <span class="muted small">' + h(x.e.what) + '</span>' +
          '<span class="right muted small">' + h(x.e.by) + ' · ' + ago(x.e.at) + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted">Edits you make appear here.</p>') + '</section></div>';
    return html;
  }

  function filterSelect(key, label, values, blankLabel) {
    return '<label class="f"><span>' + h(label) + '</span><select data-f="' + key + '">' +
      '<option value="">' + h(blankLabel || 'All') + '</option>' +
      values.map(function (v) { var val = typeof v === 'object' ? v.v : v, lab = typeof v === 'object' ? v.l : v; return '<option value="' + h(val) + '"' + (ui.f[key] === val ? ' selected' : '') + '>' + h(lab) + '</option>'; }).join('') +
      '</select></label>';
  }

  function viewPlayers() {
    var list = filtered(), d = derived(), P = state.players;
    var scope = ui.f.programId ? P.filter(function (p) { return p.programId === ui.f.programId; }) : P;
    var progOpts = [];
    M.TIERS.forEach(function (t) { M.PROGRAMS.filter(function (g) { return g.tier === t; }).forEach(function (g) { progOpts.push({ v: g.id, l: t + ' - ' + g.name }); }); });
    var activeFilters = Object.keys(ui.f).filter(function (k) { return ui.f[k] && k !== 'q'; }).length + (ui.f.q ? 1 : 0);

    var html = '<section class="toolbar">' +
      '<div class="filters">' +
      filterSelect('programId', 'Program', progOpts) +
      filterSelect('hub', 'Hub', uniq(scope.map(function (p) { return p.hub; }))) +
      filterSelect('age', 'Age group', uniq(scope.map(ageOf))) +
      filterSelect('gender', 'Gender', ['Male', 'Female']) +
      filterSelect('offerStatus', 'Offer status', uniq(scope.map(function (p) { return p.offerStatus; }))) +
      filterSelect('letterType', 'Letter', uniq(scope.map(function (p) { return p.letterType; }))) +
      filterSelect('response', 'Response', M.LOOKUPS.response.concat([{ v: '(none)', l: 'None recorded' }])) +
      filterSelect('fee', 'Fee', M.LOOKUPS.fee.concat([{ v: '(outstanding)', l: 'Outstanding (unpaid / no response)' }, { v: '(none)', l: 'None recorded' }])) +
      '<label class="chk"><input type="checkbox" data-f="openOnly"' + (ui.f.openOnly ? ' checked' : '') + '> Needs response</label>' +
      '<label class="chk"><input type="checkbox" data-f="issuesOnly"' + (ui.f.issuesOnly ? ' checked' : '') + '> Has issues</label>' +
      (activeFilters ? '<button class="link-btn" data-action="clear-filters">Clear filters (' + activeFilters + ')</button>' : '') +
      '</div>' +
      '<div class="toolbar-row"><span class="muted"><strong>' + list.length + '</strong> of ' + P.length + ' players</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn" data-action="copy-emails">Copy emails</button>' +
      '<button class="btn" data-action="export-view-csv">Export CSV</button>' +
      '<button class="btn" data-action="export-view-xlsx">Export Excel</button></div></section>';

    if (ui.selected.size) {
      html += '<section class="bulkbar"><strong>' + ui.selected.size + ' selected</strong>' +
        bulkSelect('offerStatus', 'Set offer status', M.LOOKUPS.offerStatus) +
        bulkSelect('letterType', 'Set letter', M.LOOKUPS.letterType) +
        bulkSelect('response', 'Set response', M.LOOKUPS.response) +
        bulkSelect('fee', 'Set fee', M.LOOKUPS.fee) +
        '<select data-bulk="programId" aria-label="Move to program"><option value="">Move to program</option>' + M.PROGRAMS.map(function (g) { return '<option value="' + g.id + '">' + h(g.name) + '</option>'; }).join('') + '</select>' +
        '<button class="btn" data-action="copy-emails-selected">Copy emails</button>' +
        '<button class="btn danger" data-action="delete-selected">Delete</button>' +
        '<button class="link-btn" data-action="clear-selection">Clear selection</button></section>';
    }

    var sortTh = function (key, label, cls) {
      var on = ui.sort.key === key;
      return '<th class="' + (cls || '') + '"><button class="th-sort' + (on ? ' on' : '') + '" data-sort="' + key + '">' + h(label) + (on ? (ui.sort.dir > 0 ? ' &#9650;' : ' &#9660;') : '') + '</button></th>';
    };
    var shown = list.slice(0, ui.limit);
    var allChecked = shown.length && shown.every(function (p) { return ui.selected.has(p.id); });
    html += '<div class="table-wrap"><table class="grid"><thead><tr>' +
      '<th class="w-chk"><input type="checkbox" data-action="select-all" aria-label="Select all shown"' + (allChecked ? ' checked' : '') + '></th>' +
      sortTh('name', 'Player') + sortTh('age', 'Age') + sortTh('program', 'Program / hub') +
      sortTh('offerStatus', 'Offer status') + sortTh('letterType', 'Letter') + sortTh('response', 'Response') + sortTh('fee', 'Fee') +
      '<th>Primary contact</th>' + sortTh('updated', 'Updated') + '</tr></thead><tbody>';
    if (!shown.length) html += '<tr><td colspan="10" class="muted center">No players match these filters.</td></tr>';
    shown.forEach(function (p) {
      var iss = d.issues[p.id].filter(function (i) { return i.level !== 'info'; });
      var multi = d.issues[p.id].some(function (i) { return i.level === 'info'; });
      var c = p.contacts[0];
      html += '<tr class="' + (ui.selected.has(p.id) ? 'sel' : '') + '">' +
        '<td class="w-chk"><input type="checkbox" data-select="' + p.id + '"' + (ui.selected.has(p.id) ? ' checked' : '') + ' aria-label="Select ' + h(M.fullName(p)) + '"></td>' +
        '<td><button class="name-btn" data-open="' + p.id + '">' + h(p.lastName) + ', ' + h(p.firstName) + '</button>' +
        (iss.length ? ' <span class="flag" data-tip="' + h(iss.map(function (i) { return i.msg; }).join('\n')) + '">!</span>' : '') +
        (multi ? ' <span class="flag flag-info" data-tip="Also in another program">2x</span>' : '') +
        '<div class="sub">' + h([p.club, p.position === 'Goalkeeper' ? 'GK' : ''].filter(Boolean).join(' · ')) + '</div></td>' +
        '<td>' + h(ageOf(p)) + ' ' + (p.gender ? '<span class="muted">' + (p.gender === 'Male' ? 'Boys' : 'Girls') + '</span>' : '') + '<div class="sub">' + fmtDate(p.dob) + '</div></td>' +
        '<td>' + h(progName(p.programId)) + '<div class="sub">' + h(p.hub) + '</div></td>' +
        '<td>' + inlineSelect(p, 'offerStatus', M.LOOKUPS.offerStatus) + (p.waitlistRank ? '<div class="sub">Waitlist #' + h(p.waitlistRank) + '</div>' : '') + '</td>' +
        '<td>' + inlineSelect(p, 'letterType', M.LOOKUPS.letterType) + '</td>' +
        '<td>' + inlineSelect(p, 'response', M.LOOKUPS.response, 'resp resp-' + (STATUS_COLORS[p.response] || 'neutral')) + '</td>' +
        '<td>' + inlineSelect(p, 'fee', M.LOOKUPS.fee) + '</td>' +
        '<td>' + h(c.name) + '<div class="sub">' + (c.email ? '<a href="mailto:' + h(c.email) + '">' + h(c.email) + '</a>' : '') + (c.phone ? ' <a href="tel:' + h(c.phone.replace(/\s/g, '')) + '">' + h(c.phone) + '</a>' : '') + '</div></td>' +
        '<td class="muted small">' + ago(p.updatedAt) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    if (list.length > ui.limit) html += '<div class="more"><button class="btn" data-action="show-more">Show ' + Math.min(200, list.length - ui.limit) + ' more</button> <button class="link-btn" data-action="show-all">Show all ' + list.length + '</button></div>';
    return html;
  }

  function bulkSelect(field, label, list) {
    return '<select data-bulk="' + field + '" aria-label="' + h(label) + '"><option value="">' + h(label) + '</option>' +
      list.map(function (v) { return '<option value="' + h(v) + '">' + h(v) + '</option>'; }).join('') + '<option value="__clear">(clear)</option></select>';
  }

  function inlineSelect(p, field, list, cls) {
    var vals = [''].concat(list);
    return '<select class="inline ' + (cls || '') + '" data-id="' + p.id + '" data-field="' + field + '" aria-label="' + h(LABELS[field]) + '">' + options(vals, p[field] || '', '-') + '</select>';
  }

  function viewSquads() {
    var target = +state.settings.squadTarget || 0;
    var groups = {};
    state.players.forEach(function (p) {
      var key = p.programId + '|' + (p.hub || '') + '|' + ageOf(p) + '|' + (p.gender || '');
      var g = groups[key] = groups[key] || { programId: p.programId, hub: p.hub || '', age: ageOf(p), gender: p.gender || '', accepted: 0, open: 0, waitlist: 0, declined: 0, other: 0, total: 0 };
      g.total++;
      if (/waitlist/i.test(p.offerStatus)) g.waitlist++;
      else if (p.response === 'Accepted') g.accepted++;
      else if (p.response === 'Awaiting Response' || p.response === 'Please Send') g.open++;
      else if (p.response === 'Declined') g.declined++;
      else g.other++;
    });
    var order = M.PROGRAMS.map(function (g) { return g.id; });
    var rows = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
      return (order.indexOf(a.programId) - order.indexOf(b.programId)) || a.hub.localeCompare(b.hub) || a.age.localeCompare(b.age) || a.gender.localeCompare(b.gender);
    });
    var html = '<section class="card"><div class="card-head"><h2>Squad composition</h2><span class="muted small">Target squad size: ' + (target || 'not set') + ' (change in Settings). Waitlisted players are counted separately.</span></div>' +
      '<div class="table-wrap"><table class="grid compact"><thead><tr><th>Program</th><th>Hub</th><th>Age group</th><th class="num">Accepted</th><th class="num">Awaiting</th><th class="num">Waitlist</th><th class="num">Declined</th><th class="num">Other</th><th class="num">Total</th><th class="w-fill">Fill vs target</th></tr></thead><tbody>';
    var last = '';
    rows.forEach(function (r) {
      var fill = target ? Math.min(100, Math.round(r.accepted / target * 100)) : 0;
      var over = target && r.accepted > target;
      var f = { programId: r.programId, age: r.age, gender: r.gender, hub: r.hub };
      html += '<tr class="' + (last !== r.programId ? 'group-start' : '') + '"><td>' + (last !== r.programId ? '<strong>' + h(progName(r.programId)) + '</strong>' : '') + '</td>' +
        '<td>' + h(r.hub) + '</td><td><a href="#/players" data-filter=\'' + h(JSON.stringify(f)) + '\'>' + h(r.age || '?') + ' ' + h(r.gender === 'Male' ? 'Boys' : r.gender === 'Female' ? 'Girls' : '') + '</a></td>' +
        '<td class="num">' + r.accepted + '</td><td class="num">' + (r.open || '') + '</td><td class="num">' + (r.waitlist || '') + '</td><td class="num">' + (r.declined || '') + '</td><td class="num">' + (r.other || '') + '</td><td class="num"><strong>' + r.total + '</strong></td>' +
        '<td>' + (target ? '<div class="meter' + (over ? ' over' : '') + '" data-tip="' + r.accepted + ' accepted of ' + target + ' target' + (over ? ' (over target)' : '') + '"><span style="width:' + fill + '%"></span></div>' : '') + '</td></tr>';
      last = r.programId;
    });
    return html + '</tbody></table></div></section>';
  }

  function viewKit() {
    var list = state.players.filter(function (p) { return p.response === 'Accepted' || (ui.kitIncludeAwaiting && M.isOpen(p) && p.response); });
    var parts = [['jersey', 'Jersey'], ['shorts', 'Shorts'], ['sock', 'Socks']];
    var html = '<section class="toolbar"><div class="toolbar-row"><label class="chk"><input type="checkbox" data-action="kit-awaiting"' + (ui.kitIncludeAwaiting ? ' checked' : '') + '> Include players still awaiting a response</label>' +
      '<span class="spacer"></span><span class="muted">' + list.length + ' players</span><button class="btn" data-action="export-kit">Export kit order</button></div></section>';
    var missing = list.filter(function (p) { return !p.jersey || !p.shorts || !p.sock; });
    html += '<div class="kit-grid">';
    parts.forEach(function (pt) {
      var by = {};
      list.forEach(function (p) { var v = p[pt[0]] || 'Not provided'; by[v] = (by[v] || 0) + 1; });
      var keys = Object.keys(by).sort(function (a, b) { return a === 'Not provided' ? 1 : b === 'Not provided' ? -1 : by[b] - by[a]; });
      html += '<section class="card"><div class="card-head"><h2>' + pt[1] + '</h2></div><table class="grid compact"><tbody>' +
        keys.map(function (k) { return '<tr><td class="' + (k === 'Not provided' ? 'muted' : '') + '">' + h(k) + '</td><td class="num"><strong>' + by[k] + '</strong></td></tr>'; }).join('') +
        '</tbody></table></section>';
    });
    html += '</div><section class="card"><div class="card-head"><h2>Missing sizes (' + missing.length + ')</h2><span class="muted small">Copy these emails to request sizes.</span>' +
      (missing.length ? '<button class="btn" data-action="copy-missing-kit">Copy emails</button>' : '') + '</div>' +
      (missing.length ? '<ul class="list cols">' + missing.slice(0, 60).map(function (p) { return '<li><button class="link-btn" data-open="' + p.id + '">' + h(M.fullName(p)) + '</button> <span class="muted small">' + h(progName(p.programId)) + '</span></li>'; }).join('') + '</ul>' + (missing.length > 60 ? '<p class="muted small">+' + (missing.length - 60) + ' more</p>' : '') : '<p class="muted">Every player has sizes recorded.</p>') + '</section>';
    return html;
  }

  function viewQuality() {
    var d = derived(), byMsg = {}, rows = [];
    state.players.forEach(function (p) {
      d.issues[p.id].forEach(function (i) {
        if (ui.qualityLevel !== 'all' && i.level !== ui.qualityLevel) return;
        var k = i.msg.replace(/:.*$/, '').replace(/^Recorded .*/, 'Age group does not match DOB').replace(/^Appears in .*/, 'Player in more than one program');
        byMsg[k] = (byMsg[k] || 0) + 1;
        rows.push({ p: p, i: i, k: k });
      });
    });
    var levelBtn = function (l, label) { return '<button class="seg-btn' + (ui.qualityLevel === l ? ' on' : '') + '" data-quality="' + l + '">' + label + '</button>'; };
    var html = '<section class="toolbar"><div class="toolbar-row"><div class="seg-group">' + levelBtn('all', 'All') + levelBtn('error', 'Errors') + levelBtn('warn', 'Warnings') + levelBtn('info', 'Info') + '</div>' +
      '<span class="spacer"></span><span class="muted">' + rows.length + ' findings</span></div></section>';
    html += '<section class="tiles">' + Object.keys(byMsg).sort(function (a, b) { return byMsg[b] - byMsg[a]; }).map(function (k) {
      return '<div class="tile static"><div class="tile-label">' + h(k) + '</div><div class="tile-value">' + byMsg[k] + '</div></div>';
    }).join('') + '</section>';
    html += '<div class="table-wrap"><table class="grid compact"><thead><tr><th>Level</th><th>Player</th><th>Program</th><th>Issue</th></tr></thead><tbody>' +
      rows.slice(0, 400).map(function (r) {
        return '<tr><td><span class="lvl lvl-' + r.i.level + '">' + ({ error: 'Error', warn: 'Warning', info: 'Info' })[r.i.level] + '</span></td>' +
          '<td><button class="name-btn" data-open="' + r.p.id + '">' + h(M.fullName(r.p)) + '</button></td><td>' + h(progName(r.p.programId)) + '</td><td>' + h(r.i.msg) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (rows.length > 400 ? '<p class="muted small">Showing first 400.</p>' : '');
    return html;
  }

  function viewData() {
    var html = '<div class="two-col">';
    html += '<section class="card"><div class="card-head"><h2>Import Excel masterfile</h2></div>' +
      '<p>Drop the masterfile workbook (.xlsx). Every tab is read, headers are matched automatically, repeated header rows and blank placeholder rows are skipped, phone numbers and dates are cleaned.</p>' +
      '<label class="drop" id="drop"><input type="file" id="import-file" accept=".xlsx,.xls,.xlsm" hidden><strong>Choose a file</strong> or drag it here<span class="muted small">Processed in your browser; nothing is uploaded.</span></label>' +
      '<fieldset class="radios"><legend>When players already exist</legend>' +
      '<label><input type="radio" name="mode" value="merge"' + (state.players.length ? ' checked' : '') + '> Merge: update matching players (same name, DOB and program), add new ones</label>' +
      '<label><input type="radio" name="mode" value="replace"' + (state.players.length ? '' : ' checked') + '> Replace all data with this file</label></fieldset>';
    if (ui.pendingImport) {
      var pi = ui.pendingImport;
      html += '<div class="preview"><h3>Preview: ' + h(pi.fileName) + '</h3><table class="grid compact"><thead><tr><th>Tab</th><th>Program</th><th class="num">Players</th><th>Notes</th></tr></thead><tbody>' +
        pi.reports.map(function (r) {
          return '<tr><td>' + h(r.sheet) + '</td><td>' + h(r.programId ? progName(r.programId) : (r.sheet.match(/girls/i) ? 'By Program column' : '-')) + '</td><td class="num">' + r.imported + '</td><td class="small">' +
            (r.warnings.length ? '<details><summary>' + r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') + '</summary>' + r.warnings.map(h).join('<br>') + '</details>' : '<span class="muted">OK</span>') + '</td></tr>';
        }).join('') + '</tbody></table><p><strong>' + pi.players.length + '</strong> players found.</p>' +
        '<div class="row-actions"><button class="btn primary" data-action="confirm-import">Import ' + pi.players.length + ' players</button><button class="btn" data-action="cancel-import">Cancel</button></div></div>';
    }
    html += '</section>';
    html += '<section class="card"><div class="card-head"><h2>Export</h2></div>' +
      '<div class="stack"><button class="btn" data-action="export-xlsx">Excel workbook: one tab per program</button>' +
      '<button class="btn" data-action="export-csv">CSV: all players</button>' +
      '<button class="btn" data-action="backup">Backup (JSON, includes change history)</button>' +
      '<label class="btn">Restore backup<input type="file" id="restore-file" accept=".json" hidden></label></div>' +
      (state.importedAt ? '<p class="muted small">Last import: ' + fmtDate(state.importedAt) + '</p>' : '') +
      '<h3>Other</h3><div class="stack"><button class="btn" data-action="load-demo">Load demo data (fictional players)</button>' +
      '<button class="btn danger" data-action="clear-all">Delete all data on this device</button></div></section></div>';
    return html;
  }

  function viewSettings() {
    var s = state.settings;
    return '<section class="card narrow"><form id="settings-form" class="form">' +
      '<label>Season<input type="number" name="season" min="2020" max="2100" value="' + h(s.season) + '"><span class="hint">Age groups are calculated as season year minus birth year (born ' + (season() - 9) + ' = U09).</span></label>' +
      '<label>Your name<input name="user" value="' + h(s.user) + '" placeholder="Shown in change history"></label>' +
      '<label>Target squad size<input type="number" name="squadTarget" min="0" max="60" value="' + h(s.squadTarget) + '"><span class="hint">Used for the fill meters on the Squads page.</span></label>' +
      '<div class="row-actions"><button class="btn primary" type="submit">Save settings</button></div></form></section>';
  }

  // ---------- drawer ----------
  function field(label, name, value, opts) {
    opts = opts || {};
    var id = 'f-' + name.replace(/\W/g, '-');
    var input;
    if (opts.select) input = '<select id="' + id + '" name="' + name + '">' + options(opts.select, value || '', opts.blank || '-') + '</select>';
    else if (opts.textarea) input = '<textarea id="' + id + '" name="' + name + '" rows="3">' + h(value) + '</textarea>';
    else input = '<input id="' + id + '" name="' + name + '" type="' + (opts.type || 'text') + '" value="' + h(value) + '"' + (opts.list ? ' list="' + opts.list + '"' : '') + (opts.required ? ' required' : '') + '>';
    return '<label class="' + (opts.wide ? 'wide' : '') + '" for="' + id + '"><span>' + h(label) + '</span>' + input + (opts.after || '') + '</label>';
  }

  function renderDrawer() {
    var dr = $('#drawer');
    var isNew = ui.drawer === 'new';
    var p = isNew ? M.newPlayer({ programId: ui.f.programId || '' }) : byId(ui.drawer);
    if (!p) { closeDrawer(); return; }
    var d = derived();
    var iss = isNew ? [] : d.issues[p.id];
    var others = isNew ? [] : (d.dup[M.dupKey(p)] || []).filter(function (id) { return id !== p.id; }).map(byId).filter(Boolean);
    var progSel = [''].concat(M.PROGRAMS.map(function (g) { return g.id; }));
    var c = p.contacts;
    var contactLinks = function (ct) {
      return (ct.email ? '<a class="mini" href="mailto:' + h(ct.email) + '">Email</a>' : '') + (ct.phone ? '<a class="mini" href="tel:' + h(ct.phone.replace(/\s/g, '')) + '">Call</a>' : '');
    };
    var html = '<form id="player-form" class="drawer-inner">' +
      '<header class="drawer-head"><div><h2>' + (isNew ? 'New player' : h(M.fullName(p))) + '</h2>' +
      (isNew ? '' : '<div class="muted small">' + h(progName(p.programId)) + ' · ' + h(ageOf(p)) + ' ' + h(p.gender === 'Male' ? 'Boys' : p.gender === 'Female' ? 'Girls' : '') + (p.source ? ' · from ' + h(p.source) : '') + '</div>') +
      '</div><button type="button" class="icon-btn" data-action="close-drawer" aria-label="Close">&times;</button></header>' +
      '<div class="drawer-body">' +
      (iss.length ? '<ul class="issues">' + iss.map(function (i) { return '<li class="lvl-' + i.level + '">' + h(i.msg) + '</li>'; }).join('') + '</ul>' : '') +
      (others.length ? '<p class="small">Also in: ' + others.map(function (o) { return '<button type="button" class="link-btn" data-open="' + o.id + '">' + h(progName(o.programId)) + '</button>'; }).join(', ') + '</p>' : '') +
      '<fieldset><legend>Player</legend><div class="form-grid">' +
      field('First name', 'firstName', p.firstName, { required: true }) + field('Last name', 'lastName', p.lastName, { required: true }) +
      field('Date of birth', 'dob', p.dob, { type: 'date', after: '<span class="hint" id="age-hint">' + (p.dob ? h(ageOf(p)) + ' in ' + season() : '') + '</span>' }) +
      field('Gender', 'gender', p.gender, { select: M.LOOKUPS.gender }) +
      field('Program', 'programId', p.programId, { select: progSel }).replace(/<option value="([^"]*)"( selected)?>[^<]*<\/option>/g, function (_, v, s) { return '<option value="' + v + '"' + (s || '') + '>' + h(v ? progName(v) : 'Unassigned') + '</option>'; }) +
      field('Hub', 'hub', p.hub, { list: 'dl-hub' }) + field('Club', 'club', p.club, { list: 'dl-club' }) +
      field('Position', 'position', p.position, { select: M.LOOKUPS.position }) +
      '</div></fieldset>' +
      '<fieldset><legend>Offer</legend><div class="form-grid">' +
      field('Offer status', 'offerStatus', p.offerStatus, { list: 'dl-offer' }) + field('Letter type', 'letterType', p.letterType, { list: 'dl-letter' }) +
      field('Response', 'response', p.response, { select: [''].concat(M.LOOKUPS.response) }) + field('Waitlist rank', 'waitlistRank', p.waitlistRank, { type: 'number' }) +
      field('Prior season status', 'priorStatus', p.priorStatus) + field('Section', 'section', p.section) +
      '</div></fieldset>' +
      '<fieldset><legend>Fees and registration</legend><div class="form-grid">' +
      field('Program fee', 'fee', p.fee, { select: [''].concat(M.LOOKUPS.fee) }) + field('Fee adjustment', 'feeAdjustment', p.feeAdjustment, { list: 'dl-feeadj' }) +
      field('Registration', 'registration', p.registration, { select: M.LOOKUPS.registration }) +
      '</div></fieldset>' +
      '<fieldset><legend>Kit</legend><div class="form-grid three">' +
      field('Jersey', 'jersey', p.jersey, { select: M.LOOKUPS.jersey }) + field('Shorts', 'shorts', p.shorts, { select: M.LOOKUPS.jersey }) + field('Socks', 'sock', p.sock, { select: M.LOOKUPS.sock }) +
      '</div></fieldset>' +
      [0, 1].map(function (i) {
        return '<fieldset><legend>' + (i ? 'Secondary' : 'Primary') + ' parent / caregiver ' + contactLinks(c[i]) + '</legend><div class="form-grid three">' +
          field('Name', 'c' + i + 'name', c[i].name) + field('Email', 'c' + i + 'email', c[i].email, { type: 'email' }) + field('Mobile', 'c' + i + 'phone', c[i].phone, { type: 'tel' }) + '</div></fieldset>';
      }).join('') +
      '<fieldset><legend>Notes</legend>' + field('', 'notes', p.notes, { textarea: true, wide: true }) + '</fieldset>' +
      (isNew ? '' : '<fieldset><legend>History</legend><ol class="history">' + p.history.slice().reverse().map(function (e) {
        return '<li><span class="muted small">' + fmtDate(e.at) + ' ' + e.at.slice(11, 16) + ' · ' + h(e.by) + '</span><div>' + h(e.what) + '</div></li>';
      }).join('') + '</ol></fieldset>') +
      '</div><footer class="drawer-foot">' +
      (isNew ? '' : '<button type="button" class="btn danger" data-action="delete-player">Delete</button>') +
      '<span class="spacer"></span><button type="button" class="btn" data-action="close-drawer">Cancel</button><button type="submit" class="btn primary">' + (isNew ? 'Add player' : 'Save changes') + '</button></footer>' +
      datalist('dl-hub', uniq(state.players.map(function (x) { return x.hub; }))) + datalist('dl-club', uniq(state.players.map(function (x) { return x.club; }))) +
      datalist('dl-offer', uniq(M.LOOKUPS.offerStatus.concat(state.players.map(function (x) { return x.offerStatus; })))) +
      datalist('dl-letter', uniq(M.LOOKUPS.letterType.concat(state.players.map(function (x) { return x.letterType; })))) +
      datalist('dl-feeadj', uniq(M.LOOKUPS.feeAdjustment.concat(state.players.map(function (x) { return x.feeAdjustment; })))) +
      '</form>';
    var scroll = $('.drawer-body', dr) ? $('.drawer-body', dr).scrollTop : 0;
    var sameRecord = dr.dataset.for === String(ui.drawer);
    if (sameRecord && dr.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return; // don't clobber typing
    dr.innerHTML = html;
    dr.dataset.for = ui.drawer;
    if (sameRecord) $('.drawer-body', dr).scrollTop = scroll;
    dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false');
    $('#drawer-backdrop').hidden = false;
  }

  function openDrawer(id) {
    ui.drawer = id;
    $('#drawer').dataset.for = '';
    renderDrawer();
    var first = $('#drawer input');
    if (first && id === 'new') first.focus();
  }
  function closeDrawer() {
    ui.drawer = null;
    var dr = $('#drawer');
    dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); dr.dataset.for = '';
    $('#drawer-backdrop').hidden = true;
  }

  function savePlayerForm(form) {
    var fd = new FormData(form), v = function (k) { return M.clean(fd.get(k)); };
    var patch = {
      firstName: M.titleName(v('firstName')), lastName: M.titleName(v('lastName')), dob: v('dob'), gender: v('gender'),
      programId: v('programId'), hub: v('hub'), club: v('club'), position: v('position'),
      offerStatus: v('offerStatus'), letterType: v('letterType'), response: v('response'), waitlistRank: v('waitlistRank'),
      priorStatus: v('priorStatus'), section: v('section'), fee: v('fee'), feeAdjustment: v('feeAdjustment'), registration: v('registration'),
      jersey: v('jersey'), shorts: v('shorts'), sock: v('sock'), notes: String(fd.get('notes') || '').trim(),
      contacts: [0, 1].map(function (i) { return { name: M.titleName(v('c' + i + 'name')), email: M.normEmail(v('c' + i + 'email')), phone: M.normPhone(v('c' + i + 'phone')) }; })
    };
    if (ui.drawer === 'new') {
      var p = M.newPlayer(patch);
      p.source = 'Added manually';
      p.history = [{ at: p.createdAt, by: state.settings.user || 'Staff', what: 'Player added' }];
      state.players.push(p);
      ui.undo = { type: 'remove-added', ids: [p.id] };
      ui.drawer = p.id;
      $('#drawer').dataset.for = '';
      commit();
      toast(M.fullName(p) + ' added', true);
    } else {
      var n = apply([ui.drawer], patch, 'Saved');
      if (!n) toast('No changes');
      $('#drawer').dataset.for = '';
      renderDrawer();
    }
  }

  // ---------- import / export actions ----------
  function readImport(file) {
    if (!window.XLSX) { toast('Excel library failed to load - check your internet connection'); return; }
    toast('Reading ' + file.name + '...');
    var reader = new FileReader();
    reader.onload = function () {
      setTimeout(function () {
        try {
          var res = I.readFile(XLSX, new Uint8Array(reader.result), { user: state.settings.user || 'Import' });
          ui.pendingImport = { fileName: file.name, players: res.players, reports: res.reports };
          render();
          toast(res.players.length + ' players found - review and confirm');
        } catch (e) {
          console.error(e);
          toast('Could not read that file: ' + e.message);
        }
      }, 30);
    };
    reader.readAsArrayBuffer(file);
  }

  function confirmImport() {
    var pi = ui.pendingImport;
    if (!pi) return;
    var modeEl = document.querySelector('input[name=mode]:checked');
    var mode = modeEl ? modeEl.value : 'merge';
    var before = state.players.map(function (p) { return JSON.parse(JSON.stringify(p)); });
    var msg;
    if (mode === 'replace' || !state.players.length) {
      state.players = pi.players;
      msg = pi.players.length + ' players imported';
    } else {
      var r = I.merge(state.players, pi.players, { user: state.settings.user || 'Import' });
      msg = r.added + ' added, ' + r.updated + ' updated, ' + r.unchanged + ' unchanged';
    }
    state.importedAt = new Date().toISOString();
    ui.undo = { type: 'replace', players: before };
    ui.pendingImport = null;
    ui.selected.clear();
    commit();
    toast(msg, true);
  }

  function exportXlsx(players, name) {
    if (!window.XLSX) { toast('Excel library failed to load'); return; }
    XLSX.writeFile(E.workbook(XLSX, players, season()), name);
  }

  function copyEmails(players) {
    var emails = uniq([].concat.apply([], players.map(function (p) { return p.contacts.map(function (c) { return c.email; }); })).filter(M.isValidEmail));
    if (!emails.length) { toast('No email addresses'); return; }
    var text = emails.join('; ');
    var done = function () { toast(emails.length + ' emails copied - paste into BCC'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  function restore(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.players)) throw new Error('Not a backup file');
        if (!confirm('Replace current data (' + state.players.length + ' players) with backup (' + data.players.length + ' players)?')) return;
        ui.undo = { type: 'replace', players: state.players };
        state = { version: 1, players: data.players, settings: Object.assign({}, state.settings, data.settings || {}), importedAt: data.importedAt || null };
        commit();
        toast('Backup restored', true);
      } catch (e) { toast('Restore failed: ' + e.message); }
    };
    reader.readAsText(file);
  }

  // ---------- events ----------
  function applyFilterLink(el) {
    var f = {};
    try { f = JSON.parse(el.getAttribute('data-filter') || '{}'); } catch (e) { /* ignore */ }
    ui.f = Object.assign(defaultFilters(), f);
    ui.limit = 100; ui.selected.clear();
    go('players');
  }

  function go(view) {
    if (location.hash !== '#/' + view) location.hash = '#/' + view;
    else { ui.view = view; render(); }
    document.body.classList.remove('nav-open');
  }

  function onClick(e) {
    var t = e.target.closest('[data-action],[data-open],[data-sort],[data-filter],[data-program],[data-quality]');
    if (!t) return;
    if (t.hasAttribute('data-filter')) { e.preventDefault(); applyFilterLink(t); return; }
    if (t.hasAttribute('data-program')) { e.preventDefault(); ui.f = Object.assign(defaultFilters(), { programId: t.dataset.program }); ui.selected.clear(); ui.limit = 100; go('players'); return; }
    if (t.hasAttribute('data-open')) { openDrawer(t.dataset.open); return; }
    if (t.hasAttribute('data-sort')) { var k = t.dataset.sort; ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : 1 }; render(); return; }
    if (t.hasAttribute('data-quality')) { ui.qualityLevel = t.dataset.quality; render(); return; }
    var a = t.dataset.action;
    var list;
    switch (a) {
      case 'undo': undo(); break;
      case 'clear-filters': ui.f = defaultFilters(); ui.limit = 100; render(); break;
      case 'show-more': ui.limit += 200; render(); break;
      case 'show-all': ui.limit = 1e9; render(); break;
      case 'clear-selection': ui.selected.clear(); render(); break;
      case 'copy-emails': copyEmails(filtered()); break;
      case 'copy-emails-selected': copyEmails(state.players.filter(function (p) { return ui.selected.has(p.id); })); break;
      case 'copy-missing-kit': copyEmails(state.players.filter(function (p) { return (p.response === 'Accepted' || (ui.kitIncludeAwaiting && M.isOpen(p) && p.response)) && (!p.jersey || !p.shorts || !p.sock); })); break;
      case 'delete-selected':
        if (confirm('Delete ' + ui.selected.size + ' selected players? You can undo straight after.')) removePlayers(Array.from(ui.selected));
        break;
      case 'delete-player':
        if (confirm('Delete ' + M.fullName(byId(ui.drawer)) + '?')) { var id = ui.drawer; closeDrawer(); removePlayers([id]); }
        break;
      case 'close-drawer': closeDrawer(); break;
      case 'export-view-csv': download('players-' + stamp() + '.csv', '﻿' + E.csv(filtered(), season()), 'text/csv'); break;
      case 'export-view-xlsx': exportXlsx(filtered(), 'players-' + stamp() + '.xlsx'); break;
      case 'export-xlsx': exportXlsx(state.players, 'player-database-' + stamp() + '.xlsx'); break;
      case 'export-csv': download('player-database-' + stamp() + '.csv', '﻿' + E.csv(state.players, season()), 'text/csv'); break;
      case 'export-kit':
        list = state.players.filter(function (p) { return p.response === 'Accepted' || (ui.kitIncludeAwaiting && M.isOpen(p) && p.response); });
        exportXlsx(list, 'kit-order-' + stamp() + '.xlsx'); break;
      case 'backup': download('player-database-backup-' + stamp() + '.json', JSON.stringify(state), 'application/json'); break;
      case 'confirm-import': confirmImport(); break;
      case 'cancel-import': ui.pendingImport = null; render(); break;
      case 'load-demo':
        if (state.players.length && !confirm('Replace current data with demo data?')) break;
        ui.undo = { type: 'replace', players: state.players };
        state.players = PD.demo.generate(season(), 420);
        commit(); toast('Demo data loaded (fictional players)', true); go('dashboard'); break;
      case 'clear-all':
        if (confirm('Delete all ' + state.players.length + ' players from this device? Export a backup first if unsure.')) {
          ui.undo = { type: 'replace', players: state.players };
          state.players = []; ui.selected.clear(); commit(); toast('All data deleted', true);
        }
        break;
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t.dataset.f) {
      ui.f[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
      if (t.dataset.f === 'programId') ui.f.hub = '';
      ui.limit = 100; render(); return;
    }
    if (t.dataset.field && t.dataset.id) {
      var p = byId(t.dataset.id);
      apply([t.dataset.id], (function () { var o = {}; o[t.dataset.field] = t.value; return o; })(), M.fullName(p) + ': ' + LABELS[t.dataset.field] + ' set to ' + (t.value || 'blank'));
      return;
    }
    if (t.dataset.bulk) {
      var val = t.value === '__clear' ? '' : t.value, f = t.dataset.bulk;
      if (!t.value) return;
      var label = f === 'programId' ? 'Moved {n} players to ' + progName(val) : LABELS[f] + ' set to "' + (val || 'blank') + '" for {n} players';
      apply(Array.from(ui.selected), (function () { var o = {}; o[f] = val; return o; })(), label);
      return;
    }
    if (t.dataset.select) { if (t.checked) ui.selected.add(t.dataset.select); else ui.selected.delete(t.dataset.select); render(); return; }
    if (t.dataset.action === 'select-all') {
      filtered().slice(0, ui.limit).forEach(function (p) { if (t.checked) ui.selected.add(p.id); else ui.selected.delete(p.id); });
      render(); return;
    }
    if (t.dataset.action === 'kit-awaiting') { ui.kitIncludeAwaiting = t.checked; render(); return; }
    if (t.id === 'import-file' && t.files[0]) readImport(t.files[0]);
    if (t.id === 'restore-file' && t.files[0]) restore(t.files[0]);
    if (t.name === 'dob' && t.form && t.form.id === 'player-form') {
      var hint = $('#age-hint'); if (hint) hint.textContent = t.value ? M.ageGroupFor(t.value, season()) + ' in ' + season() : '';
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (e.target.id === 'player-form') savePlayerForm(e.target);
    if (e.target.id === 'settings-form') {
      var fd = new FormData(e.target);
      state.settings = { season: +fd.get('season') || season(), user: M.clean(fd.get('user')), squadTarget: +fd.get('squadTarget') || 0 };
      commit(); toast('Settings saved');
    }
  }

  function tooltip() {
    var tip = $('#tooltip');
    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest('[data-tip]');
      if (!t) { tip.hidden = true; return; }
      tip.textContent = t.getAttribute('data-tip');
      tip.hidden = false;
    });
    document.addEventListener('mousemove', function (e) {
      if (tip.hidden) return;
      var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + 'px'; tip.style.top = (e.clientY + 16) + 'px';
    });
  }

  function route() {
    var v = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard';
    ui.view = TITLES[v] ? v : 'dashboard';
    render();
    $('#main').focus({ preventScroll: true });
  }

  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    $('#drawer-backdrop').addEventListener('click', closeDrawer);
    $('#menu-btn').addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    $('#add-player').addEventListener('click', function () { openDrawer('new'); });
    var searchTimer;
    $('#global-search').addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      var q = e.target.value;
      searchTimer = setTimeout(function () { ui.f.q = q; ui.limit = 100; if (ui.view !== 'players') go('players'); else render(); }, 150);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ui.drawer) closeDrawer();
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#global-search').focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && ui.undo) { e.preventDefault(); undo(); }
    });
    document.addEventListener('dragover', function (e) { if (ui.view === 'data') { e.preventDefault(); var d = $('#drop'); if (d) d.classList.add('over'); } });
    document.addEventListener('dragleave', function () { var d = $('#drop'); if (d) d.classList.remove('over'); });
    document.addEventListener('drop', function (e) {
      if (ui.view !== 'data') return;
      e.preventDefault();
      var f = e.dataTransfer.files[0];
      if (f) readImport(f);
    });
    window.addEventListener('hashchange', route);
    tooltip();
    S.load().then(function (saved) {
      if (saved && Array.isArray(saved.players)) {
        state = saved;
        state.settings = Object.assign({ season: 2027, user: '', squadTarget: 18 }, saved.settings || {});
      }
      storageNote();
      rev++;
      route();
    });
  }

  init();
})();
