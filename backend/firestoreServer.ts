import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore as ClientFirestore,
} from 'firebase/firestore';
import { db as fallbackWebDb } from './notificationEngine';
import {
  FirebaseAdminNotConfiguredError,
  getAdminFirestore,
  isAdminSdkRequired,
} from './firebaseAdmin';

export type FirestoreExecutionMode = 'admin_sdk' | 'web_sdk_fallback';

export interface ServerFirestoreDoc<T = Record<string, any>> {
  id: string;
  data: T;
}

function getActiveBackend(overrideWebDb?: ClientFirestore):
  | { mode: 'admin_sdk'; adminDb: NonNullable<ReturnType<typeof getAdminFirestore>> }
  | { mode: 'web_sdk_fallback'; webDb: ClientFirestore } {
  const adminDb = getAdminFirestore();
  if (adminDb) {
    return { mode: 'admin_sdk', adminDb };
  }

  if (isAdminSdkRequired()) {
    throw new FirebaseAdminNotConfiguredError(
      'Firebase Admin SDK obrigatório (FIREBASE_REQUIRE_ADMIN_SDK=true), mas nenhuma credencial server-side foi configurada nas variáveis de ambiente.'
    );
  }

  return {
    mode: 'web_sdk_fallback',
    webDb: overrideWebDb || fallbackWebDb,
  };
}

export function getFirestoreExecutionMode(): FirestoreExecutionMode {
  return getAdminFirestore() ? 'admin_sdk' : 'web_sdk_fallback';
}

export async function serverGetDoc<T = Record<string, any>>(
  collectionName: string,
  docId: string,
  overrideWebDb?: ClientFirestore
): Promise<ServerFirestoreDoc<T> | null> {
  const backend = getActiveBackend(overrideWebDb);
  if (backend.mode === 'admin_sdk') {
    const snap = await backend.adminDb.collection(collectionName).doc(docId).get();
    if (!snap.exists) return null;
    return { id: snap.id, data: snap.data() as T };
  }

  const snap = await getDoc(doc(backend.webDb, collectionName, docId));
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() as T };
}

export async function serverListCollection<T = Record<string, any>>(
  collectionName: string,
  overrideWebDb?: ClientFirestore
): Promise<ServerFirestoreDoc<T>[]> {
  const backend = getActiveBackend(overrideWebDb);
  if (backend.mode === 'admin_sdk') {
    const snap = await backend.adminDb.collection(collectionName).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as T }));
  }

  const snap = await getDocs(collection(backend.webDb, collectionName));
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as T }));
}

export async function serverQueryEquals<T = Record<string, any>>(
  collectionName: string,
  field: string,
  value: unknown,
  overrideWebDb?: ClientFirestore
): Promise<ServerFirestoreDoc<T>[]> {
  const backend = getActiveBackend(overrideWebDb);
  if (backend.mode === 'admin_sdk') {
    const snap = await backend.adminDb
      .collection(collectionName)
      .where(field, '==', value)
      .get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as T }));
  }

  const snap = await getDocs(
    query(collection(backend.webDb, collectionName), where(field, '==', value))
  );
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as T }));
}

export async function serverAddDoc<T extends Record<string, any>>(
  collectionName: string,
  data: T,
  overrideWebDb?: ClientFirestore
): Promise<string> {
  const backend = getActiveBackend(overrideWebDb);
  if (backend.mode === 'admin_sdk') {
    const ref = await backend.adminDb.collection(collectionName).add(data);
    return ref.id;
  }

  const ref = await addDoc(collection(backend.webDb, collectionName), data);
  return ref.id;
}

export async function serverSetDoc<T extends Record<string, any>>(
  collectionName: string,
  docId: string,
  data: T,
  options?: { merge?: boolean },
  overrideWebDb?: ClientFirestore
): Promise<void> {
  const backend = getActiveBackend(overrideWebDb);
  if (backend.mode === 'admin_sdk') {
    await backend.adminDb
      .collection(collectionName)
      .doc(docId)
      .set(data, { merge: Boolean(options?.merge) });
    return;
  }

  await setDoc(doc(backend.webDb, collectionName, docId), data, {
    merge: Boolean(options?.merge),
  });
}

export async function serverUpdateDoc<T extends Record<string, any>>(
  collectionName: string,
  docId: string,
  updates: T,
  overrideWebDb?: ClientFirestore
): Promise<void> {
  const backend = getActiveBackend(overrideWebDb);
  if (backend.mode === 'admin_sdk') {
    await backend.adminDb.collection(collectionName).doc(docId).update(updates);
    return;
  }

  await updateDoc(doc(backend.webDb, collectionName, docId), updates);
}

export async function serverDeleteDoc(
  collectionName: string,
  docId: string,
  overrideWebDb?: ClientFirestore
): Promise<void> {
  const backend = getActiveBackend(overrideWebDb);
  if (backend.mode === 'admin_sdk') {
    await backend.adminDb.collection(collectionName).doc(docId).delete();
    return;
  }

  await deleteDoc(doc(backend.webDb, collectionName, docId));
}
