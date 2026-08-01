/**
 * The shop's second level.
 *
 * Fifteen categories is enough to file everything and not enough to find
 * anything: "Tiles & Flooring" is four unrelated trades, and a buyer who wants
 * vinyl should not scroll past three hundred porcelain tiles to reach it.
 *
 * Subcategory has been on the Product schema since the beginning, accepted by
 * create and update, and populated by nothing — because there was no list to
 * choose from. This is that list.
 *
 * Deliberately a fixed vocabulary rather than free text. Free-text subcategories
 * produce "Porcelain", "porcelain tiles" and "Porcelian" within a week, and a
 * filter over them matches none of the three.
 */
export const SUBCATEGORIES = {
  Cement: ['Portland', 'Rapid-hardening', 'White cement', 'Mortar & grout'],
  Aggregates: ['Granite', 'Sharp sand', 'Plaster sand', 'Laterite', 'Stone dust'],
  'Steel & Iron': ['Reinforcement rods', 'Binding wire', 'Mesh', 'Beams & angles', 'Nails'],
  'Tiles & Flooring': ['Porcelain', 'Ceramic', 'Vinyl & SPC', 'Terrazzo', 'Skirting', 'Adhesive'],
  Paints: ['Emulsion', 'Oil & gloss', 'Texture & screed', 'Primer & undercoat', 'Waterproofing'],
  'Roofing & Ceiling': ['Aluminium sheets', 'Stone-coated', 'Long-span', 'PVC ceiling', 'POP ceiling'],
  Walls: ['POP & screeding', 'Plaster', 'Blocks & bricks', 'Cladding'],
  Panels: ['WPC', 'Fluted', 'Acoustic', '3D panels'],
  Doors: ['Flush', 'Security', 'Sliding & glass', 'Frames', 'Handles & locks'],
  Wallpaper: ['Vinyl', 'Textured', 'Murals', 'Adhesive & tools'],
  'Lightings & Electrical': [
    'Ceiling & panel',
    'Chandeliers',
    'Outdoor',
    'Cables',
    'Switches & sockets',
    'Distribution boards',
  ],
  Plumbing: ['Pipes & fittings', 'Sanitaryware', 'Taps & mixers', 'Sinks', 'Water storage', 'Pumps'],
  'Smart Home': ['Locks', 'Cameras', 'Lighting', 'Sensors', 'Controls'],
  'Wood & Timber': ['Hardwood', 'Plywood', 'MDF & chipboard', 'Skirting & mouldings'],
  Furniture: ['Seating', 'Tables', 'Storage', 'Beds', 'Outdoor'],
};

/** Whether a subcategory belongs to the category it was filed under. */
export function isValidSubcategory(category, subcategory) {
  if (!subcategory) return true;
  const list = SUBCATEGORIES[category];
  return Array.isArray(list) && list.includes(subcategory);
}

export const CATEGORIES = Object.keys(SUBCATEGORIES);
