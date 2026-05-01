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
const path  = require('path');
const fs    = require('fs');

let db = null;
let bucket = null;
let initialised = false;

function init() {
  if (initialised) return;

  // 1) Try loading serviceAccount.json from project root or config directory
  const rootPath = path.join(__dirname, '..', 'serviceAccount.json');
  const configPath = path.join(__dirname, 'serviceAccount.json');
  const saPath = fs.existsSync(configPath) ? configPath : rootPath;
  
  let credential = null;
  let projectId  = null;

  if (fs.existsSync(saPath)) {
    console.log(`✓ Loading Firebase credentials from: ${saPath}`);
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    credential = admin.credential.cert(sa);
    projectId  = sa.project_id;
  } else {
    // 2) Fall back to .env variables
    projectId         = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (projectId && clientEmail && privateKey) {
      credential = admin.credential.cert({ projectId, clientEmail, privateKey });
    }
  }

  if (!credential) {
    console.warn(
      '\n⚠  Firebase credentials missing — add serviceAccount.json to the project root\n' +
      '   or set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env\n' +
      '   The app will run but data will not be persisted to Firebase.\n'
    );
    initialised = true;
    return;
  }

  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

  if (!admin.apps.length) {
    admin.initializeApp({ credential, storageBucket });
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
