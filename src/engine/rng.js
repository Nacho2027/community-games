// Deterministic seeded RNG so every player sees the same daily content.
export function hashSeed(seed) {
  let value = 2166136261;
  for (const char of String(seed))
    value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function rngFor(seed) {
  let state = hashSeed(seed) || 1;
  return function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export function shuffle(rng, list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function intBetween(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}