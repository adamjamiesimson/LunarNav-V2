/**
 * Tests the Vercel serverless handler (api/chat.js) contract without making
 * live Gemini calls: the handler is invoked with mocked environment, request
 * and response objects, and a lightweight fake of @google/genai is injected
 * through the documented global test seam. This verifies validation, error
 * paths, function-calling loop behaviour and that the API key never leaks
 * into the client payload.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Stand-in for @google/genai served through the global test seam.
// failModels: an object listing models (or a '*' catch-all) that should throw.
const GeminiFake = {
  fakeCalls: [],
  configure(replyPlan, failModels = null, failError = null){
    GeminiFake.plan = replyPlan;
    GeminiFake.failModels = failModels;
    GeminiFake.failError = failError;
    GeminiFake.fakeCalls = [];
  },
  getFakeCalls(){ return GeminiFake.fakeCalls; }
};
GeminiFake.GoogleGenAI = class {
  constructor(){}
  models = {
    generateContent: async ({model, contents, config}) => {
      GeminiFake.fakeCalls.push({model, contents, config});
      if (GeminiFake.failModels && (GeminiFake.failModels[model] || GeminiFake.failModels['*'])){
        throw GeminiFake.failError || Object.assign(new Error('429 Quota exceeded for Gemini API requests'), {status: 429});
      }
      const candidate = GeminiFake.plan.shift();
      if (!candidate){
        const error = new Error('429 Quota exceeded for Gemini API requests');
        error.status = 429;
        throw error;
      }
      const content = candidate.parts ? {role: 'model', parts: candidate.parts} : undefined;
      return {
        text: candidate.text || (candidate.parts || []).filter(p => p.text != null).map(p => p.text).join(''),
        functionCalls: candidate.functionCalls,
        candidates: [{content}]
      };
    }
  };
};
async function loadHandler(){
  // Test seam documented in api/chat.js: swap the SDK constructor via a global.
  globalThis.__LUNARNAV_GEMINI_CTOR = GeminiFake.GoogleGenAI;
  const mod = await import('../api/chat.js?' + Date.now());
  return {default: mod.default};
}

function makeRes(){
  const res = {_status: 200, _json: null, _headers: {}, _ended: false};
  res.status = code => { res._status = code; return res; };
  res.json = body => { res._json = body; res._ended = true; return res; };
  res.setHeader = (k, v) => { res._headers[k] = v; };
  res.end = () => { res._ended = true; };
  res.getStatus = () => res._status;
  res.getBody = () => res._json;
  return res;
}
function makeReq(method, body){
  return {method, body, headers: {origin: 'http://localhost:4173'}};
}

test('endpoint returns 400 for an invalid / empty request body', async () => {
  const {default: handler} = await loadHandler();
  process.env.GEMINI_API_KEY = 'test-key';
  const res = makeRes();
  await handler(makeReq('POST', {message: {role: 'user', text: '   '}}), res);
  assert.equal(res.getStatus(), 400);
  assert.match(res.getBody().error, /text message/);
});

test('endpoint rejects GET requests with 405 and Allow header', async () => {
  const {default: handler} = await loadHandler();
  const res = makeRes();
  await handler(makeReq('GET', {}), res);
  assert.equal(res.getStatus(), 405);
  assert.equal(res._headers.Allow, 'POST, OPTIONS');
});

test('endpoint returns 500 without a configured API key', async () => {
  const {default: handler} = await loadHandler();
  delete process.env.GEMINI_API_KEY;
  const res = makeRes();
  await handler(makeReq('POST', {message: {text: 'What is the solar elevation?'}}), res);
  assert.equal(res.getStatus(), 500);
  assert.match(res.getBody().error, /GEMINI_API_KEY/);
});

test('endpoint performs a tool call roundtrip for numerical questions', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-test';
  GeminiFake.configure([
    {
      parts: [
        {text: 'Let me calculate that.'},
        {functionCall: {name: 'calculate_celestial_conditions', args: {utcTimestamp: '2026-11-14T12:00:00Z', lat: -84.79, lon: 29.2}}}
      ],
      functionCalls: [{name: 'calculate_celestial_conditions', args: {utcTimestamp: '2026-11-14T12:00:00Z', lat: -84.79, lon: 29.2}}]
    },
    {parts: [{text: 'The solar elevation is 1.4° above the geometric horizon.'}]}
  ]);
  const {default: handler} = await loadHandler();
  const res = makeRes();
  const context = {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7};
  await handler(makeReq('POST', {
    message: {role: 'user', text: 'What is the current solar elevation at Mons Mouton?'},
    context, history: []
  }), res);
  assert.equal(res.getStatus(), 200);
  assert.match(res.getBody().reply, /1\.4/);
  assert.ok(res.getBody().tools.length >= 1, 'tool traces expected');
  assert.equal(res.getBody().tools[0].name, 'calculate_celestial_conditions');
  assert.equal(res.getBody().tools[0].ok, true);
});

test('multiple sequential tool calls are handled in one request', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  GeminiFake.configure([
    {
      parts: [
        {functionCall: {name: 'analyze_mission_window', args: {startUTC: '2026-11-14T12:00:00Z', days: 7, lat: -84.79, lon: 29.2}}},
        {functionCall: {name: 'compare_locations', args: {}}}
      ],
      functionCalls: [
        {name: 'analyze_mission_window', args: {startUTC: '2026-11-14T12:00:00Z', days: 7, lat: -84.79, lon: 29.2}},
        {name: 'compare_locations', args: {}}
      ]
    },
    {parts: [{text: 'Dual access is above 90% and Mons Mouton ranks first.'}]}
  ]);
  const {default: handler} = await loadHandler();
  const res = makeRes();
  await handler(makeReq('POST', {
    message: {role: 'user', text: 'Compare the mission windows'},
    context: {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7},
    history: []
  }), res);
  assert.equal(res.getStatus(), 200);
  const tools = res.getBody().tools;
  assert.ok(tools.length >= 2, 'expected two tool traces');
  assert.deepEqual(tools.map(t => t.name), ['analyze_mission_window', 'compare_locations']);
});

test('Gemini failure surfaces as a structured API error, not a crash', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  GeminiFake.configure([]); // Empty plan -> sendMessage throws.
  const {default: handler} = await loadHandler();
  const res = makeRes();
  await handler(makeReq('POST', {
    message: {role: 'user', text: 'hello'},
    context: {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7},
    history: []
  }), res);
  assert.ok([500, 429].includes(res.getStatus()));
  assert.match(res.getBody().error, /Gemini request failed/);
});

test('transient preferred-model failure falls back to the next model', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.5-flash';
  GeminiFake.configure(
    [{parts: [{text: 'Recovered on the fallback model.'}]}],
    {'gemini-3.8-flash': true}
  );
  const {default: handler} = await loadHandler();
  const res = makeRes();
  await handler(makeReq('POST', {
    message: {role: 'user', text: 'hi'},
    context: {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7},
    history: []
  }), res);
  assert.equal(res.getStatus(), 200);
  assert.match(res.getBody().reply, /Recovered on the fallback model/);
  const modelsTried = GeminiFake.getFakeCalls().map(c => c.model);
  assert.ok(modelsTried.includes('gemini-3.8-flash'));
  assert.ok(modelsTried.includes('gemini-3.5-flash'));
});

test('non-transient Gemini errors are not retried through the fallback chain', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.5-flash';
  const forbiddenError = Object.assign(new Error('API key not valid'), {status: 403});
  GeminiFake.configure(
    [{parts: [{text: 'should not be reached'}]}],
    {'*': true},
    forbiddenError
  );
  const {default: handler} = await loadHandler();
  const res = makeRes();
  await handler(makeReq('POST', {
    message: {role: 'user', text: 'hi'},
    context: {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7},
    history: []
  }), res);
  assert.equal(res.getStatus(), 403);
  // Only the preferred model should have been attempted for a non-transient error.
  const modelsTried = GeminiFake.getFakeCalls().map(c => c.model);
  assert.deepEqual(modelsTried, ['gemini-3.8-flash']);
});

test('404 for a no-longer-available model falls back to the next model', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-2.0-flash';
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.5-flash';
  const retired = Object.assign(new Error('This model models/gemini-2.0-flash is no longer available. Please update your code to use models/gemini-3.8-flash'), {status: 404});
  GeminiFake.configure(
    [{parts: [{text: 'Fell back from a retired model.'}]}],
    {'gemini-2.0-flash': true},
    retired
  );
  const {default: handler} = await loadHandler();
  const res = makeRes();
  await handler(makeReq('POST', {
    message: {role: 'user', text: 'hi'},
    context: {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7},
    history: []
  }), res);
  assert.equal(res.getStatus(), 200);
  assert.match(res.getBody().reply, /Fell back from a retired model/);
  const modelsTried = GeminiFake.getFakeCalls().map(c => c.model);
  assert.deepEqual([...new Set(modelsTried)], ['gemini-2.0-flash', 'gemini-3.5-flash']);
});

test('a 400 validation error from the preferred model is not retried', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.5-flash';
  const badRequest = Object.assign(new Error('Invalid contents role'), {status: 400});
  GeminiFake.configure(
    [{parts: [{text: 'should not be reached'}]}],
    {'*': true},
    badRequest
  );
  const {default: handler} = await loadHandler();
  const res = makeRes();
  await handler(makeReq('POST', {
    message: {role: 'user', text: 'hi'},
    context: {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7},
    history: []
  }), res);
  assert.equal(res.getStatus(), 400);
  const modelsTried = GeminiFake.getFakeCalls().map(c => c.model);
  assert.deepEqual(modelsTried, ['gemini-3.8-flash']);
});

test('context sent to the model is sanitised and excludes secrets', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  GeminiFake.configure([{parts: [{text: 'Understood.'}]}]);
  const {default: handler} = await loadHandler();
  const res = makeRes();
  await handler(makeReq('POST', {
    message: {role: 'user', text: 'state?', },
    context: {
      site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2},
      date: '2026-11-14', time: '12:00', days: 7,
      garbage: 'should be dropped', apiKey: 'sk-secret'
    },
    history: []
  }), res);
  assert.equal(res.getStatus(), 200);
  const sent = JSON.stringify(GeminiFake.getFakeCalls());
  assert.ok(!sent.includes('sk-secret'), 'secrets must not reach the model request');
});