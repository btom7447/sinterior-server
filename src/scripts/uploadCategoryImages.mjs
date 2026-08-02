/**
 * Give the shelves their own artwork.
 *
 * Drop files named after a category into a folder and run this. Each one is
 * squared, shrunk and uploaded, and the matching Category row gets its image.
 * Until now the rail borrowed a photograph from whichever listing sold best,
 * which meant "Cement" was a picture of one supplier's bag and every other
 * supplier on the shelf was advertising it for them.
 *
 * Matching is on a loose slug — case, spaces, ampersands and underscores are all
 * ignored — plus the alias table below for the ones whose filenames do not quite
 * spell the category. Anything that matches nothing is reported rather than
 * silently skipped, because a typo in a filename otherwise looks like a failed
 * upload.
 *
 * Usage:
 *   node src/scripts/uploadCategoryImages.mjs <folder> [--env .env.production]
 *                                             [--media-env .env.local] [--dry]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';

const [, , folderArg, ...rest] = process.argv;
if (!folderArg) {
  console.error('usage: node src/scripts/uploadCategoryImages.mjs <folder> [--env <file>] [--dry]');
  process.exit(1);
}

const envFlag = rest.indexOf('--env');
const envFile = envFlag > -1 ? rest[envFlag + 1] : '.env.local';
const dry = rest.includes('--dry');

// override, or an already-loaded .env.local silently wins and the artwork lands
// on the wrong database.
dotenv.config({ path: envFile, override: true });

const { default: Category } = await import('../models/Category.js');

/** Filenames that do not spell their category. */
const ALIASES = {
  stelliron: 'Steel & Iron',
  steeliron: 'Steel & Iron',
  roofing: 'Roofing & Ceiling',
  tilesflooring: 'Tiles & Flooring',
  lighting: 'Lightings & Electrical',
  lightings: 'Lightings & Electrical',
  electrical: 'Lightings & Electrical',
  wood: 'Wood & Timber',
  timber: 'Wood & Timber',
  woodtimber: 'Wood & Timber',
  smarthome: 'Smart Home',
  door: 'Doors',
  panel: 'Panels',
  wall: 'Walls',
  // POP — plaster of Paris — is what a finished wall is called on every site in
  // the country, and it is the first subcategory under Walls.
  pop: 'Walls',
  popscreeding: 'Walls',
};

const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/*
 * Media credentials can come from a different file than the database does.
 *
 * There is one Cloudinary account behind both environments, and its real keys
 * live in .env.local — the committed .env.production carries placeholders,
 * because production reads its own from Railway. Without this, seeding
 * production artwork fails on "Unknown API key your_api_key", which reads like
 * a broken account rather than a file that was never meant to hold the secret.
 *
 * Parsed rather than loaded, so nothing else in the process picks up the
 * development database's variables by accident.
 */
const mediaFlag = rest.indexOf('--media-env');
const mediaFile = mediaFlag > -1 ? rest[mediaFlag + 1] : '.env.local';

let media = process.env;
if (!process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY.startsWith('your_')) {
  try {
    media = dotenv.parse(await fs.readFile(mediaFile));
    console.log(`media credentials from ${mediaFile}`);
  } catch {
    throw new Error(`No usable Cloudinary keys in ${envFile}, and ${mediaFile} could not be read.`);
  }
}

cloudinary.config({
  cloud_name: media.CLOUDINARY_CLOUD_NAME,
  api_key: media.CLOUDINARY_API_KEY,
  api_secret: media.CLOUDINARY_API_SECRET,
});

/**
 * Square, small, and cropped on whatever the picture is actually of.
 *
 * The rail draws these at 42 points inside a circle, so anything past a few
 * hundred pixels is bytes a buyer pays for and never sees. gravity:auto rather
 * than a centre crop because Cloudinary finds the subject — a bag of cement
 * photographed off to one side survives being made round.
 */
const upload = (file) =>
  cloudinary.uploader.upload(file, {
    folder: 'sinterior/categories',
    resource_type: 'image',
    format: 'webp',
    transformation: [{ width: 600, height: 600, crop: 'fill', gravity: 'auto', quality: 80 }],
  });

await mongoose.connect(process.env.MONGO_URI);
console.log(`connected to ${mongoose.connection.name}\n`);

const categories = await Category.find().select('name image').lean();
const bySlug = new Map(categories.map((c) => [slug(c.name), c.name]));

const folder = path.resolve(folderArg);
const entries = await fs.readdir(folder, { withFileTypes: true });

const images = entries.filter(
  (entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)
);

if (!images.length) {
  console.log(`no images in ${folder}`);
  await mongoose.disconnect();
  process.exit(0);
}

const unmatched = [];
let done = 0;

for (const entry of images) {
  const base = slug(path.parse(entry.name).name);
  const name = bySlug.get(base) ?? ALIASES[base];

  if (!name) {
    unmatched.push(entry.name);
    continue;
  }

  const file = path.join(folder, entry.name);
  const before = (await fs.stat(file)).size;

  if (dry) {
    console.log(`  would upload ${entry.name} → ${name}`);
    continue;
  }

  const result = await upload(file);
  await Category.updateOne({ name }, { $set: { image: result.secure_url } });

  console.log(
    `  ${name.padEnd(24)} ${(before / 1024 / 1024).toFixed(1)}MB → ${(result.bytes / 1024).toFixed(0)}KB`
  );
  done += 1;
}

if (unmatched.length) {
  console.log(`\nno category matches: ${unmatched.join(', ')}`);
}

const missing = (await Category.find({ image: null }).select('name').lean()).map((c) => c.name);
if (missing.length) {
  console.log(`\nstill without artwork (${missing.length}): ${missing.join(', ')}`);
}

console.log(`\n${dry ? 'dry run' : `${done} uploaded`}`);
await mongoose.disconnect();
