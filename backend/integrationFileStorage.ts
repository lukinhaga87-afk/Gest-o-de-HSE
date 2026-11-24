import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IntegrationFileStorageProvider } from '../src/types/sst.ts';
import { getAdminStorageBucket } from './firebaseAdmin';

export interface StoredFileMetadata {
  storageProvider: IntegrationFileStorageProvider;
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
}

export interface RetrievedStoredFile {
  buffer: Buffer;
  sizeBytes: number;
  sha256: string;
}

export interface IntegrationFileStorage {
  readonly providerName: IntegrationFileStorageProvider;
  putObject(params: {
    storageKey: string;
    buffer: Buffer;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
    sha256: string;
    metadata?: Record<string, string>;
  }): Promise<StoredFileMetadata>;
  getObject(
    storageKey: string,
    opts?: { expectedSha256?: string }
  ): Promise<RetrievedStoredFile | null>;
  exists(storageKey: string): Promise<boolean>;
}

export class IntegrationStorageUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'STORAGE_PROVIDER_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'IntegrationStorageUnavailableError';
  }
}

export class IntegrationFileIntegrityError extends Error {
  readonly status = 500;
  readonly code = 'FILE_INTEGRITY_MISMATCH';

  constructor(message: string) {
    super(message);
    this.name = 'IntegrationFileIntegrityError';
  }
}

const MIME_TO_SAFE_EXT: Record<'application/pdf' | 'image/jpeg' | 'image/png', string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

function sanitizeKeySegment(raw: string, fallback: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

export function computeBufferSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function assertValidStorageKey(storageKey: string): string {
  const normalizedKey = String(storageKey || '').replace(/\\/g, '/').trim();
  if (
    !normalizedKey ||
    normalizedKey.startsWith('/') ||
    normalizedKey.includes('..') ||
    normalizedKey.includes('\0') ||
    !/^integrations\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/v\d+_[a-zA-Z0-9_-]+\.(pdf|jpg|png)$/.test(
      normalizedKey
    )
  ) {
    throw new Error('Chave de armazenamento inválida ou fora do padrão seguro multi-tenant.');
  }
  return normalizedKey;
}

function assertBufferIntegrity(buffer: Buffer, expectedSha256?: string): string {
  const actualSha256 = computeBufferSha256(buffer);
  if (expectedSha256 && expectedSha256.trim()) {
    const expectedClean = expectedSha256.trim().toLowerCase();
    const actualBuf = Buffer.from(actualSha256.toLowerCase(), 'utf8');
    const expectedBuf = Buffer.from(expectedClean, 'utf8');
    if (
      actualBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(actualBuf, expectedBuf)
    ) {
      throw new IntegrationFileIntegrityError(
        'Falha na verificação de integridade SHA-256 do arquivo armazenado.'
      );
    }
  }
  return actualSha256;
}

/**
 * Generates an internal, non-guessable, path-traversal-proof storage key.
 * Client-supplied filenames are NEVER used as path components.
 */
export function buildSafeStorageKey(params: {
  empresaId?: string;
  integrationId: string;
  itemId: string;
  version: number;
  arquivoId: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
}): string {
  const tenant = sanitizeKeySegment(params.empresaId || 'pendente', 'pendente');
  const integration = sanitizeKeySegment(params.integrationId, 'integ');
  const item = sanitizeKeySegment(params.itemId, 'item');
  const fileUuid = sanitizeKeySegment(params.arquivoId, crypto.randomUUID());
  const safeVersion = Math.max(1, Math.floor(params.version || 1));
  const ext = MIME_TO_SAFE_EXT[params.mimeType];
  return `integrations/${tenant}/${integration}/${item}/v${safeVersion}_${fileUuid}.${ext}`;
}

/**
 * Verifies actual binary magic bytes against the declared MIME type to prevent spoofing.
 */
export function validateBinaryMagicBytes(
  buffer: Buffer,
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  if (mimeType === 'application/pdf') {
    const head = buffer.subarray(0, Math.min(buffer.length, 32)).toString('latin1');
    return head.includes('%PDF-');
  }

  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  return false;
}

/**
 * Sanitizes a user-supplied filename for safe Content-Disposition headers.
 */
export function sanitizeDownloadFileName(rawName: string): string {
  const base = path.basename(String(rawName || 'documento'));
  const clean = base
    .replace(/[\r\n"\\]/g, '')
    .replace(/[^\w.\-() ]+/g, '_')
    .trim();
  return clean || 'documento';
}

export function isEphemeralServerlessRuntime(): boolean {
  return Boolean(
    process.env.NETLIFY === 'true' ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY_DEV === 'false'
  );
}

/**
 * In-memory private storage adapter for automated tests and isolated dev runs.
 */
export class InMemoryIntegrationFileStorage implements IntegrationFileStorage {
  readonly providerName: IntegrationFileStorageProvider = 'memory';
  private readonly store = new Map<string, Buffer>();

  async putObject(params: {
    storageKey: string;
    buffer: Buffer;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
    sha256: string;
  }): Promise<StoredFileMetadata> {
    const safeKey = assertValidStorageKey(params.storageKey);
    const verifiedSha = assertBufferIntegrity(params.buffer, params.sha256);
    this.store.set(safeKey, Buffer.from(params.buffer));
    return {
      storageProvider: this.providerName,
      storageKey: safeKey,
      sizeBytes: params.buffer.length,
      sha256: verifiedSha,
      mimeType: params.mimeType,
    };
  }

  async getObject(
    storageKey: string,
    opts?: { expectedSha256?: string }
  ): Promise<RetrievedStoredFile | null> {
    const safeKey = assertValidStorageKey(storageKey);
    const found = this.store.get(safeKey);
    if (!found) return null;
    const copy = Buffer.from(found);
    const sha256 = assertBufferIntegrity(copy, opts?.expectedSha256);
    return {
      buffer: copy,
      sizeBytes: copy.length,
      sha256,
    };
  }

  async exists(storageKey: string): Promise<boolean> {
    const safeKey = assertValidStorageKey(storageKey);
    return this.store.has(safeKey);
  }

  /** Test helper to simulate storage tampering/bit-rot */
  corruptObjectForTest(storageKey: string, corruptedBuffer: Buffer): void {
    this.store.set(storageKey, Buffer.from(corruptedBuffer));
  }

  count(): number {
    return this.store.size;
  }
}

/**
 * Private non-public filesystem storage adapter for local Node development.
 * Stores files strictly outside public/ and dist/ (.private-storage/).
 * In ephemeral serverless production (Netlify/AWS Lambda) where no cloud bucket is configured,
 * fails closed with HTTP 503 STORAGE_PROVIDER_NOT_CONFIGURED rather than writing to ephemeral /tmp
 * or exposing public links.
 */
export class LocalPrivateIntegrationFileStorage implements IntegrationFileStorage {
  readonly providerName: IntegrationFileStorageProvider = 'local_private';
  private readonly baseDir: string;
  private readonly isEphemeralServerless: boolean;

  constructor(baseDir?: string, forceEphemeralServerless?: boolean) {
    this.baseDir = path.resolve(
      baseDir || process.env.INTEGRATION_PRIVATE_STORAGE_DIR || path.join(process.cwd(), '.private-storage')
    );
    this.isEphemeralServerless =
      forceEphemeralServerless !== undefined
        ? forceEphemeralServerless
        : isEphemeralServerlessRuntime();
  }

  private assertPersistentRuntime(): void {
    if (this.isEphemeralServerless) {
      throw new IntegrationStorageUnavailableError(
        'Armazenamento privado de documentos em nuvem ainda não está configurado neste ambiente serverless. Configure o provedor de Object Storage privado (Firebase Storage/GCS via Admin SDK ou Azure Blob Storage privado) antes de receber arquivos em produção.'
      );
    }
  }

  private resolveSafePath(storageKey: string): string {
    const normalizedKey = assertValidStorageKey(storageKey);
    const targetPath = path.resolve(this.baseDir, normalizedKey);
    const expectedPrefix = this.baseDir.endsWith(path.sep)
      ? this.baseDir
      : `${this.baseDir}${path.sep}`;
    if (!targetPath.startsWith(expectedPrefix)) {
      throw new Error('Tentativa de acesso fora do diretório privado de armazenamento.');
    }
    return targetPath;
  }

  async putObject(params: {
    storageKey: string;
    buffer: Buffer;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
    sha256: string;
  }): Promise<StoredFileMetadata> {
    this.assertPersistentRuntime();
    const verifiedSha = assertBufferIntegrity(params.buffer, params.sha256);
    const targetPath = this.resolveSafePath(params.storageKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(targetPath, params.buffer, { mode: 0o600 });
    return {
      storageProvider: this.providerName,
      storageKey: params.storageKey,
      sizeBytes: params.buffer.length,
      sha256: verifiedSha,
      mimeType: params.mimeType,
    };
  }

  async getObject(
    storageKey: string,
    opts?: { expectedSha256?: string }
  ): Promise<RetrievedStoredFile | null> {
    this.assertPersistentRuntime();
    const targetPath = this.resolveSafePath(storageKey);
    try {
      const buffer = await fs.readFile(targetPath);
      const sha256 = assertBufferIntegrity(buffer, opts?.expectedSha256);
      return {
        buffer,
        sizeBytes: buffer.length,
        sha256,
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    this.assertPersistentRuntime();
    const targetPath = this.resolveSafePath(storageKey);
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Minimal GCS/Firebase Storage Bucket interface to allow deterministic testing
 * alongside real firebase-admin/storage buckets.
 */
export interface PrivateCloudBucketFileLike {
  save(
    data: Buffer,
    options?: {
      resumable?: boolean;
      contentType?: string;
      public?: boolean;
      metadata?: {
        contentType?: string;
        cacheControl?: string;
        metadata?: Record<string, string>;
      };
    }
  ): Promise<void>;
  download(): Promise<[Buffer]>;
  exists(): Promise<[boolean]>;
}

export interface PrivateCloudBucketLike {
  name?: string;
  file(key: string): PrivateCloudBucketFileLike;
}

/**
 * Private Firebase Storage / Google Cloud Storage adapter via Firebase Admin SDK.
 * Strictly private objects: never generates public URLs, never calls makePublic(),
 * enforces SHA-256 verification on upload and download, and fails closed when unconfigured.
 */
export class CloudBucketIntegrationFileStorage implements IntegrationFileStorage {
  readonly providerName: IntegrationFileStorageProvider;
  private readonly bucketName?: string;
  private readonly injectedBucket?: PrivateCloudBucketLike;

  constructor(options?: {
    providerName?: 'firebase_storage' | 'gcs';
    bucketName?: string;
    bucket?: PrivateCloudBucketLike;
  }) {
    this.providerName = options?.providerName || 'firebase_storage';
    this.bucketName =
      options?.bucketName ||
      (process.env.FIREBASE_STORAGE_BUCKET || process.env.GCS_BUCKET_NAME || '').trim() ||
      undefined;
    this.injectedBucket = options?.bucket;
  }

  private resolveBucket(): PrivateCloudBucketLike {
    if (this.injectedBucket) {
      return this.injectedBucket;
    }
    const bucket = getAdminStorageBucket(this.bucketName);
    if (!bucket) {
      throw new IntegrationStorageUnavailableError(
        'Bucket privado Firebase Storage/GCS indisponível: configure as credenciais do Firebase Admin SDK e FIREBASE_STORAGE_BUCKET (ou GCS_BUCKET_NAME) no ambiente do servidor.'
      );
    }
    return bucket as unknown as PrivateCloudBucketLike;
  }

  async putObject(params: {
    storageKey: string;
    buffer: Buffer;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
    sha256: string;
    metadata?: Record<string, string>;
  }): Promise<StoredFileMetadata> {
    const safeKey = assertValidStorageKey(params.storageKey);
    const verifiedSha = assertBufferIntegrity(params.buffer, params.sha256);
    const bucket = this.resolveBucket();
    const fileRef = bucket.file(safeKey);

    await fileRef.save(params.buffer, {
      resumable: false,
      public: false,
      contentType: params.mimeType,
      metadata: {
        contentType: params.mimeType,
        cacheControl: 'private, no-store, max-age=0',
        metadata: {
          ...(params.metadata || {}),
          sha256: verifiedSha,
          accessLevel: 'private',
        },
      },
    });

    return {
      storageProvider: this.providerName,
      storageKey: safeKey,
      sizeBytes: params.buffer.length,
      sha256: verifiedSha,
      mimeType: params.mimeType,
    };
  }

  async getObject(
    storageKey: string,
    opts?: { expectedSha256?: string }
  ): Promise<RetrievedStoredFile | null> {
    const safeKey = assertValidStorageKey(storageKey);
    const bucket = this.resolveBucket();
    const fileRef = bucket.file(safeKey);

    const [present] = await fileRef.exists();
    if (!present) {
      return null;
    }

    const [buffer] = await fileRef.download();
    const sha256 = assertBufferIntegrity(buffer, opts?.expectedSha256);
    return {
      buffer,
      sizeBytes: buffer.length,
      sha256,
    };
  }

  async exists(storageKey: string): Promise<boolean> {
    const safeKey = assertValidStorageKey(storageKey);
    const bucket = this.resolveBucket();
    const [present] = await bucket.file(safeKey).exists();
    return Boolean(present);
  }
}

export interface AzureBlobStorageConfig {
  accountName: string;
  accountKey: string;
  containerName: string;
  endpointHost?: string;
}

/**
 * Private Azure Blob Storage adapter using Azure REST API + SharedKey HMAC-SHA256 signing.
 * Compatible with Netlify Functions / Node serverless without extra SDK overhead.
 * Strictly private container access; never creates public blobs or permanent public URLs.
 */
export class AzureBlobPrivateIntegrationFileStorage implements IntegrationFileStorage {
  readonly providerName: IntegrationFileStorageProvider = 'azure_blob';
  private readonly config: AzureBlobStorageConfig | null;
  private readonly fetchFn: typeof fetch;

  constructor(options?: {
    config?: Partial<AzureBlobStorageConfig>;
    fetchImpl?: typeof fetch;
  }) {
    const accountName = (
      options?.config?.accountName ??
      process.env.AZURE_STORAGE_ACCOUNT_NAME ??
      ''
    ).trim();
    const accountKey = (
      options?.config?.accountKey ??
      process.env.AZURE_STORAGE_ACCOUNT_KEY ??
      ''
    ).trim();
    const containerName = (
      options?.config?.containerName ??
      process.env.AZURE_STORAGE_CONTAINER_NAME ??
      ''
    ).trim();
    const endpointHost = (
      options?.config?.endpointHost ??
      process.env.AZURE_STORAGE_ENDPOINT_HOST ??
      ''
    ).trim();

    this.config =
      accountName && accountKey && containerName
        ? {
            accountName,
            accountKey,
            containerName,
            endpointHost: endpointHost || `${accountName}.blob.core.windows.net`,
          }
        : null;
    this.fetchFn = options?.fetchImpl || globalThis.fetch.bind(globalThis);
  }

  private assertConfigured(): AzureBlobStorageConfig {
    if (!this.config) {
      throw new IntegrationStorageUnavailableError(
        'Azure Blob Storage privado não configurado: defina AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_ACCOUNT_KEY e AZURE_STORAGE_CONTAINER_NAME nas variáveis de ambiente do servidor.'
      );
    }
    return this.config;
  }

  private buildSignedHeaders(params: {
    cfg: AzureBlobStorageConfig;
    method: 'PUT' | 'GET' | 'HEAD';
    blobPath: string;
    contentLength?: number;
    contentType?: string;
    extraMsHeaders?: Record<string, string>;
  }): Record<string, string> {
    const msDate = new Date().toUTCString();
    const msVersion = '2021-12-02';
    const msHeaders: Record<string, string> = {
      'x-ms-date': msDate,
      'x-ms-version': msVersion,
      ...(params.extraMsHeaders || {}),
    };

    const canonicalizedHeaders = Object.keys(msHeaders)
      .map((k) => k.toLowerCase())
      .sort()
      .map((k) => `${k}:${msHeaders[Object.keys(msHeaders).find((orig) => orig.toLowerCase() === k)!].trim()}`)
      .join('\n');

    const canonicalizedResource = `/${params.cfg.accountName}/${params.cfg.containerName}/${params.blobPath}`;
    const contentLengthHeader =
      params.contentLength !== undefined && params.contentLength > 0
        ? String(params.contentLength)
        : '';

    const stringToSign = [
      params.method,
      '', // Content-Encoding
      '', // Content-Language
      contentLengthHeader,
      '', // Content-MD5
      params.contentType || '',
      '', // Date
      '', // If-Modified-Since
      '', // If-Match
      '', // If-None-Match
      '', // If-Unmodified-Since
      '', // Range
      canonicalizedHeaders,
      canonicalizedResource,
    ].join('\n');

    const keyBuffer = Buffer.from(params.cfg.accountKey, 'base64');
    const signature = crypto
      .createHmac('sha256', keyBuffer)
      .update(stringToSign, 'utf8')
      .digest('base64');

    return {
      ...msHeaders,
      ...(params.contentType ? { 'Content-Type': params.contentType } : {}),
      ...(params.contentLength !== undefined
        ? { 'Content-Length': String(params.contentLength) }
        : {}),
      Authorization: `SharedKey ${params.cfg.accountName}:${signature}`,
    };
  }

  private buildBlobUrl(cfg: AzureBlobStorageConfig, safeKey: string): string {
    return `https://${cfg.endpointHost}/${encodeURIComponent(cfg.containerName)}/${safeKey}`;
  }

  async putObject(params: {
    storageKey: string;
    buffer: Buffer;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
    sha256: string;
    metadata?: Record<string, string>;
  }): Promise<StoredFileMetadata> {
    const cfg = this.assertConfigured();
    const safeKey = assertValidStorageKey(params.storageKey);
    const verifiedSha = assertBufferIntegrity(params.buffer, params.sha256);

    const extraMsHeaders: Record<string, string> = {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-blob-cache-control': 'private, no-store, max-age=0',
      'x-ms-meta-sha256': verifiedSha,
    };
    if (params.metadata) {
      for (const [k, v] of Object.entries(params.metadata)) {
        const cleanKey = k.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        if (cleanKey && v) {
          extraMsHeaders[`x-ms-meta-${cleanKey}`] = String(v).replace(/[\r\n]/g, ' ').slice(0, 200);
        }
      }
    }

    const headers = this.buildSignedHeaders({
      cfg,
      method: 'PUT',
      blobPath: safeKey,
      contentLength: params.buffer.length,
      contentType: params.mimeType,
      extraMsHeaders,
    });

    const resp = await this.fetchFn(this.buildBlobUrl(cfg, safeKey), {
      method: 'PUT',
      headers,
      body: new Uint8Array(params.buffer),
    });

    if (!resp.ok) {
      throw new Error(`Falha ao gravar objeto privado no Azure Blob Storage (HTTP ${resp.status}).`);
    }

    return {
      storageProvider: this.providerName,
      storageKey: safeKey,
      sizeBytes: params.buffer.length,
      sha256: verifiedSha,
      mimeType: params.mimeType,
    };
  }

  async getObject(
    storageKey: string,
    opts?: { expectedSha256?: string }
  ): Promise<RetrievedStoredFile | null> {
    const cfg = this.assertConfigured();
    const safeKey = assertValidStorageKey(storageKey);
    const headers = this.buildSignedHeaders({
      cfg,
      method: 'GET',
      blobPath: safeKey,
    });

    const resp = await this.fetchFn(this.buildBlobUrl(cfg, safeKey), {
      method: 'GET',
      headers,
    });

    if (resp.status === 404) {
      return null;
    }
    if (!resp.ok) {
      throw new Error(`Falha ao recuperar objeto privado do Azure Blob Storage (HTTP ${resp.status}).`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    const sha256 = assertBufferIntegrity(buffer, opts?.expectedSha256);
    return {
      buffer,
      sizeBytes: buffer.length,
      sha256,
    };
  }

  async exists(storageKey: string): Promise<boolean> {
    const cfg = this.assertConfigured();
    const safeKey = assertValidStorageKey(storageKey);
    const headers = this.buildSignedHeaders({
      cfg,
      method: 'HEAD',
      blobPath: safeKey,
    });

    const resp = await this.fetchFn(this.buildBlobUrl(cfg, safeKey), {
      method: 'HEAD',
      headers,
    });
    return resp.status === 200;
  }
}

export interface StorageProviderDiagnostics {
  selectedProvider: IntegrationFileStorageProvider;
  serverlessRuntime: boolean;
  cloudConfigured: boolean;
  readyForProductionUploads: boolean;
  message: string;
}

export function getStorageProviderDiagnostics(): StorageProviderDiagnostics {
  const explicit = (process.env.INTEGRATION_STORAGE_PROVIDER || '').trim().toLowerCase();
  const serverless = isEphemeralServerlessRuntime();
  const hasAzure = Boolean(
    (process.env.AZURE_STORAGE_ACCOUNT_NAME || '').trim() &&
      (process.env.AZURE_STORAGE_ACCOUNT_KEY || '').trim() &&
      (process.env.AZURE_STORAGE_CONTAINER_NAME || '').trim()
  );
  const hasCloudBucket = Boolean(
    (process.env.FIREBASE_STORAGE_BUCKET || process.env.GCS_BUCKET_NAME || '').trim() &&
      getAdminStorageBucket()
  );

  if (explicit === 'azure_blob' || (!explicit && hasAzure)) {
    return {
      selectedProvider: 'azure_blob',
      serverlessRuntime: serverless,
      cloudConfigured: hasAzure,
      readyForProductionUploads: hasAzure,
      message: hasAzure
        ? 'Azure Blob Storage privado configurado via variáveis de ambiente.'
        : 'Azure Blob Storage selecionado, porém credenciais incompletas (fail-closed ativo).',
    };
  }

  if (
    explicit === 'firebase_storage' ||
    explicit === 'gcs' ||
    (!explicit && hasCloudBucket)
  ) {
    const provider = explicit === 'gcs' ? 'gcs' : 'firebase_storage';
    return {
      selectedProvider: provider,
      serverlessRuntime: serverless,
      cloudConfigured: hasCloudBucket,
      readyForProductionUploads: hasCloudBucket,
      message: hasCloudBucket
        ? 'Bucket privado Firebase Storage/GCS configurado via Firebase Admin SDK.'
        : 'Bucket Firebase Storage/GCS selecionado, porém Admin SDK/bucket não configurados (fail-closed ativo).',
    };
  }

  return {
    selectedProvider: 'local_private',
    serverlessRuntime: serverless,
    cloudConfigured: false,
    readyForProductionUploads: !serverless,
    message: serverless
      ? 'Nenhum Object Storage privado configurado em ambiente serverless (fail-closed HTTP 503 ativo).'
      : 'Armazenamento privado local (.private-storage) ativo apenas para desenvolvimento local.',
  };
}

export function createDefaultIntegrationFileStorage(): IntegrationFileStorage {
  const explicit = (process.env.INTEGRATION_STORAGE_PROVIDER || '').trim().toLowerCase();

  if (explicit === 'azure_blob') {
    return new AzureBlobPrivateIntegrationFileStorage();
  }
  if (explicit === 'firebase_storage' || explicit === 'gcs') {
    return new CloudBucketIntegrationFileStorage({
      providerName: explicit === 'gcs' ? 'gcs' : 'firebase_storage',
    });
  }

  // Auto-select configured private cloud storage when available
  if (
    (process.env.AZURE_STORAGE_ACCOUNT_NAME || '').trim() &&
    (process.env.AZURE_STORAGE_ACCOUNT_KEY || '').trim() &&
    (process.env.AZURE_STORAGE_CONTAINER_NAME || '').trim()
  ) {
    return new AzureBlobPrivateIntegrationFileStorage();
  }

  if (
    (process.env.FIREBASE_STORAGE_BUCKET || process.env.GCS_BUCKET_NAME || '').trim() &&
    getAdminStorageBucket()
  ) {
    return new CloudBucketIntegrationFileStorage({
      providerName: process.env.GCS_BUCKET_NAME ? 'gcs' : 'firebase_storage',
    });
  }

  // Local private filesystem in dev; fails closed with HTTP 503 in Netlify/serverless
  return new LocalPrivateIntegrationFileStorage();
}
