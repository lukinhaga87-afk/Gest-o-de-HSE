import {
  App,
  cert,
  getApp,
  getApps,
  initializeApp,
  ServiceAccount,
} from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import firebaseConfig from '../firebase-applet-config.json';

export type FirebaseAdminCredentialSource =
  | 'service_account_json'
  | 'service_account_fields'
  | 'adc'
  | 'unconfigured';

export interface FirebaseAdminDiagnostics {
  configured: boolean;
  initialized: boolean;
  credentialSource: FirebaseAdminCredentialSource;
  projectId: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  requireAdminSdk: boolean;
  lastError?: string;
}

export class FirebaseAdminNotConfiguredError extends Error {
  readonly code = 'FIREBASE_ADMIN_NOT_CONFIGURED';
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'FirebaseAdminNotConfiguredError';
  }
}

const ADMIN_APP_NAME = 'ehs-more-server-admin';

let cachedAdminApp: App | null = null;
let cachedAdminDb: Firestore | null = null;
let cachedCredentialSource: FirebaseAdminCredentialSource = 'unconfigured';
let cachedLastError: string | undefined;

function getResolvedProjectId(): string {
  const envId = (
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    ''
  ).trim();
  return envId || firebaseConfig.projectId || '';
}

function getResolvedFirestoreDatabaseId(): string {
  const envDb = (process.env.FIREBASE_FIRESTORE_DATABASE_ID || '').trim();
  return envDb || firebaseConfig.firestoreDatabaseId || '(default)';
}

function getResolvedStorageBucket(): string {
  const envBucket = (
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.GCS_BUCKET_NAME ||
    ''
  ).trim();
  return envBucket || firebaseConfig.storageBucket || '';
}

export function isAdminSdkRequired(): boolean {
  return String(process.env.FIREBASE_REQUIRE_ADMIN_SDK || '').trim().toLowerCase() === 'true';
}

function parseServiceAccountFromJsonEnv(rawValue: string): ServiceAccount | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  let jsonText = trimmed;
  if (!trimmed.startsWith('{')) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
      if (decoded.startsWith('{')) {
        jsonText = decoded;
      }
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const projectId = String(parsed.project_id || parsed.projectId || '').trim();
    const clientEmail = String(parsed.client_email || parsed.clientEmail || '').trim();
    const rawKey = String(parsed.private_key || parsed.privateKey || '').replace(/\\n/g, '\n').trim();

    if (!projectId || !clientEmail || !rawKey || !rawKey.includes('BEGIN PRIVATE KEY')) {
      return null;
    }

    return {
      projectId,
      clientEmail,
      privateKey: rawKey,
    };
  } catch {
    return null;
  }
}

function resolveServiceAccountCredential(): {
  source: FirebaseAdminCredentialSource;
  serviceAccount?: ServiceAccount;
} {
  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (jsonEnv.trim()) {
    const parsed = parseServiceAccountFromJsonEnv(jsonEnv);
    if (parsed) {
      return { source: 'service_account_json', serviceAccount: parsed };
    }
    cachedLastError =
      'Variável FIREBASE_SERVICE_ACCOUNT_JSON presente, mas inválida ou incompleta (verifique project_id, client_email e private_key).';
    return { source: 'unconfigured' };
  }

  const projectId = (process.env.FIREBASE_ADMIN_PROJECT_ID || '').trim();
  const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();

  if (clientEmail && privateKey) {
    if (!privateKey.includes('BEGIN PRIVATE KEY')) {
      cachedLastError =
        'Variável FIREBASE_ADMIN_PRIVATE_KEY presente, mas em formato PEM inválido.';
      return { source: 'unconfigured' };
    }
    return {
      source: 'service_account_fields',
      serviceAccount: {
        projectId: projectId || getResolvedProjectId(),
        clientEmail,
        privateKey,
      },
    };
  }

  if (
    String(process.env.FIREBASE_USE_ADC || '').trim().toLowerCase() === 'true' ||
    Boolean((process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim())
  ) {
    return { source: 'adc' };
  }

  return { source: 'unconfigured' };
}

export function isFirebaseAdminConfigured(): boolean {
  return resolveServiceAccountCredential().source !== 'unconfigured';
}

export function getFirebaseAdminApp(): App | null {
  if (cachedAdminApp) {
    return cachedAdminApp;
  }

  const resolved = resolveServiceAccountCredential();
  cachedCredentialSource = resolved.source;

  if (resolved.source === 'unconfigured') {
    return null;
  }

  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  if (existing) {
    cachedAdminApp = existing;
    return cachedAdminApp;
  }

  const projectId = resolved.serviceAccount?.projectId || getResolvedProjectId();
  const storageBucket = getResolvedStorageBucket();

  if (!projectId || projectId === 'remixed-project-id') {
    cachedLastError = 'projectId do Firebase ausente ou placeholder.';
    return null;
  }

  try {
    if (resolved.serviceAccount) {
      cachedAdminApp = initializeApp(
        {
          credential: cert(resolved.serviceAccount),
          projectId,
          ...(storageBucket ? { storageBucket } : {}),
        },
        ADMIN_APP_NAME
      );
    } else {
      // Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS / Workload Identity)
      cachedAdminApp = initializeApp(
        {
          projectId,
          ...(storageBucket ? { storageBucket } : {}),
        },
        ADMIN_APP_NAME
      );
    }
    cachedLastError = undefined;
    return cachedAdminApp;
  } catch (err: any) {
    // Handle concurrent initialization race safely
    try {
      cachedAdminApp = getApp(ADMIN_APP_NAME);
      return cachedAdminApp;
    } catch {
      cachedLastError = err?.message || 'Falha ao inicializar Firebase Admin SDK.';
      console.error('[FirebaseAdmin] Falha na inicialização server-side:', cachedLastError);
      return null;
    }
  }
}

export function getAdminFirestore(): Firestore | null {
  if (cachedAdminDb) {
    return cachedAdminDb;
  }

  const app = getFirebaseAdminApp();
  if (!app) {
    return null;
  }

  const databaseId = getResolvedFirestoreDatabaseId();
  cachedAdminDb =
    databaseId && databaseId !== '(default)'
      ? getFirestore(app, databaseId)
      : getFirestore(app);

  return cachedAdminDb;
}

export function getAdminStorageBucket(bucketNameOverride?: string) {
  const app = getFirebaseAdminApp();
  if (!app) {
    return null;
  }
  const bucketName = (bucketNameOverride || getResolvedStorageBucket()).trim();
  if (!bucketName) {
    return null;
  }
  return getStorage(app).bucket(bucketName);
}

export function getFirebaseAdminDiagnostics(): FirebaseAdminDiagnostics {
  const resolved = resolveServiceAccountCredential();
  return {
    configured: resolved.source !== 'unconfigured',
    initialized: Boolean(cachedAdminApp),
    credentialSource: cachedAdminApp ? cachedCredentialSource : resolved.source,
    projectId: getResolvedProjectId(),
    firestoreDatabaseId: getResolvedFirestoreDatabaseId(),
    storageBucket: getResolvedStorageBucket(),
    requireAdminSdk: isAdminSdkRequired(),
    ...(cachedLastError ? { lastError: cachedLastError } : {}),
  };
}

/**
 * Resets cached singleton instances strictly for isolated automated tests.
 */
export function resetFirebaseAdminCacheForTests(): void {
  cachedAdminApp = null;
  cachedAdminDb = null;
  cachedCredentialSource = 'unconfigured';
  cachedLastError = undefined;
}
