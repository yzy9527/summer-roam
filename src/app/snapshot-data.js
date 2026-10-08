/** Return detached diagnostic data; snapshots never expose live task state. */
export function snapshotData(value) {
  return structuredClone(value);
}

export const PHASE_HISTORY_LIMIT = 64;
export function recordPhase(history, phase) {
  history.push(phase);
  if (history.length > PHASE_HISTORY_LIMIT) history.shift();
}
