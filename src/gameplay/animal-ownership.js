/** @typedef {'task-yield'|'heist'|'rescue-defense'|'corral'|'plough'|'recapture'} TransportOwner */
/** @typedef {{transportOwner?: TransportOwner}} TransportAnimal */
const owners = new Set(['task-yield', 'heist', 'rescue-defense', 'corral', 'plough', 'recapture']);
/** Transfer only from the expected owner. Domain controllers own pose/collision cleanup. */
export function transferAnimal(animal, expected, next) {
  if (!animal || !owners.has(next) || animal.transportOwner !== expected) return false;
  animal.transportOwner = next;
  return true;
}
/** @param {TransportAnimal} animal @param {TransportOwner} owner */
export function claimAnimal(animal, owner) {
  return transferAnimal(animal, undefined, owner);
}
/** Release only the caller's reservation; never clear a later task's claim. */
export function releaseAnimal(animal, owner) {
  if (!animal || animal.transportOwner !== owner) return false;
  delete animal.transportOwner;
  return true;
}
