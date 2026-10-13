import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { validateJsonArguments } = require('../neoforge-handshake/mod-call-client.cjs')

/** Only parses and validates a completed model response, before any dispatch. */
export function modelPlan(text, tools) {
  let plan
  const reject = (code, detail = {}) => ({ error: { ok: false, code, mutationDispatched: false,
    ...detail, hint: 'No tool was dispatched. Return one valid JSON object with tool, arguments and reason, matching the tool signature.' } })
  try { plan = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) }
  catch (error) { return reject('trial_model_plan_not_json', { parseError: String(error.message).slice(0, 300),
    expectedShape: { tool: 'tool_name', arguments: {}, reason: 'one sentence' },
    correction: 'tool, arguments and reason are three ROOT fields. Close the arguments object before reason, and close the root object. Return a newly corrected JSON object, not the same rejected text.' }) }
  if (!plan || typeof plan.tool !== 'string' || !plan.arguments || typeof plan.arguments !== 'object' || Array.isArray(plan.arguments)) return reject('trial_model_plan_invalid')
  const tool = tools.find(row => row.name === plan.tool)
  if (!tool) return reject('trial_model_tool_unavailable', { tool: plan.tool })
  const normalizations = []
  // Reason is host-only diagnostics, never a native argument. Accept either
  // envelope location without asking the model to regenerate the game action.
  if (typeof plan.arguments.reason === 'string' && !Object.hasOwn(tool.parameters.properties || {}, 'reason')) {
    const { reason, ...args } = plan.arguments
    plan = { ...plan, arguments: args, reason: plan.reason ?? reason }
    normalizations.push('reason_metadata_hoisted')
  }
  try { validateJsonArguments(plan.arguments, tool.parameters) }
  catch (error) {
    if (!String(error.code || '').startsWith('MOD_CALL_')) throw error
    return reject('trial_model_tool_arguments_invalid', { field: error.field ?? null,
      missingFields: error.missingFields ?? [], inputCode: error.code, tool: plan.tool })
  }
  return { plan, ...(normalizations.length ? { normalizations } : {}) }
}
