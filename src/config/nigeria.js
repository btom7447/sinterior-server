/**
 * The 36 states and the FCT, on the server this time.
 *
 * This list already existed in the mobile client, where it fixed a real bug:
 * delivery is priced per state, so "Lagoss" — or "FCT" where the supplier wrote
 * "Abuja" — produced "this supplier has not priced delivery to Lagoss", a true
 * sentence about a place that does not exist, shown to somebody about to spend
 * money.
 *
 * It was only ever a client-side guard. The API still accepts any string as a
 * coverage entry or a shipping-rate key, which means the same class of bug can
 * be written by the web dashboard, by an old app build, or by curl. Putting the
 * list here is what makes the rule true of the data rather than true of one
 * screen.
 *
 * Kept spelled exactly as the mobile list and the supplier dashboard spell
 * them — right down to "FCT Abuja". Two spellings of one place across two
 * surfaces is a rate that exists and cannot be found.
 */

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
  'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
  'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

/**
 * The names people actually use for the same place.
 *
 * The capital is the worst of them: FCT, Abuja, Federal Capital Territory and
 * Abuja FCT are one place with four names, and a lookup that misses means a
 * real delivery quote silently disappears.
 */
const ALIASES = {
  abuja: 'FCT Abuja',
  fct: 'FCT Abuja',
  fctabuja: 'FCT Abuja',
  abujafct: 'FCT Abuja',
  federalcapitalterritory: 'FCT Abuja',
  akwaibom: 'Akwa Ibom',
  crossriver: 'Cross River',
  nassarawa: 'Nasarawa',
  nasarawa: 'Nasarawa',
  portharcourt: 'Rivers',
  ph: 'Rivers',
};

/** Lower-cased letters only, with a trailing "state" dropped. */
export const normaliseState = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/\bstate\b/g, '')
    .replace(/[^a-z]/g, '');

/**
 * The canonical state for anything a human might have written, or null.
 *
 * Null rather than a guess: a state we cannot recognise must fall through to
 * "we have not priced this", never to the wrong state's delivery fee.
 */
export function resolveState(value) {
  if (!value || !String(value).trim()) return null;
  const needle = normaliseState(value);
  if (!needle) return null;

  const exact = NIGERIAN_STATES.find((state) => normaliseState(state) === needle);
  if (exact) return exact;

  return ALIASES[needle] ?? null;
}

/**
 * Everything a supplier meant when they wrote where they deliver.
 *
 * `coverageStates` was a single trimmed string, and the web dashboard offered
 * it as a free-text box — so the values in the database are a mix of one state,
 * several states separated by commas, several separated by "and", and prose.
 * This is what turns any of those into a canonical list.
 *
 * Anything unrecognised is preserved verbatim rather than dropped. A supplier
 * who wrote "South West" has told us something; losing it silently during a
 * migration is worse than carrying a value the picker cannot highlight.
 */
export function parseCoverage(value) {
  if (Array.isArray(value)) {
    return dedupe(value.flatMap((entry) => parseCoverage(entry)));
  }
  if (!value || !String(value).trim()) return [];

  const fragments = String(value)
    .split(/,|\/|\band\b|\+|;|\|/gi)
    .map((part) => part.trim())
    .filter(Boolean);

  return dedupe(fragments.map((fragment) => resolveState(fragment) ?? fragment));
}

/** Order-preserving, case-insensitive de-duplication. */
function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const key = String(entry).toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** True when every entry is a state we recognise. */
export const allRecognised = (list) =>
  Array.isArray(list) && list.every((entry) => resolveState(entry) !== null);
