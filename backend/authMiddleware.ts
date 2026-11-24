import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import {
  serverGetDoc,
  serverListCollection,
  serverSetDoc,
} from './firestoreServer';
import {
  MASTER_ADMIN_USER_ID,
  LEGACY_MASTER_ADMIN_USER_ID,
  isMasterAdminIdentifier,
} from '../src/utils/cryptoAuth';
import type { UserProfile, UserRole } from '../src/types/sst';

const BCRYPT_SALT_ROUNDS = 12;
const MIN_SECRET_LENGTH = 32;
const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const DEFAULT_FILE_TICKET_TTL_SECONDS = 60;
const MIN_FILE_TICKET_TTL_SECONDS = 10;
const MAX_FILE_TICKET_TTL_SECONDS = 300;

// SHA-256 digests of forbidden legacy/default passwords (never stored in plaintext)
const FORBIDDEN_DEFAULT_PASSWORD_DIGESTS = new Set([
  '74645af5ce3d5558282b828e2d3dfc8f70407c127fca70c655943b528453abb4',
  '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
  'da8b44d75fa56fbe3a69d2a0665c29cff6e8e4e74184a6558084eb1108cf4d98',
]);

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'CONFIGURE_A_STRONG_RANDOM_SECRET_IN_NETLIFY',
  'CHANGE_ME_TO_A_RANDOM_32_CHAR_SECRET',
  'gestao-sst-internal-key',
]);

export class AuthConfigError extends Error {
  readonly code = 'AUTH_CONFIG_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

export class AuthServiceUnavailableError extends Error {
  readonly code = 'AUTH_SERVICE_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'AuthServiceUnavailableError';
  }
}

export interface AuthTokenPayload {
  sub: string;
  cpf: string;
  email: string;
  nome: string;
  role: UserRole;
  ver?: number;
  iat: number;
  exp: number;
}

export interface FileAccessTicketPayload {
  typ: 'EHS_FILE_TICKET';
  sub: string;
  role: UserRole;
  ver: number;
  empresaId?: string;
  integrationId: string;
  itemId: string;
  version?: number;
  iat: number;
  exp: number;
}

export interface SanitizedUserProfile {
  id: string;
  cpf: string;
  username: string;
  email: string;
  nome: string;
  role: UserRole;
  empresaId?: string;
  empresaNome?: string;
  cargo?: string;
  telefone?: string;
  fotoPerfilUrl?: string;
  hashAlgorithm?: 'bcrypt';
  passwordResetRequired?: boolean;
  tokenVersion?: number;
  passwordChangedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthTokenPayload;
  officialProfile?: SanitizedUserProfile;
  tokenRoleDiverged?: boolean;
}

const VALID_ROLES = new Set<UserRole>(['admin', 'solicitante', 'auditor']);

export function isValidRole(role: unknown): role is UserRole {
  return typeof role === 'string' && VALID_ROLES.has(role as UserRole);
}

/**
 * Validates API_AUTH_SECRET strictly from server environment variables.
 * Never derives fallback secrets from Firebase config, SMTP_PASS, or hardcoded strings.
 */
export function getValidatedApiAuthSecret(): string | null {
  const raw = process.env.API_AUTH_SECRET;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

  if (
    trimmed.length < MIN_SECRET_LENGTH ||
    KNOWN_PLACEHOLDER_SECRETS.has(trimmed) ||
    new Set(trimmed).size < 8
  ) {
    console.error(
      '[AuthSecurity] ERRO CRÍTICO: API_AUTH_SECRET ausente, fraca ou inválida (exige mínimo de 32 caracteres aleatórios). Emissão e validação de tokens bloqueadas.'
    );
    return null;
  }

  return trimmed;
}

export function isForbiddenWeakPassword(password: string): boolean {
  const trimmed = password.trim();
  if (!trimmed) return true;
  const digest = crypto.createHash('sha256').update(trimmed).digest('hex');
  return FORBIDDEN_DEFAULT_PASSWORD_DIGESTS.has(digest);
}

export function isBcryptHash(hash?: string): boolean {
  return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(hash);
}

export function validateRecoveryPasswordStrength(
  password: string,
  userCpfDigits?: string
): { valid: boolean; message?: string } {
  const trimmed = typeof password === 'string' ? password.trim() : '';
  if (trimmed.length < 8) {
    return {
      valid: false,
      message: 'A nova senha deve conter no mínimo 8 caracteres.',
    };
  }
  if (trimmed.length > 128) {
    return {
      valid: false,
      message: 'A nova senha não pode exceder 128 caracteres.',
    };
  }
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(trimmed) || !/\d/.test(trimmed)) {
    return {
      valid: false,
      message: 'A nova senha deve combinar letras e números.',
    };
  }
  if (isForbiddenWeakPassword(trimmed)) {
    return {
      valid: false,
      message: 'Senha padrão ou insegura não permitida. Defina uma senha exclusiva.',
    };
  }
  const cleanPassDigits = trimmed.replace(/\D/g, '');
  if (userCpfDigits && cleanPassDigits === userCpfDigits) {
    return {
      valid: false,
      message: 'A nova senha não pode ser igual ao número do CPF.',
    };
  }
  const commonWeakPasswords = new Set([
    'senha123',
    'senha1234',
    'admin1234',
    'qwerty12',
    'qwerty123',
    'password1',
    'ehs12345',
    'sst12345',
    'mudar123',
    'trocar123',
  ]);
  if (commonWeakPasswords.has(trimmed.toLowerCase())) {
    return {
      valid: false,
      message: 'Escolha uma senha mais forte e menos previsível.',
    };
  }
  return { valid: true };
}

export async function hashPasswordBcrypt(password: string): Promise<string> {
  const trimmed = password.trim();
  if (trimmed.length < 6) {
    throw new Error('A senha deve conter no mínimo 6 caracteres.');
  }
  if (isForbiddenWeakPassword(trimmed)) {
    throw new Error('Senha padrão não permitida. Defina uma senha forte e exclusiva.');
  }
  return bcrypt.hash(trimmed, BCRYPT_SALT_ROUNDS);
}

export async function verifyPasswordBcrypt(password: string, storedHash?: string): Promise<boolean> {
  if (!password || !storedHash) return false;
  const trimmed = password.trim();
  if (!trimmed || isForbiddenWeakPassword(trimmed)) {
    return false;
  }
  if (!isBcryptHash(storedHash)) {
    return false;
  }
  return bcrypt.compare(trimmed, storedHash);
}

export function sanitizeUserProfile(id: string, data: Partial<UserProfile>): SanitizedUserProfile {
  const safe: SanitizedUserProfile = {
    id,
    cpf: data.cpf || data.username || '',
    username: data.username || data.cpf || '',
    email: data.email || '',
    nome: data.nome || '',
    role: isValidRole(data.role) ? data.role : 'auditor',
  };

  if (data.empresaId) safe.empresaId = data.empresaId;
  if (data.empresaNome) safe.empresaNome = data.empresaNome;
  if (data.cargo) safe.cargo = data.cargo;
  if (data.telefone) safe.telefone = data.telefone;
  if (data.fotoPerfilUrl) safe.fotoPerfilUrl = data.fotoPerfilUrl;
  if (data.hashAlgorithm === 'bcrypt') safe.hashAlgorithm = 'bcrypt';
  if (typeof data.passwordResetRequired === 'boolean') {
    safe.passwordResetRequired = data.passwordResetRequired;
  }
  if (typeof data.tokenVersion === 'number') safe.tokenVersion = data.tokenVersion;
  if (data.passwordChangedAt) safe.passwordChangedAt = data.passwordChangedAt;
  if (data.createdAt) safe.createdAt = data.createdAt;
  if (data.updatedAt) safe.updatedAt = data.updatedAt;

  return safe;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  let padded = input.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4 !== 0) {
    padded += '=';
  }
  return Buffer.from(padded, 'base64').toString('utf8');
}

function timingSafeSha256Match(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function signAuthToken(user: {
  id: string;
  cpf: string;
  email: string;
  nome: string;
  role: UserRole;
  tokenVersion?: number;
}): { token: string; expiresAt: number } {
  const secret = getValidatedApiAuthSecret();
  if (!secret) {
    throw new AuthConfigError('API_AUTH_SECRET não configurado ou inválido no servidor.');
  }
  if (!user.id || !isValidRole(user.role)) {
    throw new Error('Dados de usuário inválidos para emissão de token.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + TOKEN_TTL_SECONDS;
  const ver = typeof user.tokenVersion === 'number' && user.tokenVersion > 0 ? user.tokenVersion : 1;

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadObj: AuthTokenPayload = {
    sub: user.id,
    cpf: user.cpf,
    email: user.email,
    nome: user.nome,
    role: user.role,
    ver,
    iat: nowSec,
    exp: expSec,
  };
  const payload = base64UrlEncode(JSON.stringify(payloadObj));

  const signature = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  );

  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: expSec * 1000,
  };
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const secret = getValidatedApiAuthSecret();
    if (!secret) {
      return null;
    }
    if (typeof token !== 'string' || !token.trim()) {
      return null;
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    if (!headerB64 || !payloadB64 || !sigB64) return null;

    const headerObj = JSON.parse(base64UrlDecode(headerB64)) as { alg?: unknown; typ?: unknown };
    if (!headerObj || headerObj.alg !== 'HS256' || headerObj.typ !== 'JWT') {
      return null;
    }

    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
    );

    const sigBuf = Buffer.from(sigB64);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const decoded = JSON.parse(base64UrlDecode(payloadB64)) as Partial<AuthTokenPayload>;
    if (
      !decoded ||
      typeof decoded.sub !== 'string' ||
      !decoded.sub.trim() ||
      !isValidRole(decoded.role) ||
      typeof decoded.iat !== 'number' ||
      typeof decoded.exp !== 'number' ||
      !Number.isFinite(decoded.iat) ||
      !Number.isFinite(decoded.exp)
    ) {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (decoded.exp <= decoded.iat || decoded.exp <= nowSec || decoded.iat > nowSec + 60) {
      return null;
    }

    return decoded as AuthTokenPayload;
  } catch {
    return null;
  }
}

export function getFileAccessTicketTtlSeconds(requestedTtlSeconds?: number): number {
  const envRaw = Number(process.env.INTEGRATION_FILE_SIGNING_TTL_SECONDS);
  const base =
    typeof requestedTtlSeconds === 'number' && Number.isFinite(requestedTtlSeconds)
      ? Math.floor(requestedTtlSeconds)
      : Number.isFinite(envRaw) && envRaw > 0
      ? Math.floor(envRaw)
      : DEFAULT_FILE_TICKET_TTL_SECONDS;
  return Math.max(MIN_FILE_TICKET_TTL_SECONDS, Math.min(MAX_FILE_TICKET_TTL_SECONDS, base));
}

/**
 * Issues a short-lived, scope-bound, revocable HMAC-SHA256 access ticket for a specific
 * protected integration document item/version. Bound to user tokenVersion so password/role
 * changes or account deletion immediately revoke active tickets.
 */
export function signFileAccessTicket(params: {
  userId: string;
  role: UserRole;
  tokenVersion?: number;
  empresaId?: string;
  integrationId: string;
  itemId: string;
  version?: number;
  ttlSeconds?: number;
  nowMs?: number;
}): { ticket: string; expiresAt: number; ttlSeconds: number } {
  const secret = getValidatedApiAuthSecret();
  if (!secret) {
    throw new AuthConfigError('API_AUTH_SECRET não configurado ou inválido no servidor.');
  }
  if (!params.userId || !isValidRole(params.role) || !params.integrationId || !params.itemId) {
    throw new Error('Parâmetros inválidos para emissão de ticket de acesso documental.');
  }

  const ttlSeconds = getFileAccessTicketTtlSeconds(params.ttlSeconds);
  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  const expSec = nowSec + ttlSeconds;
  const ver =
    typeof params.tokenVersion === 'number' && params.tokenVersion > 0 ? params.tokenVersion : 1;

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'EHS_FILE_TICKET' }));
  const payloadObj: FileAccessTicketPayload = {
    typ: 'EHS_FILE_TICKET',
    sub: params.userId,
    role: params.role,
    ver,
    ...(params.empresaId ? { empresaId: params.empresaId } : {}),
    integrationId: params.integrationId,
    itemId: params.itemId,
    ...(typeof params.version === 'number' && Number.isInteger(params.version) && params.version > 0
      ? { version: params.version }
      : {}),
    iat: nowSec,
    exp: expSec,
  };
  const payload = base64UrlEncode(JSON.stringify(payloadObj));
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(`file-ticket:${header}.${payload}`).digest()
  );

  return {
    ticket: `${header}.${payload}.${signature}`,
    expiresAt: expSec * 1000,
    ttlSeconds,
  };
}

export function verifyFileAccessTicket(
  ticket: string,
  expectedScope?: {
    integrationId?: string;
    itemId?: string;
    version?: number;
    nowMs?: number;
  }
): FileAccessTicketPayload | null {
  try {
    const secret = getValidatedApiAuthSecret();
    if (!secret) return null;
    if (typeof ticket !== 'string' || !ticket.trim()) return null;

    const parts = ticket.trim().split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    if (!headerB64 || !payloadB64 || !sigB64) return null;

    const headerObj = JSON.parse(base64UrlDecode(headerB64)) as { alg?: unknown; typ?: unknown };
    if (!headerObj || headerObj.alg !== 'HS256' || headerObj.typ !== 'EHS_FILE_TICKET') {
      return null;
    }

    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', secret).update(`file-ticket:${headerB64}.${payloadB64}`).digest()
    );
    const sigBuf = Buffer.from(sigB64);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const decoded = JSON.parse(base64UrlDecode(payloadB64)) as Partial<FileAccessTicketPayload>;
    if (
      !decoded ||
      decoded.typ !== 'EHS_FILE_TICKET' ||
      typeof decoded.sub !== 'string' ||
      !decoded.sub.trim() ||
      !isValidRole(decoded.role) ||
      typeof decoded.ver !== 'number' ||
      typeof decoded.integrationId !== 'string' ||
      !decoded.integrationId.trim() ||
      typeof decoded.itemId !== 'string' ||
      !decoded.itemId.trim() ||
      typeof decoded.iat !== 'number' ||
      typeof decoded.exp !== 'number' ||
      !Number.isFinite(decoded.iat) ||
      !Number.isFinite(decoded.exp)
    ) {
      return null;
    }

    const nowSec = Math.floor((expectedScope?.nowMs ?? Date.now()) / 1000);
    if (decoded.exp <= decoded.iat || decoded.exp <= nowSec || decoded.iat > nowSec + 60) {
      return null;
    }

    if (expectedScope?.integrationId && decoded.integrationId !== expectedScope.integrationId) {
      return null;
    }
    if (expectedScope?.itemId && decoded.itemId !== expectedScope.itemId) {
      return null;
    }
    if (
      typeof decoded.version === 'number' &&
      typeof expectedScope?.version === 'number' &&
      decoded.version !== expectedScope.version
    ) {
      return null;
    }

    return decoded as FileAccessTicketPayload;
  } catch {
    return null;
  }
}

/**
 * Verifies user credentials exclusively with plaintext password + bcrypt hash stored in Firestore.
 * Rejects fixed/default passwords, rejects passwordHash-based login, and fails closed if Firestore is unavailable.
 */
export async function authenticateUserCredentials(params: {
  cpfOrIdentifier?: string;
  password?: string;
}): Promise<SanitizedUserProfile | null> {
  const cleanLogin = (params.cpfOrIdentifier || '').trim().toLowerCase();
  const cleanDigits = (params.cpfOrIdentifier || '').replace(/\D/g, '');
  const password = typeof params.password === 'string' ? params.password.trim() : '';

  if ((!cleanLogin && !cleanDigits) || !password) {
    return null;
  }

  if (isForbiddenWeakPassword(password)) {
    return null;
  }

  let userDocs: Array<{ id: string; data: UserProfile }>;
  try {
    userDocs = await serverListCollection<UserProfile>('userProfiles');
  } catch (err) {
    console.error('[AuthMiddleware] Falha ao consultar Firestore userProfiles:', err);
    throw new AuthServiceUnavailableError('Serviço de autenticação indisponível no momento.');
  }

  let matchedDoc: { id: string; data: UserProfile } | null = null;
  for (const docSnap of userDocs) {
    const u = docSnap.data;
    const uDigits = (u.cpf || u.username || '').replace(/\D/g, '');
    const matchCpf = cleanDigits.length > 0 && uDigits === cleanDigits;
    const matchIdentifier =
      (u.cpf && u.cpf.trim().toLowerCase() === cleanLogin) ||
      (u.username && u.username.trim().toLowerCase() === cleanLogin) ||
      (u.email && u.email.trim().toLowerCase() === cleanLogin);

    if (matchCpf || matchIdentifier) {
      matchedDoc = { id: docSnap.id, data: u };
      break;
    }
  }

  if (!matchedDoc) {
    return null;
  }

  const { id, data } = matchedDoc;
  if (!isValidRole(data.role)) {
    return null;
  }

  // Enforce Master Admin safeguard
  if (
    (id === MASTER_ADMIN_USER_ID || id === LEGACY_MASTER_ADMIN_USER_ID) &&
    data.role !== 'admin'
  ) {
    return null;
  }

  // Optional one-time Master Admin bootstrap ONLY via env var when passwordResetRequired is true
  const envBootstrapPass = (process.env.INITIAL_ADMIN_PASSWORD || '').trim();
  if (
    data.passwordResetRequired === true &&
    isMasterAdminIdentifier(id) &&
    envBootstrapPass.length >= 10 &&
    !isForbiddenWeakPassword(envBootstrapPass) &&
    timingSafeSha256Match(password, envBootstrapPass)
  ) {
    const rotatedHash = await hashPasswordBcrypt(password);
    const updatedAt = new Date().toISOString();
    try {
      await serverSetDoc(
        'userProfiles',
        id,
        {
          passwordHash: rotatedHash,
          hashAlgorithm: 'bcrypt',
          passwordResetRequired: false,
          updatedAt,
        },
        { merge: true }
      );
    } catch (err) {
      console.error('[AuthMiddleware] Falha ao concluir ativação inicial do administrador:', err);
      throw new AuthServiceUnavailableError('Serviço de autenticação indisponível no momento.');
    }

    return sanitizeUserProfile(id, {
      ...data,
      hashAlgorithm: 'bcrypt',
      passwordResetRequired: false,
      updatedAt,
    });
  }

  if (data.passwordResetRequired === true) {
    return null;
  }

  const isPasswordValid = await verifyPasswordBcrypt(password, data.passwordHash);
  if (!isPasswordValid) {
    return null;
  }

  return sanitizeUserProfile(id, data);
}

export async function findUserProfileByCpfDigits(
  cpfDigits: string
): Promise<{ id: string; data: UserProfile } | null> {
  const cleanDigits = cpfDigits.replace(/\D/g, '');
  if (cleanDigits.length !== 11) {
    return null;
  }

  let userDocs: Array<{ id: string; data: UserProfile }>;
  try {
    userDocs = await serverListCollection<UserProfile>('userProfiles');
  } catch (err) {
    console.error('[AuthMiddleware] Falha ao consultar Firestore userProfiles:', err);
    throw new AuthServiceUnavailableError('Serviço de autenticação indisponível no momento.');
  }

  for (const docSnap of userDocs) {
    const u = docSnap.data;
    const uDigits = (u.cpf || u.username || '').replace(/\D/g, '');
    if (uDigits === cleanDigits) {
      return { id: docSnap.id, data: u };
    }
  }

  return null;
}

export type AuthoritativeUserLookup = (
  userId: string
) => Promise<{ id: string; data: UserProfile } | null>;

/**
 * Queries official user profile and role in Firestore (fail-closed if Firebase is unavailable).
 * Used for both JWT Bearer sessions and revocable short-lived file access tickets.
 */
export async function resolveAuthoritativeUserByClaim(
  claim: { sub: string; role: UserRole; ver?: number; iat: number },
  customLookup?: AuthoritativeUserLookup
): Promise<{ profile: SanitizedUserProfile; roleDiverged: boolean; sessionRevoked: boolean } | null> {
  let userDoc: { id: string; data: UserProfile } | null;
  try {
    userDoc = customLookup
      ? await customLookup(claim.sub)
      : await serverGetDoc<UserProfile>('userProfiles', claim.sub);
  } catch (err) {
    console.error('[AuthMiddleware] Firestore indisponível ao validar perfil oficial:', err);
    throw new AuthServiceUnavailableError('Banco de dados de usuários indisponível.');
  }

  if (!userDoc) {
    return null;
  }

  const data = userDoc.data;
  if (!isValidRole(data.role)) {
    return null;
  }

  const officialProfile = sanitizeUserProfile(userDoc.id, data);
  const roleDiverged = officialProfile.role !== claim.role;

  const officialVersion = typeof data.tokenVersion === 'number' ? data.tokenVersion : 1;
  const payloadVersion = typeof claim.ver === 'number' ? claim.ver : 1;
  const changedAtMs = data.passwordChangedAt ? Date.parse(data.passwordChangedAt) : NaN;
  const issuedBeforePasswordChange =
    Number.isFinite(changedAtMs) && claim.iat * 1000 < changedAtMs - 1000;
  const sessionRevoked = payloadVersion !== officialVersion || issuedBeforePasswordChange;

  return { profile: officialProfile, roleDiverged, sessionRevoked };
}

async function resolveAuthoritativeUser(
  payload: AuthTokenPayload
): Promise<{ profile: SanitizedUserProfile; roleDiverged: boolean; sessionRevoked: boolean } | null> {
  return resolveAuthoritativeUserByClaim(payload);
}

export function createRequireAuth(customLookup?: AuthoritativeUserLookup) {
  return async function requireAuthHandler(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    if (!getValidatedApiAuthSecret()) {
      return res.status(503).json({
        success: false,
        message: 'Autenticação indisponível: variável API_AUTH_SECRET não configurada corretamente no servidor.',
      });
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Autenticação obrigatória. Token Bearer não informado.',
      });
    }

    const token = authHeader.slice(7).trim();
    const payload = verifyAuthToken(token);
    if (!payload) {
      return res.status(401).json({
        success: false,
        message: 'Sessão inválida ou expirada. Faça login novamente.',
      });
    }

    try {
      const resolved = await resolveAuthoritativeUserByClaim(payload, customLookup);
      if (!resolved) {
        return res.status(401).json({
          success: false,
          message: 'Usuário não encontrado ou acesso revogado.',
        });
      }

      if (resolved.sessionRevoked) {
        return res.status(401).json({
          success: false,
          message: 'Sessão encerrada após alteração ou redefinição de senha. Faça login novamente.',
        });
      }

      // Never trust payload.role: always overwrite authUser with official Firestore values
      req.officialProfile = resolved.profile;
      req.tokenRoleDiverged = resolved.roleDiverged;
      req.authUser = {
        sub: resolved.profile.id,
        cpf: resolved.profile.cpf,
        email: resolved.profile.email,
        nome: resolved.profile.nome,
        role: resolved.profile.role,
        ver: resolved.profile.tokenVersion,
        iat: payload.iat,
        exp: payload.exp,
      };

      next();
    } catch (err) {
      if (err instanceof AuthServiceUnavailableError) {
        return res.status(503).json({
          success: false,
          message: 'Serviço de autenticação temporariamente indisponível. Operação negada por segurança.',
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Erro interno ao validar autenticação.',
      });
    }
  };
}

export const requireAuth = createRequireAuth();

export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado. Operação exclusiva para Administradores de EHS.',
      });
    }
    if (req.tokenRoleDiverged) {
      return res.status(401).json({
        success: false,
        message: 'Token incompatível com o perfil oficial atual. Faça login novamente.',
      });
    }
    next();
  });
}

export async function requireAuthenticatedEditor(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  await requireAuth(req, res, () => {
    if (!req.authUser || (req.authUser.role !== 'admin' && req.authUser.role !== 'solicitante')) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado. Permissão insuficiente para esta operação.',
      });
    }
    if (req.tokenRoleDiverged) {
      return res.status(401).json({
        success: false,
        message: 'Token incompatível com o perfil oficial atual. Faça login novamente.',
      });
    }
    next();
  });
}
