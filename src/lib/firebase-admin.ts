import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    console.log('Initializing Firebase Admin SDK...');
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (serviceAccountKey) {
        try {
            const serviceAccount = JSON.parse(serviceAccountKey);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            });
            console.log('Firebase Admin initialized with Service Account Key.');
        } catch (error) {
            console.error('Firebase Admin initialization error:', error);
        }
    } else {
        console.warn('FIREBASE_SERVICE_ACCOUNT_KEY not found. Attempting default initialization...');
        admin.initializeApp({
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        });
        console.log('Firebase Admin initialized with default credentials.');
    }
}

const adminDb = admin.firestore();
const adminAuth = admin.auth();

export { adminDb, adminAuth };
