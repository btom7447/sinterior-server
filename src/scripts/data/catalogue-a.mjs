/**
 * Catalogue content, part A — Cement through Paints.
 *
 * Each item carries its own facts: the grade, the size, the brand, what it is
 * for. Descriptions are composed from those facts rather than written once and
 * pasted, so two bags of cement that differ only in grade read differently —
 * which is the whole point, because on this catalogue the grade is the reason
 * somebody picks one over the other.
 *
 * Prices are 2026 Lagos/Uyo trade prices, rounded to what a merchant would
 * actually quote. They are placeholders in the sense that a supplier will edit
 * them, not in the sense that they are made up.
 */

export const PART_A = {
  Cement: {
    unit: 'bag',
    use: [
      'Suited to foundations, columns and any pour that has to carry load.',
      'Mixes clean for blockwork and general site concrete.',
      'Fine enough for rendering and finishing coats.',
      'Holds its strength in the damp, which matters on a coastal site.',
    ],
    advice: [
      'Store it off the floor and away from the wall — a bag that has taken damp goes hard in the middle and the lump you break up has already lost most of its strength. Cement bought for a pour should be on site days before it, not weeks.',
      'Buy by the pour rather than by the month. Cement has a shelf life measured in weeks once the bag is opened to humidity, and a stack left over the rainy season is a stack you will be throwing away.',
      'Grade is not a marketing number. 42.5R gains strength faster than 32.5 and is what a structural engineer specifies for columns and beams; using the cheaper grade there is a saving you pay back with interest.',
      'Check the bag weight before you accept delivery. Short-weight bags are the oldest trick in this trade, and fifty bags at 48 kg is a bag and a half of cement you paid for and did not receive.',
    ],
    items: [
      { name: 'Dangote 3X 42.5R Portland Cement — 50kg', sub: 'Portland', brand: 'Dangote', price: 9800, blurb: 'The 3X grade Dangote sells for structural work, and the bag most Nigerian sites are built out of', specs: { Grade: '42.5R', 'Bag weight': '50 kg', Type: 'Ordinary Portland' }, weightKg: 50 },
      { name: 'Dangote Falcon 32.5N Cement — 50kg', sub: 'Portland', brand: 'Dangote', price: 8900, blurb: 'The general-purpose grade for blockwork, plastering and non-structural pours', specs: { Grade: '32.5N', 'Bag weight': '50 kg', Type: 'Ordinary Portland' }, weightKg: 50 },
      { name: 'BUA 42.5R Portland Cement — 50kg', sub: 'Portland', brand: 'BUA', price: 9600, blurb: 'BUA’s structural grade, priced a little under Dangote and specified interchangeably by most engineers', specs: { Grade: '42.5R', 'Bag weight': '50 kg', Type: 'Ordinary Portland' }, weightKg: 50 },
      { name: 'BUA 32.5N Cement — 50kg', sub: 'Portland', brand: 'BUA', price: 8700, blurb: 'Everyday grade for walls and screeds where the mix is not carrying structure', specs: { Grade: '32.5N', 'Bag weight': '50 kg' }, weightKg: 50 },
      { name: 'Lafarge Elephant 42.5R Cement — 50kg', sub: 'Portland', brand: 'Lafarge', price: 9900, blurb: 'Lafarge’s Elephant line, consistent bag to bag in a way that matters on a long pour', specs: { Grade: '42.5R', 'Bag weight': '50 kg' }, weightKg: 50 },
      { name: 'Lafarge Supaset Rapid-Hardening Cement — 50kg', sub: 'Rapid-hardening', brand: 'Lafarge', price: 10400, blurb: 'Sets fast enough to strike formwork the next day, which is why it is the culvert and precast cement', specs: { Grade: '42.5R', Setting: 'Rapid', 'Bag weight': '50 kg' }, weightKg: 50 },
      { name: 'Unicem Rapid-Set Cement — 50kg', sub: 'Rapid-hardening', brand: 'Unicem', price: 10200, blurb: 'A rapid-set bag for repairs and small pours that cannot wait a week to take traffic', specs: { Setting: 'Rapid', 'Bag weight': '50 kg' }, weightKg: 50 },
      { name: 'Snowcrete White Portland Cement — 25kg', sub: 'White cement', brand: 'Snowcrete', price: 14500, blurb: 'True white Portland for terrazzo, cast stone and any finish that will be seen rather than covered', specs: { Colour: 'White', 'Bag weight': '25 kg', Use: 'Decorative' }, weightKg: 25 },
      { name: 'Ultratech White Cement — 40kg', sub: 'White cement', brand: 'Ultratech', price: 21000, blurb: 'The white cement most POP and decorative contractors buy by the pallet', specs: { Colour: 'White', 'Bag weight': '40 kg' }, weightKg: 40 },
      { name: 'Weber Tile Adhesive Grey — 25kg', sub: 'Mortar & grout', brand: 'Weber', price: 7200, blurb: 'Cement-based adhesive rated for floor and wall tile up to 600x600 on a sound substrate', specs: { Coverage: '4-5 m² per bag', 'Bag weight': '25 kg', Open_time: '20 minutes' }, weightKg: 25 },
      { name: 'Weber Tile Adhesive White — 25kg', sub: 'Mortar & grout', brand: 'Weber', price: 8100, blurb: 'The white-bodied version, for translucent stone and light grout where grey would shadow through', specs: { Coverage: '4-5 m² per bag', Colour: 'White', 'Bag weight': '25 kg' }, weightKg: 25 },
      { name: 'Mapei Keracolor Wall Grout — 5kg', sub: 'Mortar & grout', brand: 'Mapei', price: 6400, blurb: 'Fine grout for joints up to 6mm, mixed to a stiff paste and worked in diagonally', specs: { 'Joint width': 'up to 6 mm', 'Bag weight': '5 kg' }, weightKg: 5 },
      { name: 'Mapei Keracolor Floor Grout — 20kg', sub: 'Mortar & grout', brand: 'Mapei', price: 18500, blurb: 'The coarser floor grade, for wider joints and traffic that will scrub a wall grout out', specs: { 'Joint width': '4-15 mm', 'Bag weight': '20 kg' }, weightKg: 20 },
      { name: 'Ready-Mix Screed Mortar — 40kg', sub: 'Mortar & grout', brand: 'Sintherior Trade', price: 5600, blurb: 'Sand and cement pre-blended to a screed ratio, so the mix does not change with whoever is holding the shovel', specs: { Ratio: '1:4 pre-blended', 'Bag weight': '40 kg' }, weightKg: 40 },
      { name: 'Block-Laying Mortar Mix — 40kg', sub: 'Mortar & grout', brand: 'Sintherior Trade', price: 5200, blurb: 'A plasticised mortar that stays workable long enough to lay a full course before it stiffens', specs: { Ratio: '1:6 pre-blended', 'Bag weight': '40 kg' }, weightKg: 40 },
      { name: 'Dangote 42.5R — Pallet of 20 bags', sub: 'Portland', brand: 'Dangote', price: 190000, blurb: 'A full pallet, which is how anyone pouring a slab should be buying it', specs: { Grade: '42.5R', Quantity: '20 x 50 kg', 'Pallet weight': '1000 kg' }, weightKg: 1000, unit: 'pallet' },
      { name: 'BUA 42.5R — Pallet of 20 bags', sub: 'Portland', brand: 'BUA', price: 186000, blurb: 'Pallet quantity of BUA’s structural grade, delivered shrink-wrapped', specs: { Grade: '42.5R', Quantity: '20 x 50 kg' }, weightKg: 1000, unit: 'pallet' },
      { name: 'Sulphate-Resistant Cement — 50kg', sub: 'Portland', brand: 'Unicem', price: 11800, blurb: 'For foundations in salty or sulphate-bearing ground, where ordinary Portland slowly comes apart', specs: { Type: 'Sulphate-resistant', 'Bag weight': '50 kg' }, weightKg: 50 },
      { name: 'Waterproof Cement Additive — 20 litre', sub: 'Mortar & grout', brand: 'Weber', price: 24500, blurb: 'Liquid admixture that closes the pores in a render, for tanking basements and wet rooms', specs: { Dosage: '1 litre per bag', Volume: '20 litre' }, weightKg: 21, unit: 'keg' },
      { name: 'Rapid Repair Patch Mortar — 10kg', sub: 'Mortar & grout', brand: 'Mapei', price: 9800, blurb: 'Sets in under an hour for step nosings, kerbs and anything that has to take a foot the same day', specs: { 'Set time': '45-60 minutes', 'Bag weight': '10 kg' }, weightKg: 10 },
    ],
  },

  Aggregates: {
    unit: 'ton',
    use: [
      'Graded for structural concrete where the mix design matters.',
      'Clean enough for plaster without washing on site.',
      'General fill and blinding under a slab.',
      'Drainage and hardcore beneath a floor.',
    ],
    advice: [
      'Aggregate is sold by the trip and argued about by the ton. Agree the tipper size in writing before it leaves the quarry — a "five ton" load that arrives at three and a half is the most common dispute in this trade and impossible to prove once it is on the ground.',
      'Wash and grade matter more than price per ton. Sand carrying clay weakens every bag of cement you mix it with, and the saving on a dirty load is repaid in extra cement across the whole pour.',
      'Order somewhere the tipper can actually reach and tip. A load that has to be barrowed from the road doubles the labour, and on a narrow street the driver will simply refuse and you will pay for the trip anyway.',
      'Buy the fraction the mix calls for. Substituting a coarser stone into a slab because it was on the yard changes the workability and the finish, and the concrete you get is not the concrete the engineer designed.',
    ],
    items: [
      { name: 'Granite Chippings 3/4 inch — per ton', sub: 'Granite', brand: 'Quarry Direct', price: 32000, blurb: 'The standard structural aggregate for slabs, beams and columns', specs: { Size: '19 mm (3/4")', Wash: 'Washed', Use: 'Structural concrete' } },
      { name: 'Granite Chippings 1/2 inch — per ton', sub: 'Granite', brand: 'Quarry Direct', price: 33500, blurb: 'The finer stone for thin sections and heavily reinforced pours where 3/4" would bridge the bars', specs: { Size: '12 mm (1/2")', Wash: 'Washed' } },
      { name: 'Granite Chippings 1 inch — per ton', sub: 'Granite', brand: 'Quarry Direct', price: 31000, blurb: 'Coarse stone for mass concrete and blinding, where the finish is not going to be seen', specs: { Size: '25 mm (1")', Use: 'Mass concrete' } },
      { name: 'Sharp Sand — per ton', sub: 'Sharp sand', brand: 'Quarry Direct', price: 18500, blurb: 'Angular river sand for concrete and screeds, which grips in a way soft sand does not', specs: { Type: 'River sand', Use: 'Concrete, screed', Wash: 'Washed' } },
      { name: 'Sharp Sand — 20 ton tipper', sub: 'Sharp sand', brand: 'Quarry Direct', price: 340000, blurb: 'A full tipper for a slab pour, priced under the per-ton rate as it should be', specs: { Load: '20 tons', Type: 'River sand' }, unit: 'trip' },
      { name: 'Plaster Sand — per ton', sub: 'Plaster sand', brand: 'Quarry Direct', price: 17000, blurb: 'Fine, well-graded sand that renders flat without tearing under the float', specs: { Type: 'Fine graded', Use: 'Plaster, render' } },
      { name: 'Plaster Sand — 20 ton tipper', sub: 'Plaster sand', brand: 'Quarry Direct', price: 310000, blurb: 'Tipper load for rendering a full house, which is roughly what a four-bedroom takes', specs: { Load: '20 tons' }, unit: 'trip' },
      { name: 'Laterite Fill — per ton', sub: 'Laterite', brand: 'Quarry Direct', price: 9500, blurb: 'Red laterite for filling and raising a site before blinding', specs: { Use: 'Fill, sub-base', Type: 'Laterite' } },
      { name: 'Laterite — 20 ton tipper', sub: 'Laterite', brand: 'Quarry Direct', price: 175000, blurb: 'The load size most compound-filling jobs are quoted in', specs: { Load: '20 tons' }, unit: 'trip' },
      { name: 'Stone Dust — per ton', sub: 'Stone dust', brand: 'Quarry Direct', price: 14000, blurb: 'Quarry fines for bedding paving stones and interlocking blocks', specs: { Size: '0-5 mm', Use: 'Paving bed' } },
      { name: 'Hardcore / Crusher Run — per ton', sub: 'Stone dust', brand: 'Quarry Direct', price: 16500, blurb: 'Mixed graded stone that compacts into a solid base under a slab or driveway', specs: { Size: '0-40 mm graded', Use: 'Sub-base' } },
      { name: 'Washed Gravel 3/8 inch — per ton', sub: 'Granite', brand: 'Quarry Direct', price: 34000, blurb: 'Pea gravel for exposed-aggregate finishes and drainage runs', specs: { Size: '10 mm', Wash: 'Washed' } },
      { name: 'Filling Sand — per ton', sub: 'Sharp sand', brand: 'Quarry Direct', price: 11000, blurb: 'Unwashed sand for bulk filling where it is not going anywhere near a cement mix', specs: { Wash: 'Unwashed', Use: 'Bulk fill' } },
      { name: 'Beach Sand — per ton', sub: 'Plaster sand', brand: 'Quarry Direct', price: 12500, blurb: 'Soft sand for mortar, cheaper than river sand and not for structural concrete', specs: { Type: 'Soft sand', Use: 'Mortar' } },
      { name: 'Granite Chippings — 30 ton trailer', sub: 'Granite', brand: 'Quarry Direct', price: 880000, blurb: 'Trailer quantity for a large pour, delivered direct from the quarry', specs: { Load: '30 tons', Size: '19 mm' }, unit: 'trip' },
      { name: 'Interlocking Paving Sand — per ton', sub: 'Stone dust', brand: 'Quarry Direct', price: 15000, blurb: 'Screened bedding sand at the grade paving contractors ask for by name', specs: { Size: '0-4 mm screened' } },
      { name: 'Drainage Gravel 40mm — per ton', sub: 'Granite', brand: 'Quarry Direct', price: 30000, blurb: 'Large clean stone for soakaways and French drains, where fines would clog the run', specs: { Size: '40 mm', Wash: 'Washed clean' } },
      { name: 'Screeding Sand — per ton', sub: 'Plaster sand', brand: 'Quarry Direct', price: 17500, blurb: 'Graded specifically for floor screeds, which want less fines than a render sand', specs: { Use: 'Floor screed', Type: 'Graded' } },
      { name: 'Blinding Sand — per ton', sub: 'Sharp sand', brand: 'Quarry Direct', price: 12000, blurb: 'For the thin levelling layer under a damp-proof membrane', specs: { Use: 'Blinding' } },
      { name: 'Mixed Aggregate Ballast — per ton', sub: 'Granite', brand: 'Quarry Direct', price: 22000, blurb: 'Sand and stone pre-blended for small pours where hiring two loads makes no sense', specs: { Blend: 'Sand + 19 mm stone', Use: 'Small pours' } },
    ],
  },
};
