/**
 * Feed content for the two artisans whose test pins were cleared.
 *
 * Written to their actual declared trades — Benjamin Tom does painting and
 * finishing, Adoram Tom does wall decoration — because a feed where a painter
 * posts plumbing is a feed nobody believes.
 *
 * Each caption is two paragraphs: what the job was, then what was actually
 * involved in doing it. The second paragraph is the one that matters. A photo of
 * a finished wall tells you nothing about whether the person who made it knows
 * what they are doing; "three coats because the screeding was still green"
 * tells you everything, and it is the difference between a portfolio and an
 * advert.
 *
 * mediaUrl is filled in by the seeder from the category artwork already on
 * Cloudinary. These are placeholders and are meant to look like it.
 */

export const PINS_BY_TRADE = {
  // ── Benjamin Tom — Painting & Finishing ────────────────────────────────────
  painting: [
    {
      title: 'Duplex repaint, Lekki Phase 1',
      room: 'whole-home',
      budget: 850_000_00,
      caption:
        'Full interior repaint of a four-bedroom duplex — walls, ceilings, all the joinery and the two staircases. The client wanted to move from the builder\'s magnolia to a warm off-white throughout, with the stairwell picked out a shade darker so the double height reads as deliberate rather than as an accident of the floor plan.\n\nThe honest part of this job was the preparation, which took longer than the painting. Six years of hairline cracking along the block joints had to be raked out, filled and sanded flat before a brush touched anything, and the previous coat was a cheap vinyl that had chalked badly on the south elevation — everything got a sealer coat first or the new emulsion would have soaked in unevenly and burned off in patches. Two full coats over that, cut in by hand. Nine working days with three of us.',
    },
    {
      title: 'Textured feature wall, Victoria Island apartment',
      room: 'living-room',
      budget: 180_000_00,
      caption:
        'Single feature wall in a sitting room, done in a trowel-applied lime texture with a soft horizontal drag. The client had seen something similar in a hotel lobby and wanted it behind the sofa without the room turning into a hotel lobby, so we kept the movement subtle and the colour close to the surrounding walls — it reads as texture rather than as a different wall.\n\nThis finish lives or dies on the substrate. The wall had been screeded but not sanded, and every ridge under the float would have shown through a 2mm coat, so it came back to flat first. Three passes: a base coat, a textured pass while it was still open, and a burnished pass the following morning once it had firmed enough to take pressure without tearing. Sealed with a matt wax so it can be wiped.',
    },
    {
      title: 'Exterior repaint and waterproofing, Ajah',
      room: 'exterior-compound',
      budget: 1_200_000_00,
      caption:
        'Whole exterior of a two-storey house that had not been touched since it was built. Weathershield over the whole elevation, with the parapet and the flat roof upstand tanked properly first because that was where the water was actually getting in — the client had been repainting the inside of the same bedroom for three years without ever fixing the cause.\n\nWe pressure-washed everything back to sound render, cut out and rebuilt about four square metres of blown plaster on the north-west corner, and let it cure a full week before priming. The waterproofing is an acrylic membrane at 1.5mm dry film, taken 300mm up the parapet and dressed into the outlet. The paint on top is a five-to-seven-year exterior grade rather than the interior emulsion that was on it, which is why it had chalked to powder in three.',
    },
    {
      title: 'Spray-finished wardrobes, Ikoyi',
      room: 'bedroom',
      budget: 420_000_00,
      caption:
        'Six built-in wardrobe fronts sprayed in a satin off-white, on site, in an occupied flat. The carpenter had hung them in primed MDF and the client did not want the brushed finish that would have come with painting them in place — sprayed is flat in a way a brush never is, and on a big plain door front you see every brush mark from across the room.\n\nSpraying inside a furnished flat is mostly masking. A full day sheeting the room, taping the carcasses and building a temporary extract at the window before any material was mixed. Two thin coats with a light denib between, each one going off in about ninety minutes in that heat. The doors came off their hinges and went back on the same evening, which is the only reason the client could sleep in the room that night.',
    },
    {
      title: 'Nursery mural and soft finish, Chevron',
      room: 'bedroom',
      budget: 145_000_00,
      caption:
        'A hand-painted savannah scene across one wall of a nursery, with the other three in a low-sheen washable emulsion. The brief was "not cartoonish" — the animals are painted flat and slightly abstracted rather than outlined, so it will still look right when the child is seven rather than needing to be painted over at three.\n\nEverything in this room is a low-VOC paint, which the client asked for specifically and which I would have suggested anyway for a room a baby sleeps in. The mural is emulsion rather than acrylic artist\'s paint so it can be touched up in years to come from a tin off a shelf, and I left the client 500ml of each colour labelled with where it went. Four days, most of it drying time between the base and the detail.',
    },
    {
      title: 'Screeding and paint, new-build shell, Sangotedo',
      room: 'whole-home',
      budget: 950_000_00,
      caption:
        'Three-bedroom bungalow taken from bare plaster to finished paint. Full screeding throughout — two coats of putty, sanded — then sealer and two coats of emulsion, with the wet areas in a fungicidal soft sheen and the joinery in a satin enamel.\n\nOn a new build the temptation is to start painting the week the plaster looks dry, and it is a mistake that costs the client the whole job. Fresh render is still giving up water and alkali for weeks; paint applied over it lifts, and the alkali burns the colour out in patches you only see when the light moves. We waited three weeks from the last coat of render, tested with a moisture meter rather than by eye, and sealed with a proper alkali-resisting primer before anything decorative went on.',
    },
    {
      title: 'Metallic accent wall, home office, Ikeja GRA',
      room: 'office-shop',
      budget: 165_000_00,
      caption:
        'A bronze metallic finish on the wall behind a desk, done so it shifts as you move past it rather than sitting flat. The rest of the room stayed in a deep matt charcoal so the one wall does the work — a whole room in metallic is exhausting to sit in for eight hours.\n\nMetallic emulsion shows every lap mark, so this cannot be rolled the way ordinary paint is. It went on in a cross-hatched pattern with a short-nap roller, wall completed wet-edge in a single session, no stopping for lunch halfway up. The base coat underneath is tinted close to the metallic so any thin spot reads as depth rather than as a miss. One long day, and it has to be one person start to finish or the two hands show.',
    },
    {
      title: 'Church hall repaint, Uyo',
      room: 'office-shop',
      budget: 680_000_00,
      caption:
        'Full repaint of a hall that seats about three hundred, done over two weekends so nothing interrupted services. Walls in a durable soft sheen rather than matt, because a room that many people pass through gets touched constantly and matt cannot be cleaned without polishing itself.\n\nThe ceiling was the real work — twelve metres up, on a tower scaffold that had to be built and struck each day so the hall could be used on the Sunday. We coated in bays working away from the door so nothing was cut off, and everything below was sheeted every evening. The colour is the same white the congregation had before; they were clear that they wanted it to look cared for, not different.',
    },
    {
      title: 'Anti-mould treatment and repaint, Surulere',
      room: 'bathroom',
      budget: 95_000_00,
      caption:
        'Two bathrooms in a flat where the paint had been going black around the ceiling within months of every repaint. The previous decorator had been painting over it each time, which buries the growth and guarantees it comes back through.\n\nWe washed everything down with a fungicidal solution and left it to work rather than rinsing straight away, cut out a small area of ceiling plaster that had gone soft, and made the actual fix — the extract fan in the larger bathroom was ducted into the ceiling void rather than out through the wall, which is to say it was moving the moisture two feet and dumping it. Re-ducted it properly, then two coats of anti-mould emulsion. It is the ducting that fixed this, not the paint.',
    },
    {
      title: 'Colour consultation and sample boards, Banana Island',
      room: 'whole-home',
      budget: 75_000_00,
      caption:
        'Not a painting job — a colour scheme for a client who had been sent a mood board by an interior designer abroad and could not tell how it would behave in Lagos light. Nine full-size sample boards, two coats each, moved around the house over three days so she could see them morning and evening in each room.\n\nThis is worth doing before you buy forty litres of anything. Two of the greys on that board went distinctly blue under the afternoon light coming off the water, and the warm white she had been sure about read as dirty cream against the marble that was already installed. We changed four of the nine. The boards cost a fraction of one wrong room, and she still has them in the store for touch-ups.',
    },
  ],

  // ── Adoram Tom — Wall Decoration ───────────────────────────────────────────
  'wall-decoration': [
    {
      title: 'Fluted oak TV wall, Lekki',
      room: 'living-room',
      budget: 480_000_00,
      caption:
        'A full-height fluted WPC wall behind a wall-mounted television, with a recessed channel for the screen and a shadow gap at floor and ceiling so the panelling reads as a free-standing plane rather than as cladding stuck to a wall.\n\nThe setting out is the whole job. I centred the flutes on the television rather than on the wall, because the screen is what the eye measures everything against — centring on the wall would have left the TV visibly off by half a flute and it would have bothered the client forever without them knowing why. Battens at 400mm centres, packed level off a wall that was 18mm out over three metres, and every cable dropped inside the void before the panels went on. Two days for two of us.',
    },
    {
      title: 'POP ceiling with cove lighting, Ajah',
      room: 'living-room',
      budget: 620_000_00,
      caption:
        'A stepped POP ceiling in a sitting room, with a continuous cove holding a warm LED strip around the perimeter and a flat central field left plain for a pendant. The client had asked for "the design with the light inside it" and had a photo, which is how most of these start.\n\nThe part worth knowing is the cove depth. A shallow cove throws a hard line up the wall and you see the individual LEDs as dots; this one is 180mm deep with the strip set back 60mm from the lip, which gives an even wash with no hotspots. We also ran a separate switched circuit for it — cove lighting on the same switch as the main light is cove lighting nobody ever uses, because the whole point is having it on when the main light is off.',
    },
    {
      title: '3D wall panels, master bedroom, Ikoyi',
      room: 'bedroom',
      budget: 210_000_00,
      caption:
        'Wave-profile 3D panels across the headboard wall, filled, sanded at the joints and painted so the whole wall reads as one moulded surface rather than as twenty separate tiles stuck up.\n\nThat filling step is what most people skip and it is the entire difference. Straight out of the box these panels leave a visible seam every 500mm; taken properly they need the joints caulked, filled, sanded flush and then the whole wall sprayed or rolled in one pass. We used a flexible filler rather than a rigid one because the wall behind is blockwork and it does move a little. Painted in the same colour as the surrounding walls in a matt finish, so it is texture and shadow rather than a feature fighting the room.',
    },
    {
      title: 'Wallpaper hang, formal sitting room, Maitama',
      room: 'living-room',
      budget: 340_000_00,
      caption:
        'Twelve rolls of a heavy vinyl damask in a formal sitting room, hung around two windows and a chimney breast. The pattern has a 53cm repeat, which on a 3.2 metre ceiling means real waste and has to be planned before the first cut.\n\nI hung the chimney breast first and worked outwards in both directions so the pattern is centred on the feature everyone looks at, and the inevitable mismatched joint landed behind where the curtains stack. All twelve rolls were checked for batch number before we started — two batches of the same paper are two different colours, and you only find out once four drops are up and dry. Walls were lined first, because the blockwork behind had been screeded unevenly and paper telegraphs everything under it.',
    },
    {
      title: 'Stone cladding to entrance pillars, Asokoro',
      room: 'exterior-compound',
      budget: 780_000_00,
      caption:
        'Split slate ledgestone to two gate pillars and the return walls either side, with a cast coping on top. The client wanted the entrance to read as solid stone rather than as painted block, which is most of what a gate does for a house from the street.\n\nExterior cladding has to be able to dry. We fixed to a rendered and tanked substrate with a proper external adhesive, left a drainage gap at the base rather than bedding it tight to the ground, and pointed with a flexible mortar rather than a rigid one. Stone bedded straight onto unprepared blockwork traps water behind it, and the first sign is efflorescence bleeding white down the face within a season. The coping oversails by 40mm with a drip groove underneath so rain leaves the wall instead of running down it.',
    },
    {
      title: 'Acoustic slat wall, home studio, Gwarinpa',
      room: 'office-shop',
      budget: 395_000_00,
      caption:
        'Timber slat panels on acoustic felt across two walls of a small home studio, with mineral wool behind the battens rather than an air gap. The client records voice, and the room had a slap echo between the two parallel hard walls that made everything sound like it was recorded in a corridor.\n\nSlat panels sold as acoustic treatment do very little on their own — the felt backing absorbs some high frequency and that is about it. The absorption in this room is the 50mm mineral wool sitting in the batten cavity behind them; the slats are what makes it look like a room somebody chose to be in rather than a padded cell. We left one wall untreated deliberately, because a fully dead room is unpleasant to work in and the client wanted to be able to hear themselves think.',
    },
    {
      title: 'Marble-effect PVC to bathroom walls, VI',
      room: 'bathroom',
      budget: 285_000_00,
      caption:
        'Large-format marble-effect PVC sheet to a guest bathroom, floor to ceiling, with silicone-sealed internal corners and no grout lines anywhere. The client had a book-matched marble in mind and a budget that was not going to reach it.\n\nThis material is far more forgiving than tile in a small room — no joints to keep clean, and the whole wall goes up in an afternoon — but it is unforgiving about the substrate, because a 3mm sheet follows every undulation behind it. The walls were skimmed flat first. Sheets bonded with a solvent-free adhesive and back-fixed at the top edge, corners cut on site and closed with a colour-matched silicone rather than a trim, which is what stops it looking like cladding.',
    },
    {
      title: 'Brick slip feature wall, restaurant, Wuse',
      room: 'office-shop',
      budget: 1_100_000_00,
      caption:
        'Reclaimed-look brick slips across the full length of a restaurant dining wall, about forty square metres, with a raked joint and a matt sealer over the top so it can be cleaned without darkening.\n\nCommercial work has a different constraint: it had to be done in the eight days between the fit-out finishing and the opening, working nights. We set out from the sight line as you come through the door rather than from a corner, so the cut slips landed at the service end where nobody sits. The joints are raked back 5mm and pointed by hand, which is slow and is the only way it does not look like a sheet product. Sealed matt rather than satin because a shine on brick immediately reads as fake.',
    },
    {
      title: 'Panelled wall, staircase, Old Ikoyi',
      room: 'whole-home',
      budget: 540_000_00,
      caption:
        'Traditional MDF wall panelling up a three-flight staircase — a dado rail, shaker boxes below, painted out in the same colour as the wall above so it reads as architecture rather than as an applied decoration.\n\nSetting out panelling on a rake is the difficult part of this trade. The boxes have to keep an equal visual rhythm as they climb, which means they cannot all be the same size — each one is set out from the going of the stair below it, and the verticals stay plumb while the horizontals follow the pitch. Everything was cut, primed and filled off site, then fixed, caulked and finished in place. Ten days, and about three of those were setting out and marking before a single piece was fixed.',
    },
    {
      title: 'Feature arch and micro-cement, Chevron',
      room: 'living-room',
      budget: 465_000_00,
      caption:
        'A formed arch between a sitting and dining space, finished in a hand-applied micro-cement with a soft mottled tone. The opening was a plain rectangular hole in a blockwork wall; we framed and boarded the radius, then took the finish across the arch and returned it 600mm onto both faces so it is one continuous surface with no edge trim anywhere.\n\nMicro-cement is thin and unforgiving and every joint underneath will find its way to the surface, so the board joints were taped, filled and sealed with a fibreglass mesh before the first coat. Four coats in total, each one worked while the previous was green, then two coats of a matt polyurethane sealer. It is a finish that wants one pair of hands from start to end — two people will apply it at two different pressures and you will see the join for the life of the wall.',
    },
  ],
};
