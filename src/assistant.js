/**
 * LunarNav Gemini mission-assistant front-end.
 *
 * Renders the floating chat panel and sends messages to /api/chat with a
 * compact, sanitised snapshot of the live mission configuration. Gemini
 * function calling runs on the server (src/tools.js) and the executed tool
 * chips come back with the reply. Conversation history stays in browser
 * memory (plus sessionStorage when available).
 *
 * The Gemini API key is never present in any front-end file; it only exists
 * as the server-side GEMINI_API_KEY env var.
 */

const WELCOME = 'Ask about the selected mission, visibility, power, windows or travel. Calculations use the planner’s models; an API key must be configured on the server.';
const STORAGE_KEY = 'lunarnav:assistant:history:v1';

function assistantErrorHint(message){
  const text=String(message||'');
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
/** Minimal Markdown rendering tuned for scientific answers (no raw HTML). */
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

/* ---- State ---- */
const ui = {};
let history = [];
let busy = false;
let contextHook = null;

export function initMissionAssistant({
  root, fab, panel, messages, input, send, close, newConversation, context, toolsEl, contextText,
  endpoint = '/api/chat',
  getContext = null
} = {}){
  Object.assign(ui, {root, fab, panel, messages, input, send, close, newConversation, context, toolsEl, contextText, endpoint});
  contextHook = getContext || null;

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

export function assistantOpen(){
  return !(ui.root?.hidden ?? true);
}
export function toggleAssistant(open){
  toggle(open);
}
function toggle(open){
  const show = open ?? ui.root.hidden;
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
  // Re-render the context banner whenever the mission config changes.
  if (assistantOpen()) updateContextBanner();
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
  const state = contextHook ? contextHook() : {};
  return {
    site: state.site || null,
    date: state.date || null,
    time: state.time || null,
    days: state.days,
    offsetHours: state.offset,
    inspectionUTC: state.inspectionUTC || (state.base ? new Date(state.base.getTime() + (state.offset || 0) * 3600000).toISOString() : null),
    route: state.route,
    isCustom: Boolean(state.site?.custom),
    terrain: state.terrain ? {
      applied: Boolean(state.terrain),
      source: state.terrain.source || state.terrain.provenance || null,
      verifiedSource: Boolean(state.terrain.verifiedSource),
      coveragePct: state.terrain.coveragePct,
      radiusKm: state.terrain.radiusKm,
      resolutionM: state.terrain.resolutionM,
      azimuthDeg: state.terrain.azimuthDeg,
      elevationDeg: state.terrain.elevationDeg
    } : null,
    simulation: state.simulation ? {
      minimumSocPct: state.simulation.minimumSocPct, endingSocPct: state.simulation.endingSocPct,
      generatedWh: state.simulation.generatedWh, consumedWh: state.simulation.consumedWh,
      unmetWh: state.simulation.unmetWh, unmetHours: state.simulation.unmetHours,
      solarAccessPct: state.simulation.solarAccessPct, earthAccessPct: state.simulation.earthAccessPct,
      dualAccessPct: state.simulation.dualAccessPct, longestAccessGapHours: state.simulation.longestAccessGapHours,
      terrainApplied: state.simulation.terrainApplied
    } : null,
    missionSummary: state.missionSummary || null,
    finder: state.finder ? {startDate: state.finder.startDate, startTime: state.finder.startTime, searchDays: state.finder.searchDays,
      windowDays: state.finder.windowDays, priority: state.finder.priority, terrainMode: state.finder.terrainMode,
      top: state.finder.top} : null,
    terrainProfilesBySite: Object.fromEntries(Object.entries(state.terrainProfiles||{}).map(([id,p])=>[id,{
      azimuthDeg:p.azimuthDeg,elevationDeg:p.elevationDeg,lat:p.lat,lon:p.lon,
      source:p.source,verifiedSource:p.verifiedSource,coveragePct:p.coveragePct,radiusKm:p.radiusKm,resolutionM:p.resolutionM
    }])),
    transit: state.transit ? {
      model: state.transit.model,
      profile: state.transit.profile,
      profileLabel: state.transit.profileLabel,
      destination: state.transit.destination,
      totalTransitHours: state.transit.totalTransitHours,
      departureUTC: state.transit.departureUTC,
      arrivalUTC: state.transit.arrivalUTC,
      scheduleMode: state.transit.scheduleMode
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
/* ---- API round trip ---- */
async function sendMessage(text){
  const userText = text.trim();
  if (!userText || busy) return;
  busy = true;
  ui.input.value = '';
  ui.input.style.height = 'auto';
  pushMessage('user', userText);
  const typing = showTyping();
  ui.send.disabled = true;

  // Compact history for the API round trip.
  const context = collectContext();
  const historyForApi = history.slice(0, -1).map(e => ({role: e.role, text: e.text})).slice(-12);

  try {
    const payload = {message: {role: 'user', text: userText}, history: historyForApi, context};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    let response;
    try {
      response = await fetch(ui.endpoint, {
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

/* ---- session persistence (local, no database on the server) ---- */
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
      // Do not duplicate the welcome message.
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