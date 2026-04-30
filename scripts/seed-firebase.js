/**
 * seed-firebase.js
 *
 * Seeds the local products.json data into Firestore.
 * Run once after configuring your .env file:
 *
 *   node scripts/seed-firebase.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const firebase = require('../config/firebase');
const products = require('../data/products.json');
const brands   = require('../data/brands.json');

async function seed() {
  firebase.init();
  const db = firebase.getDb();

  if (!db) {
    console.error('❌  Firebase is not configured. Fill in .env first.');
    process.exit(1);
  }

  console.log(`Seeding ${products.length} products into Firestore…`);

  const batch = db.batch();
  for (const product of products) {
    const ref = db.collection('products').doc();
    batch.set(ref, product);
  }

  console.log(`Seeding ${brands.length} brands into Firestore…`);
  for (const brand of brands) {
    const ref = db.collection('brands').doc();
    batch.set(ref, brand);
  }

  await batch.commit();

  console.log('✓ Seeding complete!');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
