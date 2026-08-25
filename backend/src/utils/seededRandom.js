/**
 * seededRandom.js — Deterministic PRNG for simulated executor outcomes.
 *
 * Uses mulberry32 algorithm seeded by hashing case._id.
 * Same case always resolves to the same simulated outcome on every run,
 * so the batch recovery figure is stable and reproducible.
 */

/**
 * Simple string hash → 32-bit integer.
 * Produces a consistent numeric seed from any string (like a MongoDB ObjectId).
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * mulberry32 — a fast, deterministic 32-bit PRNG.
 * Returns a function that produces a new pseudo-random float [0, 1) on each call.
 *
 * @param {number} seed - A 32-bit integer seed.
 * @returns {function} A function that returns the next pseudo-random number [0, 1).
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded random number generator from a case ID string.
 *
 * @param {string} caseId - The case's _id as a string (e.g., MongoDB ObjectId.toString()).
 * @returns {function} A function that returns deterministic pseudo-random floats [0, 1).
 *
 * Usage:
 *   const rng = createSeededRng(case._id.toString());
 *   const outcome = rng(); // always the same for this case ID
 *   const isPaid = outcome < 0.65; // ~65% chance of "paid"
 */
function createSeededRng(caseId) {
  const seed = hashString(caseId);
  return mulberry32(seed);
}

module.exports = { createSeededRng, hashString, mulberry32 };
