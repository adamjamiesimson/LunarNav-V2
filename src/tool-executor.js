/**
 * Browser-side entry point for the shared Gemini tool layer (src/tools.js).
 * All tool calculations live in tools.js : the server API and any in-browser
 * caller run the exact same implementation and cannot drift.
 */
import {executeTool, TOOL_DECLARATIONS} from './tools.js';

export {TOOL_DECLARATIONS};

let contextHook = null;

/** Attach the live application state (set up once by the caller). */
export function configureAssistantState(hook){ contextHook = hook; }
export function currentAssistantContext(){
  return typeof contextHook === 'function' ? contextHook() : {};
}

/** Execute a declared tool; failures are returned as structured results. */
export function executeBrowserTool(name, args = {}, context = currentAssistantContext()){
  // The app keeps the current site's terrain profile under `terrain`;
  // the shared tools read it as `terrainProfile`.
  const ctx = context?.terrain && !context.terrainProfile && Array.isArray(context.terrain.azimuthDeg)
    ? {...context, terrainProfile: context.terrain}
    : context;
  return executeTool(name, args, ctx);
}
