import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, addDoc, onSnapshot,
  serverTimestamp, Timestamp, query, orderBy, limit,
  updateDoc, deleteDoc, doc
} from "firebase/firestore";
import {
  getAuth, signInAnonymously, onAuthStateChanged, type User
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/** Call this when staff board loads */
export function ensureStaffSignedIn() {
  onAuthStateChanged(auth, (u: User | null) => {
    if (!u) signInAnonymously(auth).catch(() => {});
  });
}

/** Firestore API used by App.tsx */
export const ordersCol = collection(db, "orders");

export function watchOrders(cb: (orders: any[]) => void) {
  const q = query(ordersCol, orderBy("createdAt", "desc"), limit(300));
  return onSnapshot(q, (snap) => {
    const out = snap.docs.map(d => {
      const data = d.data();
      return {
        _docId: d.id,
        ...data,
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : data.createdAt,
        expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : data.expiresAt,
      };
    });
    cb(out);
  });
}

export async function createOrder(docData: any) {
  // server sets createdAt; client precomputes expiresAt
  const ref = await addDoc(ordersCol, {
    ...docData,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function updateOrderDoc(docId: string, patch: any) {
  return updateDoc(doc(db, "orders", docId), patch);
}

export function deleteOrderDoc(docId: string) {
  return deleteDoc(doc(db, "orders", docId));
}
