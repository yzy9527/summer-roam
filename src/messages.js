// Language-independent descriptions. Gameplay owns the code and raw parameters;
// presentation owns their wording. An empty string means no availability blocker.
/**
 * Language-independent display description. Gameplay may compare codes, never
 * translated sentences; only a view resolves nested descriptions and numbers.
 * @typedef {{code: string, params: Record<string, string|number|Message>}} Message
 */
/** @returns {Message} */
export function message(code, params = {}) {
  return { code, params };
}
