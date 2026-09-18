let session, user, profile, goals = [], focusGoal = null, chatHistory = [];

(async () => {
  session = await Verya.requireSession();
  if (!session) return;

  document.getElementById('signOutBtn').onclick = () => Verya.signOut();

  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => switchPanel(tab.dataset.panel);
  });

  await loadEverything();
  wireToday();
  wirePlanAdd();
  wireMentor();
  wireWorkLog();
  wireRecall();
  wireDigest();
  refreshDueBadge();
})();

function switchPanel(name){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'mentor') loadChatHistory();
  if (name === 'worklog') loadWorkHistory();
  if (name === 'plan') renderPlan();
  if (name === 'recall') renderRecallIntro();
  if (name === 'digest') { renderStats(); loadDigests(); }
}

async function loadEverything(){
  const { data: { user: u } } = await Verya.sb.auth.getUser();
  user = u;

  const { data: p } = await Verya.sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  profile = p || {};

  document.getElementById('greeting').textContent = profile.full_name
    ? `Welcome back, ${profile.full_name}`
    : 'Welcome back';

  const { data: g } = await Verya.sb.from('goals').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  goals = g || [];
  focusGoal = goals.find(x => x.is_focus) || goals[0] || null;

  const sel = document.getElementById('goalSelect');
  if (goals.length > 1) {
    sel.style.display = 'block';
    sel.innerHTML = goals.map(gl => `<option value="${gl.id}" ${focusGoal && gl.id === focusGoal.id ? 'selected' : ''}>${escapeHtml(gl.title)}</option>`).join('');
    sel.onchange = async () => {
      const id = sel.value;
      await Verya.sb.from('goals').update({ is_focus: false }).eq('user_id', user.id);
      await Verya.sb.from('goals').update({ is_focus: true }).eq('id', id);
      await loadEverything();
      renderPlan();
    };
  }

  renderPlan();
}

// ---------------- TODAY ----------------
function wireToday(){
  document.getElementById('getRecBtn').onclick = getRecommendation;
}

async function getRecommendation(){
  const resultBox = document.getElementById('recResult');
  if (!focusGoal) {
    resultBox.innerHTML = `<div class="alert alert-info">You don't have an active goal yet. Add one in the Plan tab.</div>`;
    return;
  }
  const minutes = parseInt(document.getElementById('minutesInput').value, 10) || 30;
  const btn = document.getElementById('getRecBtn');
  btn.disabled = true;
  resultBox.innerHTML = `<div class="loading-row"><span class="spinner"></span> Thinking about the highest-impact move…</div>`;
  try {
    const { data: recent } = await Verya.sb.from('work_log').select('entry,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);
    const rec = await Verya.ai('daily_recommendation', {
      profile, goal: focusGoal, minutes_available: minutes, recent_work: recent || [],
    });
    resultBox.innerHTML = `
      <div class="rec-box">
        <div class="eyebrow">Recommendation</div>
        <div class="rec-action">${escapeHtml(rec.action)}</div>
        <div class="rec-why">${escapeHtml(rec.why)}</div>
        <div class="rec-next">Next: ${escapeHtml(rec.next)}</div>
      </div>
      <div style="margin-top:16px;">
        <button class="btn btn-ghost btn-sm" id="markDoneBtn">Mark this session done</button>
      </div>
    `;
    await Verya.sb.from('time_logs').insert({
      user_id: user.id, goal_id: focusGoal.id, minutes_available: minutes,
      recommended_action: rec.action, recommended_why: rec.why,
    });
    document.getElementById('markDoneBtn').onclick = (e) => {
      e.target.textContent = 'Logged ✓';
      e.target.disabled = true;
    };
  } catch (err) {
    resultBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message || 'Could not get a recommendation. Please try again.')}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------------- PLAN ----------------
function renderPlan(){
  const card = document.getElementById('planCard');
  if (!focusGoal) {
    card.innerHTML = `<div class="empty-state">No active goal yet. Add one below to get your first plan.</div>`;
    return;
  }
  const milestones = focusGoal.milestones || [];
  card.innerHTML = `
    <div class="goal-card" style="margin-bottom:18px;">
      <h2 style="font-size:20px;">${escapeHtml(focusGoal.title)}</h2>
      <span class="goal-badge">${focusGoal.timeframe_weeks || '?'} weeks</span>
    </div>
    ${milestones.length === 0 ? `<div class="empty-state">No milestones yet.</div>` : milestones.map((m, i) => `
      <div class="milestone">
        <input type="checkbox" data-idx="${i}" ${m.done ? 'checked' : ''}>
        <div>
          <div class="milestone-title ${m.done ? 'done' : ''}">${escapeHtml(m.title)}</div>
          <div class="milestone-desc">${escapeHtml(m.description || '')}</div>
          <div class="milestone-week">Week ${m.week_target || '?'}</div>
        </div>
      </div>
    `).join('')}
  `;
  card.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => toggleMilestone(parseInt(cb.dataset.idx, 10), cb.checked);
  });
}

// Unchecking is free. CHECKING a milestone opens the understanding check:
// you explain what you actually did, in your own words, before it counts.
async function toggleMilestone(idx, done){
  const milestones = [...(focusGoal.milestones || [])];
  if (!milestones[idx]) return;
  if (!done) {
    milestones[idx] = { ...milestones[idx], done: false };
    focusGoal.milestones = milestones;
    await Verya.sb.from('goals').update({ milestones }).eq('id', focusGoal.id);
    renderPlan();
    return;
  }
  openUnderstandingCheck(idx);
}

async function commitMilestone(idx, explanation){
  const milestones = [...(focusGoal.milestones || [])];
  milestones[idx] = { ...milestones[idx], done: true, explanation: explanation || null };
  focusGoal.milestones = milestones;
  await Verya.sb.from('goals').update({ milestones }).eq('id', focusGoal.id);
  if (explanation) {
    await Verya.sb.from('work_log').insert({
      user_id: user.id, goal_id: focusGoal.id,
      entry: `[Milestone: ${milestones[idx].title}] ${explanation}`,
      ai_feedback: null, is_understanding_check: true,
    });
  }
  renderPlan();
}

function openUnderstandingCheck(idx){
  const m = (focusGoal.milestones || [])[idx];
  if (!m) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="eyebrow">Understanding check</div>
      <h3 style="margin-top:12px;">${escapeHtml(m.title)}</h3>
      <div class="modal-sub">Explain what you did and what you understood — in your own words, as if teaching someone else. This is the point where learning actually sticks.</div>
      <textarea id="ucInput" placeholder="In your own words…" style="min-height:130px;"></textarea>
      <div id="ucResult" style="margin-top:14px;"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost btn-sm" id="ucCancel">Cancel</button>
        <button class="btn btn-ghost btn-sm" id="ucSkip">Skip check</button>
        <button class="btn btn-primary btn-sm" id="ucSubmit">Check &amp; complete</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => { backdrop.remove(); renderPlan(); };
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  document.getElementById('ucCancel').onclick = close;
  document.getElementById('ucSkip').onclick = async () => { await commitMilestone(idx, null); backdrop.remove(); };
  document.getElementById('ucSubmit').onclick = async () => {
    const explanation = document.getElementById('ucInput').value.trim();
    const resultBox = document.getElementById('ucResult');
    if (!explanation) { resultBox.innerHTML = `<div class="alert alert-error">Write your explanation first — or use Skip check.</div>`; return; }
    const btn = document.getElementById('ucSubmit');
    btn.disabled = true;
    resultBox.innerHTML = `<div class="loading-row"><span class="spinner"></span> Checking your explanation…</div>`;
    try {
      const res = await Verya.ai('verify_understanding', { milestone: m, explanation, profile });
      if (res.sufficient) {
        resultBox.innerHTML = `<div class="alert alert-success">${escapeHtml(res.feedback)}</div>`;
        await commitMilestone(idx, explanation);
        setTimeout(() => backdrop.remove(), 1400);
      } else {
        resultBox.innerHTML = `<div class="alert alert-info">${escapeHtml(res.feedback)}</div>
          <div class="muted" style="font-size:12px;margin-top:8px;">Add more detail and check again — or use Skip check if you'd rather move on.</div>`;
        btn.disabled = false;
      }
    } catch (err) {
      resultBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message || 'Could not check right now.')}</div>`;
      btn.disabled = false;
    }
  };
  document.getElementById('ucInput').focus();
}

function wirePlanAdd(){
  document.getElementById('addGoalBtn').onclick = addNewGoal;
}

async function addNewGoal(){
  const alertBox = document.getElementById('addGoalAlert');
  Verya.clearAlert(alertBox);
  const title = document.getElementById('newGoalTitle').value.trim();
  const weeks = parseInt(document.getElementById('newGoalWeeks').value, 10) || 12;
  if (!title) { Verya.showAlert(alertBox, 'Describe the goal first.'); return; }
  const btn = document.getElementById('addGoalBtn');
  btn.disabled = true;
  Verya.showAlert(alertBox, 'Building plan…', 'info');
  try {
    const planResult = await Verya.ai('generate_plan', {
      profile: { ...profile, goal: title },
      timeframe_weeks: weeks,
    });
    await Verya.sb.from('goals').update({ is_focus: false }).eq('user_id', user.id);
    await Verya.sb.from('goals').insert({
      user_id: user.id, title, timeframe_weeks: weeks,
      milestones: (planResult.milestones || []).map(m => ({ ...m, done: false })),
      status: 'active', is_focus: true,
    });
    document.getElementById('newGoalTitle').value = '';
    Verya.clearAlert(alertBox);
    await loadEverything();
  } catch (err) {
    Verya.showAlert(alertBox, err.message || 'Could not build a plan for that goal.');
  } finally {
    btn.disabled = false;
  }
}

// ---------------- MENTOR ----------------
let chatMode = 'direct';
const MODE_HINTS = {
  direct: 'Direct — straight answers and honest critique.',
  socratic: "Socratic — Verya won't give you the answer. It asks the questions that get you there yourself.",
  panel: 'Panel — three mentors with different biases answer at once. You decide who\'s right.',
};

function wireMentor(){
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.onclick = () => {
      chatMode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('modeHint').textContent = MODE_HINTS[chatMode];
    };
  });
  document.getElementById('chatSendBtn').onclick = sendChat;
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendChat();
  });
}

async function loadChatHistory(){
  const log = document.getElementById('chatLog');
  const { data } = await Verya.sb.from('chat_messages').select('*').eq('user_id', user.id).order('created_at', { ascending: true }).limit(50);
  chatHistory = (data || []).map(m => ({ role: m.role, content: m.content }));
  renderChatLog();
}

function renderChatLog(){
  const log = document.getElementById('chatLog');
  log.innerHTML = chatHistory.map(m => `<div class="msg ${m.role}">${escapeHtml(m.content)}</div>`).join('')
    || `<div class="empty-state">Ask your mentor anything about your goal.</div>`;
  log.scrollTop = log.scrollHeight;
}

async function sendChat(){
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  chatHistory.push({ role: 'user', content: message });
  renderChatLog();
  await Verya.sb.from('chat_messages').insert({ user_id: user.id, role: 'user', content: message });

  const log = document.getElementById('chatLog');
  log.insertAdjacentHTML('beforeend', `<div class="loading-row" id="chatLoading"><span class="spinner"></span> Thinking…</div>`);
  log.scrollTop = log.scrollHeight;

  try {
    const resp = await Verya.ai('chat', { message, history: chatHistory.slice(0, -1), profile, goal: focusGoal, mode: chatMode });
    document.getElementById('chatLoading')?.remove();
    let content;
    if (resp.panel) {
      content = resp.panel.map(p => `${p.persona}:\n${p.reply}`).join('\n\n')
        + '\n\n— Three views, not one answer. Which do you actually agree with, and why?';
    } else {
      content = resp.reply;
    }
    chatHistory.push({ role: 'assistant', content });
    renderChatLog();
    await Verya.sb.from('chat_messages').insert({ user_id: user.id, role: 'assistant', content });
  } catch (err) {
    document.getElementById('chatLoading')?.remove();
    log.insertAdjacentHTML('beforeend', `<div class="alert alert-error">${escapeHtml(err.message || 'Mentor is unreachable right now.')}</div>`);
  }
}

// ---------------- WORK LOG ----------------
function wireWorkLog(){
  document.getElementById('logWorkBtn').onclick = submitWorkLog;
}

async function submitWorkLog(){
  const alertBox = document.getElementById('workAlert');
  Verya.clearAlert(alertBox);
  const entry = document.getElementById('workEntry').value.trim();
  if (!entry) { Verya.showAlert(alertBox, 'Describe what you worked on first.'); return; }
  const btn = document.getElementById('logWorkBtn');
  btn.disabled = true;
  Verya.showAlert(alertBox, 'Getting feedback…', 'info');
  try {
    const fb = await Verya.ai('project_feedback', { entry, profile, goal: focusGoal });
    await Verya.sb.from('work_log').insert({
      user_id: user.id, goal_id: focusGoal ? focusGoal.id : null,
      entry, ai_feedback: JSON.stringify(fb),
    });
    document.getElementById('workEntry').value = '';
    Verya.clearAlert(alertBox);
    await loadWorkHistory();
  } catch (err) {
    Verya.showAlert(alertBox, err.message || 'Could not get feedback right now.');
  } finally {
    btn.disabled = false;
  }
}

async function loadWorkHistory(){
  const box = document.getElementById('workHistory');
  const { data } = await Verya.sb.from('work_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
  if (!data || data.length === 0) {
    box.innerHTML = `<div class="empty-state">No entries yet.</div>`;
    return;
  }
  box.innerHTML = data.map(item => {
    let fb = null;
    try { fb = JSON.parse(item.ai_feedback); } catch (e) { fb = { feedback: item.ai_feedback, suggestions: [] }; }
    return `
      <div class="worklog-item">
        <div class="worklog-entry">${escapeHtml(item.entry)}</div>
        ${fb && fb.feedback ? `<div class="worklog-feedback">${escapeHtml(fb.feedback)}</div>` : ''}
        ${fb && fb.suggestions && fb.suggestions.length ? `<ul class="worklog-suggestions">${fb.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
      </div>
    `;
  }).join('');
}

// ---------------- RECALL (spaced repetition on the user's own work) ----------------
let recallQueue = [], recallIdx = 0;

function wireRecall(){
  document.getElementById('startRecallBtn').onclick = startRecall;
  document.getElementById('buildCardsBtn').onclick = buildRecallCards;
}

async function refreshDueBadge(){
  try {
    const { count } = await Verya.sb.from('recall_cards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).lte('due_at', new Date().toISOString());
    const badge = document.getElementById('dueBadge');
    if (count && count > 0) { badge.textContent = count; badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }
  } catch (e) { /* non-critical */ }
}

function renderRecallIntro(){
  refreshDueBadge();
}

async function buildRecallCards(){
  const alertBox = document.getElementById('recallAlert');
  const btn = document.getElementById('buildCardsBtn');
  btn.disabled = true;
  Verya.showAlert(alertBox, 'Reading your recent work…', 'info');
  try {
    const { data: entries } = await Verya.sb.from('work_log')
      .select('id,entry,created_at').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(8);
    if (!entries || entries.length === 0) {
      Verya.showAlert(alertBox, 'Log some work first — recall questions come from your own entries.', 'info');
      return;
    }
    const res = await Verya.ai('generate_review_questions', { recent_entries: entries, profile });
    const qs = res.questions || [];
    if (qs.length === 0) { Verya.showAlert(alertBox, 'Could not build questions from those entries. Try logging more detail.', 'info'); return; }
    const rows = qs.map(q => ({
      user_id: user.id, question: q.question, answer_hint: q.answer_hint || '',
      source_entry_id: entries[0].id, interval_days: 1, due_at: new Date().toISOString(),
    }));
    const { error } = await Verya.sb.from('recall_cards').insert(rows);
    if (error) throw error;
    Verya.showAlert(alertBox, `${rows.length} recall cards created. Hit "Start review".`, 'success');
    refreshDueBadge();
  } catch (err) {
    Verya.showAlert(alertBox, err.message || 'Could not build cards.');
  } finally {
    btn.disabled = false;
  }
}

async function startRecall(){
  const alertBox = document.getElementById('recallAlert');
  const area = document.getElementById('recallArea');
  Verya.clearAlert(alertBox);
  area.innerHTML = `<div class="loading-row"><span class="spinner"></span> Loading due cards…</div>`;
  const { data } = await Verya.sb.from('recall_cards').select('*')
    .eq('user_id', user.id).lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true }).limit(10);
  recallQueue = data || [];
  recallIdx = 0;
  if (recallQueue.length === 0) {
    area.innerHTML = `<div class="card"><div class="empty-state">Nothing due right now. Build cards from your recent work, or come back when they're scheduled.</div></div>`;
    return;
  }
  renderRecallCard();
}

function renderRecallCard(){
  const area = document.getElementById('recallArea');
  if (recallIdx >= recallQueue.length) {
    area.innerHTML = `<div class="card"><div class="empty-state">Review complete — ${recallQueue.length} card${recallQueue.length === 1 ? '' : 's'} done.</div></div>`;
    refreshDueBadge();
    return;
  }
  const card = recallQueue[recallIdx];
  area.innerHTML = `
    <div class="card">
      <div class="eyebrow">Card ${recallIdx + 1} of ${recallQueue.length}</div>
      <div class="recall-card" style="margin-top:16px;border:none;padding:0;">
        <div class="recall-q">${escapeHtml(card.question)}</div>
        <textarea id="recallAnswer" placeholder="Answer from memory — don't look it up."></textarea>
        <div id="recallResult" style="margin-top:14px;"></div>
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" id="submitRecallBtn">Check my answer</button>
          <button class="btn btn-ghost btn-sm" id="skipRecallBtn">Skip</button>
        </div>
      </div>
    </div>`;
  document.getElementById('submitRecallBtn').onclick = () => submitRecall(card);
  document.getElementById('skipRecallBtn').onclick = () => { recallIdx++; renderRecallCard(); };
  document.getElementById('recallAnswer').focus();
}

async function submitRecall(card){
  const answer = document.getElementById('recallAnswer').value.trim();
  const resultBox = document.getElementById('recallResult');
  if (!answer) { resultBox.innerHTML = `<div class="alert alert-error">Write what you remember first.</div>`; return; }
  const btn = document.getElementById('submitRecallBtn');
  btn.disabled = true;
  resultBox.innerHTML = `<div class="loading-row"><span class="spinner"></span> Checking…</div>`;
  try {
    const res = await Verya.ai('grade_recall', { question: card.question, answer_hint: card.answer_hint, user_answer: answer });
    const verdict = res.verdict || 'partial';
    // Spacing: strong answers push further out, weak ones come back tomorrow.
    const nextInterval = verdict === 'strong' ? Math.max(2, (card.interval_days || 1) * 2)
                       : verdict === 'partial' ? Math.max(1, card.interval_days || 1)
                       : 1;
    const due = new Date(Date.now() + nextInterval * 86400000).toISOString();
    await Verya.sb.from('recall_cards').update({
      interval_days: nextInterval, due_at: due, last_verdict: verdict,
      review_count: (card.review_count || 0) + 1,
    }).eq('id', card.id);
    resultBox.innerHTML = `
      <div class="recall-verdict verdict-${verdict}">${verdict}</div>
      <div class="recall-feedback">${escapeHtml(res.feedback)}</div>
      <div class="muted" style="font-size:12px;margin-top:10px;">Next review in ${nextInterval} day${nextInterval === 1 ? '' : 's'}.</div>`;
    btn.textContent = 'Next card';
    btn.disabled = false;
    btn.onclick = () => { recallIdx++; renderRecallCard(); };
  } catch (err) {
    resultBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message || 'Could not grade that.')}</div>`;
    btn.disabled = false;
  }
}

// ---------------- DIGEST ----------------
function wireDigest(){
  document.getElementById('genDigestBtn').onclick = generateDigest;
}

async function renderStats(){
  const row = document.getElementById('statRow');
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count: entryCount } = await Verya.sb.from('work_log')
      .select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
    const { count: sessionCount } = await Verya.sb.from('time_logs')
      .select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
    const done = (focusGoal?.milestones || []).filter(m => m.done).length;
    const total = (focusGoal?.milestones || []).length;
    row.innerHTML = `
      <div class="stat"><div class="stat-val">${entryCount || 0}</div><div class="stat-lbl">Entries / 7d</div></div>
      <div class="stat"><div class="stat-val">${sessionCount || 0}</div><div class="stat-lbl">Sessions / 7d</div></div>
      <div class="stat"><div class="stat-val">${done}/${total}</div><div class="stat-lbl">Milestones</div></div>`;
  } catch (e) { row.innerHTML = ''; }
}

async function generateDigest(){
  const alertBox = document.getElementById('digestAlert');
  const btn = document.getElementById('genDigestBtn');
  Verya.clearAlert(alertBox);
  btn.disabled = true;
  Verya.showAlert(alertBox, 'Reviewing your week…', 'info');
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: logs } = await Verya.sb.from('work_log')
      .select('entry,created_at').eq('user_id', user.id).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(20);
    const done = (focusGoal?.milestones || []).filter(m => m.done).map(m => m.title);
    const res = await Verya.ai('growth_digest', { work_log: logs || [], milestones_done: done, profile, goal: focusGoal });
    const { error } = await Verya.sb.from('digests').insert({
      user_id: user.id, goal_id: focusGoal ? focusGoal.id : null,
      highlights: res.highlights, honest_critique: res.honest_critique, focus_next_week: res.focus_next_week,
    });
    if (error) throw error;
    Verya.clearAlert(alertBox);
    await loadDigests();
  } catch (err) {
    Verya.showAlert(alertBox, err.message || 'Could not generate a digest.');
  } finally {
    btn.disabled = false;
  }
}

async function loadDigests(){
  const area = document.getElementById('digestArea');
  const { data } = await Verya.sb.from('digests').select('*')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10);
  if (!data || data.length === 0) {
    area.innerHTML = `<div class="card"><div class="empty-state">No digests yet. Generate one after you've logged some work.</div></div>`;
    return;
  }
  area.innerHTML = data.map(d => `
    <div class="card">
      <div class="digest-date">${new Date(d.created_at).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })}</div>
      <div class="digest-block"><h4>Progress</h4><p>${escapeHtml(d.highlights || '')}</p></div>
      <div class="digest-block critique"><h4>Honest critique</h4><p>${escapeHtml(d.honest_critique || '')}</p></div>
      <div class="digest-block"><h4>Focus next</h4><p>${escapeHtml(d.focus_next_week || '')}</p></div>
    </div>`).join('');
}
