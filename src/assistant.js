const WELCOME = 'Ask about the selected mission, visibility, power, windows or travel. Calculations use the planner’s models; an API key must be configured on the server.';
const STORAGE_KEY = 'lunarnav:assistant:history:v1';

function assistantErrorHint(message){
  const text=String(message||'');
  if(/busy|high demand|quota|usage limit|unavailable|503|429/i.test(text))
    return 'The AI provider is busy or at its usage limit. Wait a moment, then press retry.';
  if(/deadline|timed out|timeout/i.test(text))
    return 'The AI provider timed out. Press **Send** to ask again. History and context are kept for the retry.';
  if(/api key|API_KEY|401|403|rejected/i.test(text))
    return 'Verify that **GEMINI_API_KEY** is configured on the Vercel deployment, then try again.';
  return 'Check that you are online and that the server is configured, then retry. History and context remain available.';
}
function escapeHTML(str){
  return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
// Render the Markdown subset used by the assistant.
function renderMarkdown(text){
  return String(text)
    .replace(/^[ \t]*\u2022[ \t]*/gm, '- ')
    .replace(/[\u2014\u00B7\u2022]/g, ':')
    .replace(/&(?:mdash|bull|middot);|&#(?:8212|8226|183);|&#x(?:2014|2022|b7);/gi, ':')
    .replace(/\r\n/g, '\n')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h4>$1</h4>')
    .replace(/^# (.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$1&nbsp;&nbsp;$2</li>')
    .replace(/(<li>\d+&nbsp;&nbsp;[\s\S]*?<\/li>)/g, '<ol>$1</ol>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
}

const ui = {};
let history = [];
let busy = false;
let readMission = null;

export function initMissionAssistant({
  root, fab, messages, input, send, close, newConversation, contextText, getContext
}){
  Object.assign(ui, {root, fab, messages, input, send, contextText});
  readMission = getContext;

  fab.addEventListener('click', () => toggle(true));
  for (const el of [close, ...document.querySelectorAll('[data-assistant-close]')]){
    el.addEventListener('click', () => toggle(false));
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !root.hidden) toggle(false);
  });
  const submit = () => { if (!busy && input.value.trim()) sendMessage(input.value); };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); submit(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(160, input.scrollHeight) + 'px';
  });

  newConversation.addEventListener('click', () => { history = []; persistHistory(); renderHistory(); focusInput(); });

  pushMessage('assistant', WELCOME);
  restoreHistory();
  updateContextBanner();
}

function toggle(show){
  ui.root.hidden = !show;
  ui.fab.setAttribute('aria-expanded', String(show));
  ui.fab.setAttribute('aria-label', show ? 'Close Ask Spacey AI' : 'Open Ask Spacey AI');
  document.body.classList.toggle('assistant-open', show);
  if (show){
    updateContextBanner();
    focusInput();
    ui.input.focus({preventScroll: true});
  }
}
export function refreshAssistantContext(){
  if (ui.root && !ui.root.hidden) updateContextBanner();
}
function focusInput(){
  requestAnimationFrame(() => ui.input.focus({preventScroll: true}));
}
function updateContextBanner(){
  if (!ui.contextText) return;
  const {site,date,time,days,terrain} = collectContext();
  const horizon = terrain?.applied ? (terrain.verifiedSource ? 'Terrain horizon' : 'Unverified terrain') : 'Flat 0° horizon';
  ui.contextText.textContent = site && date && time
    ? `${site.name}: ${date} ${time} UTC: ${days} days: ${horizon}`
    : 'Choose a site in Explore.';
}

function collectContext(){
  const mission = readMission();
  const transit = mission.transit;
  return {
    site: mission.site || null,
    date: mission.date || null,
    time: mission.time || null,
    days: mission.days,
    offsetHours: mission.offset,
    inspectionUTC: mission.inspectionUTC,
    route: mission.route,
    isCustom: Boolean(mission.site?.custom),
    terrain: mission.terrain ? {
      applied: Boolean(mission.terrain),
      source: mission.terrain.source || mission.terrain.provenance || null,
      verifiedSource: Boolean(mission.terrain.verifiedSource),
      coveragePct: mission.terrain.coveragePct,
      radiusKm: mission.terrain.radiusKm,
      resolutionM: mission.terrain.resolutionM,
      azimuthDeg: mission.terrain.azimuthDeg,
      elevationDeg: mission.terrain.elevationDeg
    } : null,
    simulation: mission.simulation ? {
      minimumSocPct: mission.simulation.minimumSocPct, endingSocPct: mission.simulation.endingSocPct,
      generatedWh: mission.simulation.generatedWh, consumedWh: mission.simulation.consumedWh,
      unmetWh: mission.simulation.unmetWh, unmetHours: mission.simulation.unmetHours,
      solarAccessPct: mission.simulation.solarAccessPct, earthAccessPct: mission.simulation.earthAccessPct,
      dualAccessPct: mission.simulation.dualAccessPct, longestAccessGapHours: mission.simulation.longestAccessGapHours,
      terrainApplied: mission.simulation.terrainApplied
    } : null,
    missionSummary: mission.missionSummary || null,
    finder: mission.finder ? {startDate: mission.finder.startDate, startTime: mission.finder.startTime, searchDays: mission.finder.searchDays,
      windowDays: mission.finder.windowDays, priority: mission.finder.priority, terrainMode: mission.finder.terrainMode,
      top: mission.finder.top} : null,
    terrainProfilesBySite: Object.fromEntries(Object.entries(mission.terrainProfiles||{}).map(([id,p])=>[id,{
      azimuthDeg:p.azimuthDeg,elevationDeg:p.elevationDeg,lat:p.lat,lon:p.lon,
      source:p.source,verifiedSource:p.verifiedSource,coveragePct:p.coveragePct,radiusKm:p.radiusKm,resolutionM:p.resolutionM
    }])),
    transit: transit ? {
      model: transit.model, profile: transit.profile, profileLabel: transit.profileLabel,
      destination: transit.destination, totalTransitHours: transit.totalTransitHours,
      departureUTC: transit.departureUTC, arrivalUTC: transit.arrivalUTC, scheduleMode: transit.scheduleMode
    } : null
  };
}

function renderHistory(){
  const box = ui.messages;
  box.replaceChildren();
  for (const entry of history){
    const node = buildMessageNode(entry.role, entry.text, entry.tools);
    box.appendChild(node);
  }
  box.scrollTop = box.scrollHeight;
}
function pushMessage(role, text, tools = []){
  history.push({role, text, tools});
  ui.messages.appendChild(buildMessageNode(role, text, tools));
  ui.messages.scrollTop = ui.messages.scrollHeight;
  persistHistory();
}
function buildMessageNode(role, text, tools = []){
  const node = document.createElement('div');
  node.className = 'assistant-message ' + (role === 'user' ? 'user' : 'assistant');
  if (role === 'user'){
    node.innerHTML = `<div class="assistant-message-bubble">${escapeHTML(text)}</div>`;
    return node;
  }
  const toolsHtml = tools.length
    ? `<div class="assistant-tool-log">${tools.map(t =>
        `<span class="assistant-tool-chip ${t.ok ? 'ok' : 'fail'}" title="${escapeHTML(t.args ? JSON.stringify(t.args).slice(0,200) : '')}">${escapeHTML(t.name)}: ${escapeHTML(t.summary)}</span>`).join('')}</div>`
    : '';
  const welcome = text === WELCOME && tools.length === 0;
  if (welcome) node.classList.add('assistant-welcome');
  const displayedText = welcome ? 'Ask about the current site, visibility, mission windows, power or travel.' : text;
  node.innerHTML = `<div class="assistant-message-bubble assistant-answer">${renderMarkdown(displayedText)}${toolsHtml}</div>`;
  return node;
}
function showTyping(){
  const node = document.createElement('div');
  node.className = 'assistant-message assistant typing';
  node.id = 'assistant-typing';
  node.innerHTML = '<div class="assistant-message-bubble"><span class="assistant-typing-dots"><i></i><i></i><i></i></span><span class="assistant-typing-label">Waiting for Gemini…</span></div>';
  ui.messages.appendChild(node);
  ui.messages.scrollTop = ui.messages.scrollHeight;
  return node;
}
async function sendMessage(text){
  const userText = text.trim();
  if (!userText || busy) return;
  busy = true;
  ui.input.value = '';
  ui.input.style.height = 'auto';
  pushMessage('user', userText);
  const typing = showTyping();
  ui.send.disabled = true;

  const context = collectContext();
  const historyForApi = history.slice(0, -1).map(e => ({role: e.role, text: e.text})).slice(-12);

  try {
    const payload = {message: {role: 'user', text: userText}, history: historyForApi, context};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    let response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (fetchError){
      if (fetchError.name === 'AbortError'){
        throw new Error('The assistant request timed out. The Gemini service may be busy; please try again shortly.');
      }
      throw fetchError;
    } finally {
      clearTimeout(timeout);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok){
      throw new Error(body.error || `Assistant API error (${response.status})`);
    }
    typing.querySelector('.assistant-typing-label').textContent = 'Rendering…';
    pushMessage('assistant', body.reply || 'No reply received.', body.tools || []);
  } catch (error){
    typing.remove();
    pushMessage('assistant', `**The assistant could not complete that request.**\n\n${escapeHTML(error.message)}\n\n> ${assistantErrorHint(error.message)}`);
  } finally {
    typing.remove();
    busy = false;
    ui.send.disabled = false;
    focusInput();
  }
}

function persistHistory(){
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-20)));
  } catch { /* Storage unavailable; chat still works in memory. */ }
}
function restoreHistory(){
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (Array.isArray(stored)){
      const welcome = history[0];
      history = [];
      pushMessage('assistant', welcome.text);
      for (const entry of stored.slice(0, 20)){
        if (entry.role === 'assistant' && entry.text === welcome.text) continue;
        history.push(entry);
        ui.messages.appendChild(buildMessageNode(entry.role, entry.text, entry.tools || []));
      }
      ui.messages.scrollTop = ui.messages.scrollHeight;
    }
  } catch { /* Corrupt or inaccessible storage is ignored. */ }
}