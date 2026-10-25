/* GROUPWARE frontend (vanilla JS)
   Data is kept in localStorage so the UI runs on its own.
   Places marked "PHP:" are where you swap in fetch('api/....php') calls
   once the XAMPP / MySQL backend is ready. */

const KEY = 'groupware_state_v2';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = ts => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago';
};
const COLORS = ['#0b5d46', '#c27a0e', '#2f6fa8', '#8a4fa0', '#b5453a', '#3b7f87'];
const avatar = u => {
  const ini = u.name.split(' ').map(w => w[0]).slice(0, 2).join('');
  return `<span class="avatar" style="background:${COLORS[u.id % COLORS.length]}">${esc(ini)}</span>`;
};

/* ---------- data ---------- */
function seed() {
  const now = Date.now(), H = 3600000;
  return {
    // To add more students, add objects here (role: 'student').
    users: [
      { id: 1, name: 'Gemta Gemuse', role: 'student' },
      { id: 2, name: 'Duga Gurmesa', role: 'student' },
      { id: 9, name: 'Instructor Firaol', role: 'instructor' }
    ],
    settings: { maxScore: 50, weights: { proposal: 3, commit: 5, review: 2 } },
    items: [
      { id: 1, title: 'Project abstract', version: 2, content: 'A web platform that helps remote teams share work fairly and lets instructors see who contributed what.' },
      { id: 2, title: 'System requirements', version: 1, content: 'Users sign in with a team account.\nAny edit becomes a pending proposal.\nA majority of the team must approve before it is saved.' },
      { id: 3, title: 'Database design', version: 1, content: 'Tables: users, teams, items, proposals, votes, contribution_logs.' }
    ],
    proposals: [
      { id: 1, itemId: 2, authorId: 2, note: 'Add a notification requirement',
        newContent: 'Users sign in with a team account.\nAny edit becomes a pending proposal.\nTeam members are notified of each proposal.\nA majority of the team must approve before it is saved.',
        votes: { 2: 'approve' }, status: 'pending', createdAt: now - 2 * H }
    ],
    logs: [
      { id: 1, userId: 1, type: 'proposal', text: 'Proposed: new project abstract', at: now - 30 * H },
      { id: 2, userId: 2, type: 'review', text: 'Approved: new project abstract', at: now - 29 * H },
      { id: 3, userId: 1, type: 'commit', text: 'Change committed: Project abstract v2', at: now - 29 * H },
      { id: 4, userId: 2, type: 'proposal', text: 'Proposed: Add a notification requirement', at: now - 2 * H }
    ],
    nextId: 100
  };
}
let S = load();
function load() {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch (e) {}
  return seed();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
// PHP: replace load()/save() with fetch('api/state.php') and POST calls.

/* ---------- session ---------- */
let me = null, view = 'dashboard', filter = 'pending', loginRole = 'student';
const students = () => S.users.filter(u => u.role === 'student');
const user = id => S.users.find(u => u.id === id);
const need = () => Math.floor(students().length / 2) + 1; // majority; the author's own approval counts

/* ---------- assessment engine ---------- */
function points(uid) {
  const w = S.settings.weights;
  return S.logs.filter(l => l.userId === uid).reduce((s, l) => s + (w[l.type] || 0), 0);
}
function standings() {
  const rows = students().map(u => ({
    u, pts: points(u.id),
    props: S.logs.filter(l => l.userId === u.id && l.type === 'proposal').length,
    commits: S.logs.filter(l => l.userId === u.id && l.type === 'commit').length,
    reviews: S.logs.filter(l => l.userId === u.id && l.type === 'review').length
  }));
  const total = rows.reduce((s, r) => s + r.pts, 0) || 1;
  rows.forEach(r => { r.pct = (r.pts / total) * 100; r.mark = (r.pct / 100) * S.settings.maxScore; });
  return rows.sort((a, b) => b.pts - a.pts);
}
function log(userId, type, text) {
  S.logs.push({ id: S.nextId++, userId, type, text, at: Date.now() });
}

/* ---------- workflow ---------- */
function evaluate(p) {
  const votes = Object.values(p.votes);
  const yes = votes.filter(v => v === 'approve').length;
  const no = votes.filter(v => v === 'reject').length;
  const item = S.items.find(i => i.id === p.itemId);
  if (yes >= need()) {
    item.content = p.newContent; item.version++;
    p.status = 'approved';
    log(p.authorId, 'commit', `Change committed: ${item.title} v${item.version}`);
    toast('Majority reached. Change committed.');
  } else if (students().length - no < need()) {
    p.status = 'rejected';
    toast('Proposal rejected by the team.');
  }
}
function vote(pid, choice) {
  const p = S.proposals.find(x => x.id === pid);
  if (!p || p.status !== 'pending' || p.votes[me.id]) return;
  p.votes[me.id] = choice;
  log(me.id, 'review', `${choice === 'approve' ? 'Approved' : 'Rejected'}: ${p.note}`);
  evaluate(p);
  save(); render();
  // PHP: fetch('api/vote.php', {method:'POST', body: JSON.stringify({pid, choice})})
}
function submitProposal(itemId, content, note) {
  const item = S.items.find(i => i.id === itemId);
  if (content.trim() === item.content.trim()) return toast('No changes to propose.');
  if (S.proposals.some(p => p.itemId === itemId && p.status === 'pending'))
    return toast('This item already has a pending proposal.');
  const p = { id: S.nextId++, itemId, authorId: me.id, note, newContent: content,
    votes: { [me.id]: 'approve' }, status: 'pending', createdAt: Date.now() };
  S.proposals.push(p);
  log(me.id, 'proposal', `Proposed: ${note}`);
  evaluate(p); // a one-person team can pass instantly
  save(); render();
  if (p.status === 'pending') toast('Proposal sent. Your team has been notified.');
  // PHP: fetch('api/propose.php', {method:'POST', body: JSON.stringify({itemId, content, note})})
}

/* ---------- rendering ---------- */
function render() {
  $('#whoName').textContent = me.name;
  $('#whoRole').textContent = me.role === 'student' ? 'Student' : 'Instructor';
  $('#whoAvatar').outerHTML = avatar(me).replace('class="avatar"', 'class="avatar" id="whoAvatar"');
  $('#navInstructor').classList.toggle('hidden', me.role !== 'instructor');
  renderDashboard(); renderProject(); renderProposals(); renderActivity();
  if (me.role === 'instructor') renderInstructor();
  const open = S.proposals.filter(p => p.status === 'pending' && me.role === 'student' && !p.votes[me.id]).length;
  const b = $('#badge'); b.textContent = open; b.classList.toggle('hidden', !open);
}

function renderDashboard() {
  const rows = standings();
  const pending = S.proposals.filter(p => p.status === 'pending').length;
  const mine = rows.find(r => r.u.id === me.id);
  const rank = mine ? rows.indexOf(mine) + 1 : null;
  const first = me.name.split(' ')[0];
  const toReview = S.proposals.filter(p => p.status === 'pending' && me.role === 'student' && !p.votes[me.id]).length;

  $('#hero').innerHTML = mine ? `
    <div>
      <p>Welcome back, ${esc(first)}</p>
      <h2>${toReview ? `${toReview} proposal${toReview > 1 ? 's' : ''} waiting for your vote` : 'You are all caught up'}</h2>
      <button class="btn" data-go="${toReview ? 'proposals' : 'project'}">${toReview ? 'Review now' : 'Propose a change'}</button>
    </div>
    <div class="big"><b>${mine.mark.toFixed(1)}</b><p>of ${S.settings.maxScore} marks<br>Rank ${rank} of ${rows.length}, ${mine.pct.toFixed(0)}% share</p></div>`
  : `
    <div><p>Instructor overview</p><h2>${pending} pending, ${S.logs.length} actions recorded</h2>
      <button class="btn" data-go="instructor">Open marks</button></div>
    <div class="big"><b>${S.settings.maxScore}</b><p>total marks<br>shared by ${rows.length} students</p></div>`;

  $('#stats').innerHTML = [
    ['Pending proposals', pending],
    ['Changes committed', S.logs.filter(l => l.type === 'commit').length],
    ['Votes cast', S.logs.filter(l => l.type === 'review').length],
    ['Approvals needed', need()]
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

  $('#boardNote').textContent = `Marks come from each member's share of the team's audited activity, out of ${S.settings.maxScore}.`;
  $('#board').innerHTML = rows.map((r, i) => `
    <li class="row-b ${r.u.id === me.id ? 'me' : ''}">
      <i class="fill" style="width:${r.pct.toFixed(1)}%"></i>
      <span class="rank r${i + 1}">${i + 1}</span>
      ${avatar(r.u)}
      <div><div class="name">${esc(r.u.name)}</div>
        <div class="sub">${r.props} proposals, ${r.commits} committed, ${r.reviews} reviews</div></div>
      <div class="score"><b>${r.mark.toFixed(1)}</b><span>${r.pct.toFixed(1)}% share</span></div>
    </li>`).join('');
  $('#recent').innerHTML = feedHtml(S.logs.slice().reverse().slice(0, 6));
}

function feedHtml(list) {
  if (!list.length) return '<div class="empty">No activity yet.</div>';
  const w = S.settings.weights;
  return list.map(l => `<li><span><b>${esc(user(l.userId).name)}</b> ${esc(l.text)}
    <span class="pts">+${w[l.type] || 0}</span></span><time>${ago(l.at)}</time></li>`).join('');
}

function renderProject() {
  $('#items').innerHTML = S.items.map(i => {
    const pend = S.proposals.find(p => p.itemId === i.id && p.status === 'pending');
    return `<article class="card">
      <h3>${esc(i.title)} <span class="meta">version ${i.version}</span></h3>
      <p>${esc(i.content)}</p>
      ${pend ? '<span class="tag pending">Proposal pending</span>' : ''}
      ${me.role === 'student' && !pend ? `<button class="btn small" data-edit="${i.id}">Propose a change</button>` : ''}
    </article>`;
  }).join('');
}

function proposalCard(p) {
  const item = S.items.find(i => i.id === p.itemId);
  const yes = Object.values(p.votes).filter(v => v === 'approve').length;
  const my = p.votes[me.id];
  const canVote = me.role === 'student' && p.status === 'pending' && !my;
  const chips = Object.entries(p.votes).map(([id, v]) =>
    `<span class="${v === 'approve' ? 'a' : 'r'}">${esc(user(+id).name.split(' ')[0])}: ${v}</span>`).join('');
  return `<article class="card">
    <h3>${esc(item.title)} <span class="tag ${p.status}">${p.status[0].toUpperCase() + p.status.slice(1)}</span></h3>
    <div class="meta">By ${esc(user(p.authorId).name)}, ${ago(p.createdAt)}. ${esc(p.note)}</div>
    <div class="diff">
      <div class="old"><small>Current</small>${esc(item.content)}</div>
      <div class="new"><small>Proposed</small>${esc(p.newContent)}</div>
    </div>
    <div class="meter"><i style="width:${Math.min(100, (yes / need()) * 100)}%"></i></div>
    <div class="meta">${yes} of ${need()} approvals needed</div>
    <div class="votes">${chips}</div>
    ${canVote ? `<button class="btn approve" data-vote="approve" data-id="${p.id}">Approve</button>
                 <button class="btn reject" data-vote="reject" data-id="${p.id}">Reject</button>` : ''}
    ${p.authorId === me.id && p.status === 'pending' ? '<div class="meta">You proposed this. Your approval is already counted.</div>' : ''}
  </article>`;
}

function renderProposals() {
  const list = S.proposals.filter(p => filter === 'pending' ? p.status === 'pending' : p.status !== 'pending').reverse();
  $('#proposals').innerHTML = list.length ? list.map(proposalCard).join('')
    : `<div class="empty">${filter === 'pending' ? 'Nothing to review right now.' : 'No finished proposals yet.'}</div>`;
}

function renderActivity() {
  const sel = $('#logFilter'), cur = sel.value || 'all';
  sel.innerHTML = '<option value="all">All members</option>' +
    students().map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  sel.value = cur;
  $('#logList').innerHTML = feedHtml(S.logs.slice().reverse().filter(l => cur === 'all' || l.userId === +cur));
}

function renderInstructor() {
  if (!$('#settingsForm').contains(document.activeElement)) {
    $('#maxScore').value = S.settings.maxScore;
    $('#wProposal').value = S.settings.weights.proposal;
    $('#wCommit').value = S.settings.weights.commit;
    $('#wReview').value = S.settings.weights.review;
  }
  $('#marksTable').innerHTML = `<tr><th>Student</th><th class="n">Points</th><th class="n">Share</th><th class="n">Mark</th></tr>` +
    standings().map(r => `<tr><td>${esc(r.u.name)}</td><td class="n">${r.pts}</td>
      <td class="n">${r.pct.toFixed(1)}%</td><td class="n"><b>${r.mark.toFixed(1)}</b> / ${S.settings.maxScore}</td></tr>`).join('');
}

/* ---------- ui helpers ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function show(v) {
  view = v;
  $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== 'view-' + v));
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  window.scrollTo(0, 0);
}
function enter(u) {
  me = u; sessionStorage.setItem('gw_user', u.id);
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  show('dashboard'); render();
}
function fillLoginUsers() {
  $('#loginUser').innerHTML = S.users.filter(u => u.role === loginRole)
    .map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
}

/* ---------- events ---------- */
fillLoginUsers();
$$('.seg button').forEach(b => b.onclick = () => {
  $$('.seg button').forEach(x => x.classList.remove('active')); b.classList.add('active');
  loginRole = b.dataset.role; fillLoginUsers();
});
$('#passToggle').onclick = () => {
  const p = $('#loginPass'), hide = p.type === 'password';
  p.type = hide ? 'text' : 'password'; $('#passToggle').textContent = hide ? 'Hide' : 'Show';
};
$('#loginForm').onsubmit = e => { e.preventDefault(); enter(user(+$('#loginUser').value)); };
// PHP: POST name + password to api/login.php, then call enter(userFromServer)

$('#logoutBtn').onclick = () => {
  sessionStorage.removeItem('gw_user'); me = null;
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
};
$('#nav').onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.view); };
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); show(g.dataset.go); }
});
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
  filter = t.dataset.filter; renderProposals();
});
$('#logFilter').onchange = renderActivity;
$('#proposals').onclick = e => {
  const b = e.target.closest('[data-vote]'); if (b) vote(+b.dataset.id, b.dataset.vote);
};

let editing = null;
$('#items').onclick = e => {
  const b = e.target.closest('[data-edit]'); if (!b) return;
  editing = S.items.find(i => i.id === +b.dataset.edit);
  $('#proposeTitle').textContent = 'Propose a change to ' + editing.title;
  $('#proposeContent').value = editing.content; $('#proposeNote').value = '';
  $('#proposeDialog').showModal();
};
$('#proposeCancel').onclick = () => $('#proposeDialog').close();
$('#proposeForm').onsubmit = e => {
  e.preventDefault();
  submitProposal(editing.id, $('#proposeContent').value, $('#proposeNote').value.trim());
  $('#proposeDialog').close();
};

$('#settingsForm').onsubmit = e => {
  e.preventDefault();
  S.settings.maxScore = Math.max(1, +$('#maxScore').value || 50);
  S.settings.weights = { proposal: +$('#wProposal').value || 0, commit: +$('#wCommit').value || 0, review: +$('#wReview').value || 0 };
  save(); render(); toast('Marks recalculated.');
  // PHP: fetch('api/settings.php', {method:'POST', body: JSON.stringify(S.settings)})
};
$('#exportBtn').onclick = () => {
  const csv = 'Student,Points,Share %,Mark\n' + standings().map(r =>
    `"${r.u.name}",${r.pts},${r.pct.toFixed(1)},${r.mark.toFixed(1)}`).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'groupware-marks.csv'; a.click();
};
$('#resetBtn').onclick = () => {
  if (!confirm('Reset all demo data?')) return;
  S = seed(); save(); render(); toast('Demo data reset.');
};

/* ---------- live updates ---------- */
// Other tabs: storage event. PHP: use setInterval + fetch('api/state.php') instead.
window.addEventListener('storage', e => { if (e.key === KEY) { S = load(); if (me) render(); } });
setInterval(() => { if (me && !$('#proposeDialog').open) { S = load(); render(); } }, 5000);

$$('.year').forEach(y => y.textContent = new Date().getFullYear());

/* restore session */
const saved = sessionStorage.getItem('gw_user');
if (saved && user(+saved)) enter(user(+saved));