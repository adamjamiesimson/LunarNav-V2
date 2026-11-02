/**
 * LunarNav Gemini mission-assistant API (Vercel serverless function).
 *
 * The Gemini API key never reaches the browser: it is read here from the
 * GEMINI_API_KEY environment variable. The model (default gemini-2.0-flash)
 * is configurable through GEMINI_MODEL. Gemini's native function-calling is
 * used to execute the same LunarNav calculation modules the planner runs in
 * the browser (src/tools.js), so the assistant never invents ephemeris values.
 */
import {GoogleGenerativeAI} from '@google/generative-ai';
import {TOOL_DECLARATIONS,executeTool} from '../src/tools.js';

const ALLOWED_PAGES = new Set(['home','explore','windows','engineering','compare','science']);
const MAX_MESSAGES = 24;
const MAX_CONTEXT_BYTES = 24 * 1024;
const MAX_TOOL_ROUNDS = 8;

/* ---- Context sanitisation: only known, bounded fields reach the model ---- */
function pickNumbers(object, keys){
  const out = {};
  for (const k of keys){
    const v = object[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
function pickNumber(object, key){
  return Number.isFinite(Number(object?.[key])) ? Number(object[key]) : null;
}
function sanitizeContext(raw){
  const context = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (context.site && /^[a-z0-9-]{1,40}$/i.test(String(context.site.id || ''))){
    out.site = {
      id: String(context.site.id),
      name: String(context.site.name ?? 'Selected site').slice(0, 60),
      lat: Number(context.site.lat),
      lon: Number(context.site.lon)
    };
  }
  if (Number.isFinite(Number(context.days))) out.days = Math.round(Number(context.days));
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(context.date || ''))) out.date = String(context.date);
  if (/^\d\d:\d\d$/.test(String(context.time || ''))) out.time = String(context.time);
  if (Number.isFinite(Number(context.offsetHours))) out.offsetHours = Number(context.offsetHours);
  if (typeof context.inspectionUTC === 'string' && /^\d{4}-\d{2}-\d{2}T\d\d:\d\d/.test(context.inspectionUTC)) out.inspectionUTC = context.inspectionUTC;
  if (ALLOWED_PAGES.has(String(context.route))) out.route = String(context.route);
  if (context.isCustom) out.isCustom = true;

  const terrain = context.terrain && typeof context.terrain === 'object' ? context.terrain : null;
  if (terrain){
    out.terrain = {
      applied: Boolean(terrain.applied),
      source: typeof terrain.source === 'string' ? terrain.source.slice(0, 120) : null,
      verifiedSource: Boolean(terrain.verifiedSource),
      coveragePct: pickNumber(terrain, 'coveragePct'),
      radiusKm: pickNumber(terrain, 'radiusKm'),
      resolutionM: pickNumber(terrain, 'resolutionM')
    };
  }
  const profile = terrain && Array.isArray(terrain.azimuthDeg) && Array.isArray(terrain.elevationDeg) &&
    terrain.azimuthDeg.length >= 8 && terrain.azimuthDeg.length === terrain.elevationDeg.length &&
    terrain.elevationDeg.every(v => Number.isFinite(v) && v >= 0 && v <= 90)
    ? terrain : null;
  if (profile) out.terrainProfile = {azimuthDeg: profile.azimuthDeg.slice(0, 144), elevationDeg: profile.elevationDeg.slice(0, 144)};

  if (context.simulation && typeof context.simulation === 'object'){
    out.simulation = pickNumbers(context.simulation, ['minimumSocPct','endingSocPct','generatedWh','consumedWh','unmetWh','unmetHours','solarAccessPct','earthAccessPct','dualAccessPct','longestAccessGapHours']);
    out.simulation.terrainApplied = Boolean(context.simulation.terrainApplied);
  }
  if (context.missionSummary && typeof context.missionSummary === 'object'){
    out.missionSummary = pickNumbers(context.missionSummary, ['sunPct','earthPct','dualPct','longestBlackoutHours','bestDualHours']);
  }
  if (context.finder && typeof context.finder === 'object' && Array.isArray(context.finder.top)){
    const finder = context.finder;
    out.finder = {
      startDate: String(finder.startDate ?? '').slice(0, 10),
      searchDays: Number(finder.searchDays) || 0,
      windowDays: Number(finder.windowDays) || 0,
      priority: String(finder.priority ?? 'balanced'),
      terrainMode: finder.terrainMode === 'terrain' ? 'terrain' : 'flat',
      top: finder.top.slice(0, 6).map(w => ({
        siteId: String(w.siteId ?? '').slice(0, 32),
        siteName: String(w.siteName ?? '').slice(0, 48),
        startDate: String(w.startDate ?? '').slice(0, 10),
        ...pickNumbers(w, ['sunPct','earthPct','dualPct','score','longestDarknessHours'])
      }))
    };
  }
  if (context.terrainProfilesBySite && typeof context.terrainProfilesBySite === 'object'){
    out.terrainProfilesBySite = {};
    for (const [id, p] of Object.entries(context.terrainProfilesBySite)){
      if (p && Array.isArray(p.azimuthDeg) && Array.isArray(p.elevationDeg) &&
          p.azimuthDeg.length >= 8 && p.azimuthDeg.length === p.elevationDeg.length &&
          p.elevationDeg.every(v => Number.isFinite(v) && v >= 0 && v <= 90) &&
          Object.keys(out.terrainProfilesBySite).length < 5){
        out.terrainProfilesBySite[id] = {azimuthDeg: p.azimuthDeg.slice(0, 144), elevationDeg: p.elevationDeg.slice(0, 144)};
      }
    }
    if (!Object.keys(out.terrainProfilesBySite).length) delete out.terrainProfilesBySite;
  }
  // Guard against an oversized payload.
  if (JSON.stringify(out).length > MAX_CONTEXT_BYTES) out.contextTooLarge = true;
  return out;
}
function sanitizeMessages(messages){
  if (!Array.isArray(messages)) return [];
  const clean = [];
  for (let i = 0; i < messages.length && clean.length < MAX_MESSAGES; i++){
    const m = messages[i];
    if (!m || typeof m !== 'object') continue;
    const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
    const text = String(m.parts?.[0]?.text ?? m.text ?? m.content ?? '').slice(0, 12000);
    if (text.trim()) clean.push({role, parts: [{text}]});
  }
  return clean;
}
const SYSTEM_INSTRUCTION = `You are the LunarNav mission-analysis assistant, an expert analyst inside the LunarNav V2 lunar south-pole mission-planning application.

Your job is to answer planning questions about the user's current mission configuration and the study locations (Mons Mouton, Malapert Region, Shackleton Rim, Faustini Rim, Nobile Region, plus custom coordinates) using the LIVE application state in the context and by CALLING THE PROVIDED TOOLS whenever a question needs real numbers.

Rules you must follow:
- Answer questions specifically about LunarNav and its methodologies. Do not drift into unrelated topics.
- Whenever a question needs any numerical value (ephemeris, percentages, windows, energy, traverse times), call the appropriate tool and use its ACTUAL result. NEVER invent ephemeris values, mission statistics or simulation results.
- Distinguish calculated results from assumptions and estimates. State which model and horizon assumption applied (analytical-screening-v1, 0° geometric horizon, or loaded NASA LOLA 20 km local horizon).
- Explain the analytical ephemeris limitations: ±~0.5° azimuth/elevation samples, angular uncertainty near the horizon, and that geometric Earth visibility is NOT an RF link budget; solar visibility is NOT achievable electrical power.
- Never describe experimental screening as flight-qualified. Never claim a study coordinate is a certified landing site.
- If information is genuinely unavailable (for example a requested site has no terrain loaded), say so clearly.
- Retain conversational context so follow-up questions work.
- Keep answers concise and scientific. Use Markdown where it helps readability: small ### headers for detailed answers, **bold** for key numbers, and bullet lists. Avoid over-long essays.

Available tools: ${TOOL_DECLARATIONS.map(t => t.name).join(', ')}.
When you call a tool, wait for its result, then summarize it in plain scientific language: state what was calculated, what is estimated, and the relevant limitations.`;
const buildContextBlock = context => ({
  role: 'user',
  parts: [{text: '[LunarNav live application state — authoritative current data, act on it as-is; do not re-derive unless you call a tool]:\n' + JSON.stringify(context)}]
});

/** Test seam: tests may swap the SDK constructor via a global (never used in prod). */
function geminiConstructor(){
  return globalThis.__LUNARNAV_GEMINI_CTOR || GoogleGenerativeAI;
}
async function runGeminiRoundtrip(coreMessage, history, context){
  const GenAI = geminiConstructor();
  const genAI = new GenAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const model = genAI.getGenerativeModel({model: modelName});
  const chat = model.startChat({
    history: [buildContextBlock(context), ...history],
    systemInstruction: {parts: [{text: SYSTEM_INSTRUCTION}]},
    generationConfig: {temperature: 0.3, maxOutputTokens: 2048}
  });
  let currentParts = coreMessage.parts;
  const toolTraces = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++){
    const result = await chat.sendMessage(currentParts);
    const content = result.response.candidates?.[0]?.content;
    const parts = content?.parts || [];
    const toolCalls = parts.filter(p => p.functionCall);
    const text = parts.filter(p => p.text !== undefined).map(p => p.text).join('');
    if (!toolCalls.length) return {text, toolTraces};
    const responses = [];
    for (const call of toolCalls){
      const name = String(call.functionCall?.name || '');
      const args = JSON.parse(JSON.stringify(call.functionCall?.args || {}));
      const resultValue = executeTool(name, args, context);
      toolTraces.push({name, ok: resultValue.ok, summary: resultValue.summary});
      responses.push({functionResponse: {
        name,
        response: resultValue.ok ? resultValue.value : {error: resultValue.error || 'Tool execution failed'}
      }});
    }
    currentParts = responses;
  }
  throw new Error('Gemini function calling did not settle within ' + MAX_TOOL_ROUNDS + ' rounds');
}

export default async function handler(req, res){
  if (req.method === 'OPTIONS'){
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({error: 'Method not allowed. Use POST.'});
  }
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_API_KEY.trim()){
    return res.status(500).json({error: 'Gemini API key is not configured on the server (GEMINI_API_KEY).'});
  }
  const appOrigin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', appOrigin);
  res.setHeader('Vary', 'Origin');

  const body = req.body || {};
  const message = sanitizeMessages([body.message])[0];
  if (!message){
    return res.status(400).json({error: 'A non-empty text message is required.'});
  }
  const context = sanitizeContext(body.context || {});
  const history = sanitizeMessages(body.history);
  try {
    const result = await runGeminiRoundtrip(message, history, context);
    return res.status(200).json({reply: result.text, tools: result.toolTraces});
  } catch (error){
    const status = /413|429|rate limit|quota/i.test(String(error.message)) ? 429 : 500;
    return res.status(status).json({error: 'The Gemini request failed: ' + (error.message || 'unknown error')});
  }
}