/**
 * vocabulary.js — the controlled tag vocabulary, and the deriver that applies it.
 *
 * Why derived rather than typed: asking an artisan to hand-write hashtags after
 * a twelve-hour job produces empty arrays and misspellings, and free text gives
 * you "POP", "P.O.P", "pop ceiling" and "Pop Celing" as four different tags.
 * So the poster writes a normal title and caption, and the server reads the
 * vocabulary out of it.
 *
 * The vocabulary is deliberately Nigerian and deliberately small. It grows by
 * commit, like the taxonomy, so every tag in the system is one somebody chose.
 *
 * Groups exist because they surface differently: materials and styles make good
 * feed rails, places make good search filters.
 */

/**
 * Each entry: an id (the stored tag), a label for display, and the phrases that
 * produce it. Phrases are matched on word boundaries against the lower-cased
 * text, longest first, so "victoria island" beats "island".
 */
export const VOCABULARY = [
  // ── Materials and finishes ────────────────────────────────────────────────
  { id: 'pop', label: 'POP', group: 'material', match: ['pop', 'p.o.p', 'plaster of paris'] },
  { id: 'screed', label: 'Screed', group: 'material', match: ['screed', 'screeding'] },
  { id: 'terrazzo', label: 'Terrazzo', group: 'material', match: ['terrazzo'] },
  { id: 'acp-cladding', label: 'ACP cladding', group: 'material', match: ['acp', 'aluminium composite', 'cladding'] },
  { id: 'marble', label: 'Marble', group: 'material', match: ['marble'] },
  { id: 'granite', label: 'Granite', group: 'material', match: ['granite'] },
  { id: 'tiles', label: 'Tiles', group: 'material', match: ['tile', 'tiles', 'tiling', 'porcelain', 'ceramic'] },
  { id: 'wpc', label: 'WPC', group: 'material', match: ['wpc', 'wood plastic'] },
  { id: 'gypsum', label: 'Gypsum', group: 'material', match: ['gypsum'] },
  { id: 'plywood', label: 'Plywood', group: 'material', match: ['plywood', 'mdf', 'hdf'] },
  { id: 'hardwood', label: 'Hardwood', group: 'material', match: ['hardwood', 'mahogany', 'iroko', 'teak', 'oak', 'obeche'] },
  { id: 'aluminium', label: 'Aluminium', group: 'material', match: ['aluminium', 'aluminum'] },
  { id: 'stainless', label: 'Stainless', group: 'material', match: ['stainless', 'stainless steel'] },
  { id: 'wrought-iron', label: 'Wrought iron', group: 'material', match: ['wrought iron', 'burglary proof', 'burglar proof'] },
  { id: 'concrete', label: 'Concrete', group: 'material', match: ['concrete', 'sandcrete', 'cement'] },
  { id: 'glass', label: 'Glass', group: 'material', match: ['glass', 'glazing', 'shower cubicle'] },
  { id: 'epoxy', label: 'Epoxy', group: 'material', match: ['epoxy', '3d floor', '3d flooring'] },
  { id: 'vinyl', label: 'Vinyl', group: 'material', match: ['vinyl', 'laminate', 'parquet'] },
  { id: 'wallpaper', label: 'Wallpaper', group: 'material', match: ['wallpaper', 'wall paper', 'wall panel', '3d panel'] },
  { id: 'emulsion', label: 'Emulsion', group: 'material', match: ['emulsion', 'satin paint', 'gloss paint', 'texture paint', 'texcote'] },
  { id: 'upholstery', label: 'Upholstery', group: 'material', match: ['upholstery', 'upholstered', 'sofa', 'couch'] },
  { id: 'lighting', label: 'Lighting', group: 'material', match: ['chandelier', 'led', 'spotlight', 'pendant light', 'cove light'] },
  { id: 'solar', label: 'Solar', group: 'material', match: ['solar', 'inverter', 'battery bank'] },
  { id: 'borehole', label: 'Borehole', group: 'material', match: ['borehole', 'soakaway', 'septic'] },

  // ── Styles ────────────────────────────────────────────────────────────────
  { id: 'modern', label: 'Modern', group: 'style', match: ['modern', 'contemporary'] },
  { id: 'minimalist', label: 'Minimalist', group: 'style', match: ['minimal', 'minimalist'] },
  { id: 'classic', label: 'Classic', group: 'style', match: ['classic', 'classical', 'royal'] },
  { id: 'rustic', label: 'Rustic', group: 'style', match: ['rustic', 'farmhouse'] },
  { id: 'industrial', label: 'Industrial', group: 'style', match: ['industrial', 'exposed brick'] },
  { id: 'luxury', label: 'Luxury', group: 'style', match: ['luxury', 'luxurious', 'premium finish'] },
  { id: 'monochrome', label: 'Monochrome', group: 'style', match: ['monochrome', 'black and white'] },
  { id: 'afrocentric', label: 'Afrocentric', group: 'style', match: ['afrocentric', 'african print', 'ankara', 'adire'] },

  // ── Places ────────────────────────────────────────────────────────────────
  { id: 'lagos', label: 'Lagos', group: 'place', match: ['lagos'] },
  { id: 'lekki', label: 'Lekki', group: 'place', match: ['lekki', 'ajah', 'sangotedo'] },
  { id: 'ikoyi', label: 'Ikoyi', group: 'place', match: ['ikoyi'] },
  { id: 'victoria-island', label: 'Victoria Island', group: 'place', match: ['victoria island', 'v.i', 'vi'] },
  { id: 'ikeja', label: 'Ikeja', group: 'place', match: ['ikeja', 'maryland', 'ogba'] },
  { id: 'yaba', label: 'Yaba', group: 'place', match: ['yaba', 'surulere', 'ebute metta'] },
  { id: 'abuja', label: 'Abuja', group: 'place', match: ['abuja', 'gwarinpa', 'wuse', 'maitama', 'asokoro', 'jabi'] },
  { id: 'port-harcourt', label: 'Port Harcourt', group: 'place', match: ['port harcourt', 'phc', 'rivers state'] },
  { id: 'ibadan', label: 'Ibadan', group: 'place', match: ['ibadan', 'oyo state'] },
  { id: 'benin-city', label: 'Benin City', group: 'place', match: ['benin city', 'edo state'] },
  { id: 'enugu', label: 'Enugu', group: 'place', match: ['enugu'] },
  { id: 'kano', label: 'Kano', group: 'place', match: ['kano'] },
  { id: 'kaduna', label: 'Kaduna', group: 'place', match: ['kaduna'] },
  { id: 'abeokuta', label: 'Abeokuta', group: 'place', match: ['abeokuta', 'ogun state'] },
  { id: 'asaba', label: 'Asaba', group: 'place', match: ['asaba', 'delta state'] },
  { id: 'uyo', label: 'Uyo', group: 'place', match: ['uyo', 'akwa ibom'] },
  { id: 'calabar', label: 'Calabar', group: 'place', match: ['calabar'] },
  { id: 'jos', label: 'Jos', group: 'place', match: ['jos', 'plateau state'] },
];

export const TAG_IDS = VOCABULARY.map((v) => v.id);

/** Public shape for GET /pins/taxonomy — no matcher phrases leak to clients. */
export const TAG_VOCABULARY = VOCABULARY.map(({ id, label, group }) => ({ id, label, group }));

const MAX_TAGS = 10;

// Longest phrases first so a two-word place beats the single word inside it.
const PHRASES = VOCABULARY.flatMap((entry) =>
  entry.match.map((phrase) => ({ id: entry.id, phrase: phrase.toLowerCase() }))
).sort((a, b) => b.phrase.length - a.phrase.length);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Read the vocabulary out of a pin's own words.
 *
 * Matching is on word boundaries, so "vinyl" in "vinyl flooring" counts and
 * the "vi" in "vinyl" does not become Victoria Island.
 */
export function deriveTags(...texts) {
  const haystack = texts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ');
  if (!haystack.trim()) return [];

  const found = new Set();
  for (const { id, phrase } of PHRASES) {
    if (found.has(id)) continue;
    const pattern = new RegExp(`(^|\\W)${escape(phrase)}(\\W|$)`, 'i');
    if (pattern.test(haystack)) found.add(id);
    if (found.size >= MAX_TAGS) break;
  }
  return [...found];
}

/** Keep only tags the vocabulary knows about, deduped and capped. */
export function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((t) => TAG_IDS.includes(t)))].slice(0, MAX_TAGS);
}
