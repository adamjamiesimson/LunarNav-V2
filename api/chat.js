// Gemini mission-assistant API (Vercel serverless function). The API key
// stays server-side (GEMINI_API_KEY; model via GEMINI_MODEL). Function
// calling runs the shared planner maths in src/tools.js so the assistant
// can't invent ephemeris values.
import {GoogleGenAI} from '@google/genai';
import {TOOL_DECLARATIONS,executeTool} from '../src/tools.js';

const ALLOWED_PAGES = new Set(['home','explore','planning','windows','engineering','compare','science']);
const MAX_MESSAGES = 24;
const MAX_CONTEXT_BYTES = 128 * 1024;
const MAX_TOOL_ROUNDS = 8;
const MODEL_TIMEOUT_MS = 25000;
const CIRCUIT_BREAKER_MS = 90 * 1000;

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];
function modelChain(){
  const preferred = (process.env.GEMINI_MODEL || '').trim() || DEFAULT_MODEL;
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || '')
    .split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  const chain = [preferred, ...(fallbacks.length ? fallbacks : DEFAULT_FALLBACK_MODELS)];
  return [...new Set(chain)];
}
// In-process circuit breaker: a model that just failed transiently is tried
// last for a short window (per-isolate on Vercel, so it is a soft guard).
const recentlyFailing = new Map();
function isCircuitOpen(model){
  const until = recentlyFailing.get(model);
  return until != null && until > Date.now();
}
function openCircuit(model){
  recentlyFailing.set(model, Date.now() + CIRCUIT_BREAKER_MS);
}
function orderedModelAttempts(){
  const chain = modelChain();
  return chain.filter(m => !isCircuitOpen(m)).concat(chain.filter(m => isCircuitOpen(m)));
}

/* Context sanitisation: only known, bounded fields reach the model. */
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
function sanitizeProfile(p){
  const n=p?.azimuthDeg?.length;
  if(!Array.isArray(p?.azimuthDeg)||!Array.isArray(p?.elevationDeg)||n<8||n>720||n!==p.elevationDeg.length||
    !p.elevationDeg.every(v=>Number.isFinite(v)&&v>=0&&v<=90)||
    !p.azimuthDeg.every((v,i)=>Number.isFinite(v)&&Math.abs(v-i*360/n)<0.001))return null;
  return {azimuthDeg:[...p.azimuthDeg],elevationDeg:[...p.elevationDeg],
    ...pickNumbers(p,['lat','lon','coveragePct','radiusKm','resolutionM']),
    source:typeof p.source==='string'?p.source.slice(0,120):'User-supplied horizon',verifiedSource:Boolean(p.verifiedSource)};
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
  const profile=sanitizeProfile(terrain);
  if(profile)out.terrainProfile=profile;

  if (context.simulation && typeof context.simulation === 'object'){
    out.simulation = pickNumbers(context.simulation, ['minimumSocPct','endingSocPct','generatedWh','consumedWh','unmetWh','unmetHours','solarAccessPct','earthAccessPct','dualAccessPct','longestAccessGapHours']);
    out.simulation.terrainApplied = Boolean(context.simulation.terrainApplied);
  }
  if (context.missionSummary && typeof context.missionSummary === 'object'){
    out.missionSummary = pickNumbers(context.missionSummary, ['sunPct','earthPct','dualPct','longestBlackoutHours','bestDualHours']);
  }
  if (context.transit && typeof context.transit === 'object' && Number.isFinite(context.transit.totalTransitHours)){
    out.transit = {
      model: String(context.transit.model ?? '').slice(0, 60),
      profile: String(context.transit.profile ?? ''),
      profileLabel: String(context.transit.profileLabel ?? '').slice(0, 60),
      totalTransitHours: Number(context.transit.totalTransitHours),
      departureUTC: typeof context.transit.departureUTC === 'string' ? context.transit.departureUTC.slice(0, 24) : null,
      arrivalUTC: typeof context.transit.arrivalUTC === 'string' ? context.transit.arrivalUTC.slice(0, 24) : null,
      scheduleMode: String(context.transit.scheduleMode ?? '')
    };
  }
  if (context.finder && typeof context.finder === 'object' && Array.isArray(context.finder.top)){
    const finder = context.finder;
    out.finder = {
      startDate: String(finder.startDate ?? '').slice(0, 10),
      startTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(finder.startTime||'') ? finder.startTime : '12:00',
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
      const profile=sanitizeProfile(p);
      if(profile&&Object.keys(out.terrainProfilesBySite).length<5)out.terrainProfilesBySite[id]=profile;
    }
    if (!Object.keys(out.terrainProfilesBySite).length) delete out.terrainProfilesBySite;
  }
  // Guard against an oversized payload.
  if (JSON.stringify(out).length > MAX_CONTEXT_BYTES) return {contextTooLarge:true};
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
const SYSTEM_INSTRUCTION = `You are the LunarNav mission-analysis assistant, an expert analyst inside the LunarNav lunar south-pole mission-planning application.

Your job is to answer planning questions about the user's current mission configuration and the study locations (Mons Mouton, Malapert Region, Shackleton Rim, Faustini Rim, Nobile Region, plus custom coordinates) using the LIVE application state in the context and by CALLING THE PROVIDED TOOLS whenever a question needs real numbers.

Rules you must follow:
- Answer questions specifically about LunarNav and its methodologies. Do not drift into unrelated topics.
- Whenever a question needs any numerical value (ephemeris, percentages, windows, energy, traverse times), call the appropriate tool and use its ACTUAL result. NEVER invent ephemeris values, mission statistics or simulation results.
- Distinguish calculated results from assumptions and estimates. State which model and horizon assumption applied (analytical-screening-v1, 0° geometric horizon or loaded NASA LOLA 20 km local horizon).
- For Earth-to-Moon spacecraft transit questions use estimate_earth_moon_transit, which returns reference-duration planning estimates (direct ~3–4 days, extended low-energy ~7.5 days or a custom duration). Never present it as a trajectory or delta-v solution, and clearly separate lunar arrival / LOI / descent / surface touchdown. This is the spacecraft transfer from Earth to the Moon  -  do NOT confuse it with estimate_surface_traverse, which is a rover driving on the lunar surface between two landing sites.
- Explain the analytical ephemeris limitations: ±~0.5° azimuth/elevation samples, angular uncertainty near the horizon and that geometric Earth visibility is NOT an RF link budget; solar visibility is NOT achievable electrical power.
- Never describe experimental screening as flight-qualified. Never claim a study coordinate is a certified landing site.
- If information is genuinely unavailable (for example a requested site has no terrain loaded), say so clearly.
- Retain conversational context so follow-up questions work.
- Keep answers concise and scientific. Avoid em dashes and Oxford commas. Use Markdown where it helps readability: small ### headers for detailed answers, **bold** for key numbers and bullet lists. Avoid over-long essays.

Available tools: ${TOOL_DECLARATIONS.map(t => t.name).join(', ')}.
When you call a tool, wait for its result, then summarize it in plain scientific language: state what was calculated, what is estimated and the relevant limitations.`;
const buildContextBlock = context => ({
  role: 'user',
  parts: [{text: '[LunarNav live application state: authoritative current data, act on it as-is; do not re-derive unless you call a tool]:\n' + JSON.stringify(context)}]
});

  // Test seam: a runner can swap the SDK constructor via a global. Unused in prod.
function geminiConstructor(){
  return globalThis.__LUNARNAV_GEMINI_CTOR || GoogleGenAI;
}
function buildContents(coreMessage, history, context){
  return [
    buildContextBlock(context),
    ...history,
    {role: 'user', parts: coreMessage.parts}
  ];
}
function modelContent(result){
  return result.candidates?.[0]?.content || null;
}
function geminiErrorStatus(error){
  const direct = Number(error?.status);
  if (direct) return direct;
  // The GenAI SDK surfaces provider failures as raw JSON in message:
  // {"error":{"code":504,...,"status":"DEADLINE_EXCEEDED"}}
  const code = String(error?.message || '').match(/"code"\s*:\s*(\d{3})/);
  return code ? Number(code[1]) : 0;
}
function isTransientGeminiError(error){
  if (!error) return true;
  const status = geminiErrorStatus(error);
  // Retryable: 429 quota/throttle, 5xx capacity (incl. 504 deadline), 404
  // model retired. Auth/validation failures (400/401/403) are never retried.
  if (status === 404){
    return /model.*(?:not|no longer|unavailable|not supported)/i.test(String(error?.message || ''));
  }
  if (status === 429 || (status >= 500 && status < 600)) return true;
  // SDK timeouts / retry exhaustion surface as errors with these hints.
  return /deadline|deadline_exceeded|timeout|abort|retries? exhausted|503|429|504|unavailable|high demand/i.test(String(error?.message || ''));
}
async function generateContentWithTimeout(genAI, model, contents){
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(Object.assign(new Error(`Timed out after ${MODEL_TIMEOUT_MS} ms`), {status: 504}));
    }, MODEL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      genAI.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: {role: 'user', parts: [{text: SYSTEM_INSTRUCTION}]},
          tools: [{functionDeclarations: TOOL_DECLARATIONS}],
          temperature: 0.3,
          maxOutputTokens: 2048,
          httpOptions: {timeout: MODEL_TIMEOUT_MS}
        }
      }),
      timer
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
async function generateContentWithFallback(genAI, contents){
  // Healthy models first; recently failed ones go last so their stall is only
  // paid again after the circuit re-arms.
  const attempts = orderedModelAttempts();
  let lastError = null;
  for (const model of attempts){
    // One quick retry per model for fast transient failures (e.g. a 504 that
    // comes back in seconds). Slow timeouts aren't retried in place (function
    // time budget); the next model takes over instead.
    for (let attempt = 0; attempt < 2; attempt++){
      const started = Date.now();
      try {
        return await generateContentWithTimeout(genAI, model, contents);
      } catch (error){
        lastError = error;
        if (!isTransientGeminiError(error)) throw error;
        openCircuit(model);
        // 429 is per-minute quota: retrying the same model in the same second
        // can't work, so move on immediately. Other transients get one quick
        // retry when they fail fast.
        const quota = geminiErrorStatus(error) === 429 || /resource_exhausted|quota/i.test(String(error?.message || ''));
        if (quota || Date.now() - started >= 8000 || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError || new Error('All configured Gemini models failed');
}
function friendlyModelError(error){
  const detail = String(error?.message || 'unknown error');
  if (/deadline|deadline_exceeded|timed out|timeout|504/i.test(detail)){
    return 'The AI provider timed out before answering. Asking again usually succeeds; history and context are kept for the retry. Provider detail: ' + detail;
  }
  if (/high demand|\bunavailable\b|503|resource_exhausted|\bquota\b|usage limit|\bbusy\b/i.test(detail)){
    return 'The AI service is busy or at its free-tier usage limit right now. Press retry in a few seconds; the app already tries several Gemini models automatically. Provider detail: ' + detail;
  }
  if (/api key|API_KEY|401|403|PERMISSION_DENIED|UNAUTHENTICATED/i.test(detail)){
    return 'Gemini rejected the configured API key or its access. Verify GEMINI_API_KEY on the Vercel deployment. Provider detail: ' + detail;
  }
  return 'The Gemini request failed: ' + detail;
}
export {geminiErrorStatus, isTransientGeminiError, friendlyModelError};
async function runGeminiRoundtrip(coreMessage, history, context){
  const GenAI = geminiConstructor();
  const genAI = new GenAI(process.env.GEMINI_API_KEY);
  let contents = buildContents(coreMessage, history, context);
  const toolTraces = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++){
    const result = await generateContentWithFallback(genAI, contents);
    const text = result.text;
    const calls = result.functionCalls;
    if (!calls || !calls.length) return {text, toolTraces};

    // Keep the model's own reply in history for multi-turn function calling
    // before appending tool results.
    const next = [...contents];
    const model = modelContent(result);
    if (model && Array.isArray(model.parts) && model.parts.length){
      next.push({role: 'model', parts: model.parts.slice()});
    }
    const responseParts = [];
    for (const call of calls){
      const name = String(call.name || '');
      const args = JSON.parse(JSON.stringify(call.args || {}));
      const resultValue = executeTool(name, args, context);
      toolTraces.push({name, ok: resultValue.ok, summary: resultValue.summary});
      responseParts.push({
        functionResponse: {
          name,
          response: resultValue.ok ? resultValue.value : {error: resultValue.error || 'Tool execution failed'}
        }
      });
    }
    if (responseParts.length) next.push({role: 'user', parts: responseParts});
    contents = next;
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
    const apiStatus = geminiErrorStatus(error);
    const status = (apiStatus >= 400 && apiStatus < 500) ? apiStatus
      : /413|429|rate limit|quota/i.test(String(error?.message || '')) ? 429 : 500;
    return res.status(status).json({error: friendlyModelError(error)});
  }
}
