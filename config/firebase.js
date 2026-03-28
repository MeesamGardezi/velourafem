/**
 * Firebase Admin SDK Initialisation
 *
 * Reads credentials from environment variables (set in .env).
 * Falls back gracefully so the app still boots if Firebase is
 * not yet configured — routes will return a helpful error instead
 * of crashing the process.
 */

require('dotenv').config();
const admin = require('firebase-admin');

let db = null;
let bucket = null;
let initialised = false;

function init() {
  if (initialised) return;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      '\n⚠  Firebase credentials missing — add them to .env\n' +
      '   (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)\n' +
      '   The app will run but data will not be persisted to Firebase.\n'
    );
    initialised = true;
    return;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      storageBucket: storageBucket || `${projectId}.appspot.com`,
    });
  }

  db     = admin.firestore();
  bucket = admin.storage().bucket();
  initialised = true;
  console.log(`✓ Firebase connected — project: ${projectId}`);
}

/** Return the Firestore instance (null if not configured). */
function getDb()     { if (!initialised) init(); return db; }

/** Return the Storage bucket (null if not configured). */
function getBucket() { if (!initialised) init(); return bucket; }

/** True only when both Firestore and Storage are ready. */
function isReady()   { return db !== null && bucket !== null; }

module.exports = { init, getDb, getBucket, isReady };
