/*
 * Synthetic demo data so the platform can be explored without loading real player records.
 * All names, emails and numbers are fabricated.
 */
(function (root) {
  'use strict';

  var M = root.PD && root.PD.model ? root.PD.model : require('./model.js');

  var BOYS = ['Oliver', 'Noah', 'Leo', 'Jack', 'Henry', 'Charlie', 'Lucas', 'Archie', 'Hudson', 'Theo', 'Max', 'Kai', 'Ethan', 'Mason', 'Levi', 'Eli', 'Harvey', 'Zac'];
  var GIRLS = ['Charlotte', 'Amelia', 'Isla', 'Olivia', 'Mia', 'Ava', 'Grace', 'Willow', 'Matilda', 'Ruby', 'Evie', 'Harper', 'Sienna', 'Chloe', 'Zara', 'Lily'];
  var LAST = ['Sample', 'Example', 'Testwood', 'Demo', 'Placeholder', 'Mockford', 'Fictor', 'Notreal', 'Sandbox', 'Trialson', 'Dummett', 'Specimen', 'Prototype', 'Draftly'];
  var PARENTS = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Jamie', 'Riley', 'Drew', 'Kim'];
  var HUBS = { cc: ['Rockhampton Hub', 'Gladstone Hub'], wb: ['Northern Hub (Bundaberg)', 'Southern Hub (Fraser Coast)'] };
  var CLUBS = ['Example United FC', 'Sample City SC', 'Demo Rovers', 'Testwood Wanderers'];

  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

  function generate(season, count) {
    var r = rng(42), pick = function (a) { return a[Math.floor(r() * a.length)]; };
    var weighted = function (pairs) { var x = r(), t = 0; for (var i = 0; i < pairs.length; i++) { t += pairs[i][1]; if (x < t) return pairs[i][0]; } return pairs[0][0]; };
    var out = [];
    for (var i = 0; i < (count || 400); i++) {
      var prog = weighted([['fng', .14], ['nor', .14], ['whc', .12], ['cc', .15], ['wb', .14], ['metro', .13], ['qst-boys', .04], ['qas-nplw', .04], ['qst-girls-u15', .03], ['qst-girls-u16', .03], ['mtisa', .02], ['burdekin', .02]]);
      var g = M.program(prog);
      var gender = g.gender || (r() < 0.75 ? 'Male' : 'Female');
      var age = g.tier === 'Full Time' ? 15 + Math.floor(r() * 3) : prog === 'metro' ? 13 + Math.floor(r() * 4) : 9 + Math.floor(r() * 9);
      var year = season - age, month = 1 + Math.floor(r() * 12), day = 1 + Math.floor(r() * 28);
      var last = pick(LAST);
      var status = weighted([['Early Retention', .45], ['New Player Offer', .3], ['Review', .1], ['Waitlist', .06], ['Graduate', .05], ['Release', .04]]);
      var letter = { Waitlist: 'Waitlist Letter', Graduate: 'Graduate Letter', Release: 'Release Letter', Review: r() < .5 ? 'Letter of Offer' : 'Review Letter' }[status] || 'Letter of Offer';
      var response = letter === 'Letter of Offer' ? weighted([['Accepted', .55], ['Awaiting Response', .33], ['Declined', .05], ['Please Send', .07]]) : 'Notice Sent';
      var p1 = pick(PARENTS), p2 = pick(PARENTS);
      var phone = function () { return '04' + Math.floor(10 + r() * 89) + ' ' + Math.floor(100 + r() * 899) + ' ' + Math.floor(100 + r() * 899); };
      out.push(M.newPlayer({
        firstName: pick(gender === 'Male' ? BOYS : GIRLS), lastName: last,
        dob: year + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day,
        gender: gender, programId: prog, hub: HUBS[prog] ? pick(HUBS[prog]) : g.tier === 'Development Hub' ? g.name : '',
        club: pick(CLUBS), position: r() < 0.1 ? 'Goalkeeper' : 'Outfield',
        offerStatus: status, letterType: letter, response: response,
        waitlistRank: status === 'Waitlist' ? 1 + Math.floor(r() * 4) : '',
        fee: response === 'Accepted' ? (r() < 0.8 ? 'Paid' : 'Unpaid') : '',
        feeAdjustment: r() < 0.03 ? 'Financial Hardship' : '',
        jersey: response === 'Accepted' ? pick(gender === 'Female' ? ['Female Cut - Small', 'Female Cut - Medium'] : ['Unisex - Small', 'Unisex - Medium', 'Unisex - Large']) : '',
        shorts: response === 'Accepted' ? pick(['Unisex - Small', 'Unisex - Medium', 'Unisex - Large']) : '',
        sock: response === 'Accepted' ? pick(['2 to 7', '7 to 11', '11 to 14']) : '',
        contacts: [
          { name: p1 + ' ' + last, email: p1.toLowerCase() + '.' + last.toLowerCase() + i + '@example.com', phone: phone() },
          r() < 0.6 ? { name: p2 + ' ' + last, email: p2.toLowerCase() + i + '@example.org', phone: phone() } : { name: '', email: '', phone: '' }
        ],
        source: 'Demo data',
        history: [{ at: new Date().toISOString(), by: 'Demo', what: 'Created as demo data' }]
      }));
    }
    return out;
  }

  var api = { generate: generate };
  root.PD = root.PD || {};
  root.PD.demo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
