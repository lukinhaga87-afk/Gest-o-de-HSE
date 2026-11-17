import crypto from 'crypto';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from './notificationEngine';
import {
  AuthConfigError,
  AuthServiceUnavailableError,
  findUserProfileByCpfDigits,
  getValidatedApiAuthSecret,
  hashPasswordBcrypt,
  isValidRole,
  validateRecoveryPasswordStrength,
} from './authMiddleware';
import type {
  Employee,
  PasswordRecoveryChannel,
  PasswordRecoveryGeneratedResult,
  PasswordRecoveryStatus,
  UserProfile,
} from '../src/types/sst';
import { MASTER_ADMIN_USER_ID, LEGACY_MASTER_ADMIN_USER_ID } from '../src/utils/cryptoAuth';
import { formatCPF } from '../src/utils/trafficLight';

export const RECOVERY_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutos
export const RECOVERY_MAX_ATTEMPTS = 5;
export const RECOVERY_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
export const RECOVERY_RATE_MAX_FAILURES = 6;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface StoredRecoveryCodeDoc {
  userId: string;
  cpfDigits: string;
  codeHash: string;
  codeSalt: string;
  canal: PasswordRecoveryChannel;
  status: PasswordRecoveryStatus;
  tentativas: number;
  maxTentativas: number;
  usado: boolean;
  invalidado: boolean;
  geradoPorId?: string;
  geradoPorNome?: string;
  geradoPorCpf?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

interface StoredRateLimitDoc {
  key: string;
  attempts: number;
  windowStart: number;
  blockedUntil?: number;
  updatedAt: string;
}

const memoryRateLimits = new Map<string, StoredRateLimitDoc>();

export class RecoveryRateLimitError extends Error {
  readonly code = 'RECOVERY_RATE_LIMITED';
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'RecoveryRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RecoveryValidationError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(message: string, code = 'RECOVERY_INVALID', httpStatus = 400) {
    super(message);
    this.name = 'RecoveryValidationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class RecoveryChannelUnconfiguredError extends Error {
  readonly code = 'RECOVERY_CHANNEL_UNCONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryChannelUnconfiguredError';
  }
}

export function normalizeRecoveryCodeInput(rawCode: unknown): string {
  if (typeof rawCode !== 'string') return '';
  return rawCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function generateRawRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) {
    raw += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function hashRecoveryCode(normalizedCode: string, salt: string, serverSecret: string): string {
  return crypto
    .createHmac('sha256', serverSecret)
    .update(`${salt}:${normalizedCode}`)
    .digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function makeRateLimitDocId(scope: 'ip' | 'cpf', rawIdentifier: string): string {
  const digest = crypto.createHash('sha256').update(`${scope}:${rawIdentifier}`).digest('hex').slice(0, 32);
  return `rl_${scope}_${digest}`;
}

export async function assertRecoveryNotRateLimited(params: {
  ip?: string;
  cpfDigits?: string;
}): Promise<void> {
  const now = Date.now();
  const keys: string[] = [];
  if (params.ip && params.ip.trim()) {
    keys.push(makeRateLimitDocId('ip', params.ip.trim()));
  }
  if (params.cpfDigits && params.cpfDigits.length === 11) {
    keys.push(makeRateLimitDocId('cpf', params.cpfDigits));
  }

  for (const key of keys) {
    const mem = memoryRateLimits.get(key);
    if (mem?.blockedUntil && mem.blockedUntil > now) {
      const waitSec = Math.max(1, Math.ceil((mem.blockedUntil - now) / 1000));
      throw new RecoveryRateLimitError(
        'Muitas tentativas incorretas de recuperação. Aguarde alguns minutos antes de tentar novamente.',
        waitSec
      );
    }

    try {
      const snap = await getDoc(doc(db, 'passwordRecoveryRateLimits', key));
      if (snap.exists()) {
        const data = snap.data() as StoredRateLimitDoc;
        memoryRateLimits.set(key, data);
        if (data.blockedUntil && data.blockedUntil > now) {
          const waitSec = Math.max(1, Math.ceil((data.blockedUntil - now) / 1000));
          throw new RecoveryRateLimitError(
            'Muitas tentativas incorretas de recuperação. Aguarde alguns minutos antes de tentar novamente.',
            waitSec
          );
        }
      }
    } catch (err) {
      if (err instanceof RecoveryRateLimitError) throw err;
      // Fail-safe: fall back to memory rate limiter if rate-limit doc lookup errors transiently
      console.warn('[PasswordRecovery] Aviso ao ler limite de taxa no Firestore:', err);
    }
  }
}

export async function recordRecoveryFailure(params: {
  ip?: string;
  cpfDigits?: string;
}): Promise<void> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const keys: string[] = [];
  if (params.ip && params.ip.trim()) {
    keys.push(makeRateLimitDocId('ip', params.ip.trim()));
  }
  if (params.cpfDigits && params.cpfDigits.length === 11) {
    keys.push(makeRateLimitDocId('cpf', params.cpfDigits));
  }

  for (const key of keys) {
    let current = memoryRateLimits.get(key);
    if (!current) {
      try {
        const snap = await getDoc(doc(db, 'passwordRecoveryRateLimits', key));
        if (snap.exists()) {
          current = snap.data() as StoredRateLimitDoc;
        }
      } catch {
        // Ignore transient read failure
      }
    }

    const windowExpired = !current || now - current.windowStart > RECOVERY_RATE_WINDOW_MS;
    const nextAttempts = windowExpired ? 1 : (current?.attempts || 0) + 1;
    const windowStart = windowExpired ? now : current!.windowStart;
    const blockedUntil =
      nextAttempts >= RECOVERY_RATE_MAX_FAILURES ? now + RECOVERY_RATE_WINDOW_MS : undefined;

    const updated: StoredRateLimitDoc = {
      key,
      attempts: nextAttempts,
      windowStart,
      ...(blockedUntil ? { blockedUntil } : {}),
      updatedAt: nowIso,
    };

    memoryRateLimits.set(key, updated);
    try {
      await setDoc(doc(db, 'passwordRecoveryRateLimits', key), updated);
    } catch (err) {
      console.warn('[PasswordRecovery] Falha ao persistir limite de taxa:', err);
    }
  }
}

export async function clearRecoveryFailures(params: {
  ip?: string;
  cpfDigits?: string;
}): Promise<void> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const keys: string[] = [];
  if (params.ip && params.ip.trim()) {
    keys.push(makeRateLimitDocId('ip', params.ip.trim()));
  }
  if (params.cpfDigits && params.cpfDigits.length === 11) {
    keys.push(makeRateLimitDocId('cpf', params.cpfDigits));
  }

  for (const key of keys) {
    const resetDoc: StoredRateLimitDoc = {
      key,
      attempts: 0,
      windowStart: now,
      updatedAt: nowIso,
    };
    memoryRateLimits.set(key, resetDoc);
    try {
      await setDoc(doc(db, 'passwordRecoveryRateLimits', key), resetDoc);
    } catch {
      // Ignore cleanup failures
    }
  }
}

async function invalidateActiveCodesForUser(
  userId: string,
  reasonStatus: 'substituido' | 'utilizado' = 'substituido',
  excludeCodeId?: string
): Promise<void> {
  const q = query(collection(db, 'passwordRecoveryCodes'), where('userId', '==', userId));
  const snap = await getDocs(q);
  for (const codeDoc of snap.docs) {
    if (excludeCodeId && codeDoc.id === excludeCodeId) continue;
    const data = codeDoc.data() as StoredRecoveryCodeDoc;
    if (!data.usado && !data.invalidado && data.status === 'ativo') {
      await setDoc(
        doc(db, 'passwordRecoveryCodes', codeDoc.id),
        {
          invalidado: true,
          status: reasonStatus,
        },
        { merge: true }
      );
    }
  }
}

async function createAndStoreRecoveryCode(params: {
  userId: string;
  cpfDigits: string;
  canal: PasswordRecoveryChannel;
  geradoPorId: string;
  geradoPorNome: string;
  geradoPorCpf: string;
}): Promise<{ codeId: string; formattedCode: string; expiresAt: string; createdAt: string }> {
  const secret = getValidatedApiAuthSecret();
  if (!secret) {
    throw new AuthConfigError(
      'Serviço de recuperação indisponível: API_AUTH_SECRET ausente ou inválido no servidor.'
    );
  }

  await invalidateActiveCodesForUser(params.userId, 'substituido');

  const formattedCode = generateRawRecoveryCode();
  const normalizedCode = normalizeRecoveryCodeInput(formattedCode);
  const codeSalt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashRecoveryCode(normalizedCode, codeSalt, secret);

  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + RECOVERY_CODE_TTL_MS).toISOString();
  const codeId = `prc_${nowMs}_${crypto.randomBytes(6).toString('hex')}`;

  const docPayload: StoredRecoveryCodeDoc = {
    userId: params.userId,
    cpfDigits: params.cpfDigits,
    codeHash,
    codeSalt,
    canal: params.canal,
    status: 'ativo',
    tentativas: 0,
    maxTentativas: RECOVERY_MAX_ATTEMPTS,
    usado: false,
    invalidado: false,
    geradoPorId: params.geradoPorId,
    geradoPorNome: params.geradoPorNome,
    geradoPorCpf: params.geradoPorCpf,
    createdAt,
    expiresAt,
  };

  await setDoc(doc(db, 'passwordRecoveryCodes', codeId), docPayload);

  return { codeId, formattedCode, expiresAt, createdAt };
}

/**
 * OPÇÃO A – Administrador de EHS gera código temporário (10 min, uso único) para um usuário.
 */
export async function adminGenerateRecoveryCode(params: {
  targetUserId?: string;
  targetCpf?: string;
  adminUser: { id: string; nome: string; cpf: string; email: string };
}): Promise<PasswordRecoveryGeneratedResult> {
  if (!getValidatedApiAuthSecret()) {
    throw new AuthConfigError('API_AUTH_SECRET não configurado ou inválido no servidor.');
  }

  let matched: { id: string; data: UserProfile } | null = null;

  try {
    if (params.targetUserId && params.targetUserId.trim()) {
      const snap = await getDoc(doc(db, 'userProfiles', params.targetUserId.trim()));
      if (snap.exists()) {
        matched = { id: snap.id, data: snap.data() as UserProfile };
      }
    }

    if (!matched && params.targetCpf) {
      const digits = params.targetCpf.replace(/\D/g, '');
      if (digits.length === 11) {
        matched = await findUserProfileByCpfDigits(digits);
      }
    }
  } catch (err) {
    if (err instanceof AuthServiceUnavailableError) throw err;
    console.error('[PasswordRecovery] Erro ao localizar usuário no Firestore:', err);
    throw new AuthServiceUnavailableError('Banco de dados de usuários indisponível.');
  }

  if (!matched) {
    throw new RecoveryValidationError('Usuário não encontrado no cadastro oficial.', 'USER_NOT_FOUND', 404);
  }

  const targetDigits = (matched.data.cpf || matched.data.username || '').replace(/\D/g, '');
  if (targetDigits.length !== 11 || !isValidRole(matched.data.role)) {
    throw new RecoveryValidationError(
      'Usuário selecionado não possui CPF ou perfil válido para recuperação.',
      'INVALID_USER_PROFILE',
      400
    );
  }

  const created = await createAndStoreRecoveryCode({
    userId: matched.id,
    cpfDigits: targetDigits,
    canal: 'admin',
    geradoPorId: params.adminUser.id,
    geradoPorNome: params.adminUser.nome,
    geradoPorCpf: params.adminUser.cpf,
  });

  const formattedTargetCpf = formatCPF(targetDigits);

  try {
    await addDoc(collection(db, 'auditLogs'), {
      usuario: params.adminUser.nome,
      usuarioEmail: params.adminUser.email,
      acao: 'Geração de Código de Recuperação',
      entidade: 'Usuários',
      entidadeId: matched.id,
      detalhes: `Administrador ${params.adminUser.nome} gerou código temporário (10 min, ID ${created.codeId}) para ${matched.data.nome} (CPF: ${formattedTargetCpf})`,
      dataHora: created.createdAt,
    });
  } catch (auditErr) {
    console.warn('[AuditLog] Falha ao registrar geração de código de recuperação:', auditErr);
  }

  return {
    codeId: created.codeId,
    code: created.formattedCode,
    expiresAt: created.expiresAt,
    ttlMinutes: 10,
    targetUser: {
      id: matched.id,
      nome: matched.data.nome,
      cpf: formattedTargetCpf,
      role: matched.data.role,
    },
  };
}

/**
 * OPÇÃO B – Status e envio real via WhatsApp ou SMS (nunca simula quando não configurado).
 */
export function getRecoveryChannelsStatus(): {
  whatsappConfigured: boolean;
  smsConfigured: boolean;
} {
  const hasTwilioCore = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim()
  );

  const whatsappConfigured = Boolean(
    (process.env.WHATSAPP_API_URL?.trim() && process.env.WHATSAPP_API_TOKEN?.trim()) ||
      (hasTwilioCore && process.env.TWILIO_WHATSAPP_FROM?.trim())
  );

  const smsConfigured = Boolean(
    (process.env.SMS_WEBHOOK_URL?.trim() && process.env.SMS_API_TOKEN?.trim()) ||
      (hasTwilioCore && process.env.TWILIO_SMS_FROM?.trim())
  );

  return { whatsappConfigured, smsConfigured };
}

async function resolvePhoneForUser(userId: string, cpfDigits: string, userData: UserProfile): Promise<string | null> {
  const directPhone = (userData.telefone || '').replace(/\D/g, '');
  if (directPhone.length >= 10) {
    return directPhone;
  }

  try {
    const empSnap = await getDocs(collection(db, 'employees'));
    for (const d of empSnap.docs) {
      const emp = d.data() as Employee;
      const empCpf = (emp.cpf || '').replace(/\D/g, '');
      if (empCpf === cpfDigits && emp.telefone) {
        const cleanPhone = emp.telefone.replace(/\D/g, '');
        if (cleanPhone.length >= 10) return cleanPhone;
      }
    }
  } catch {
    // Ignore optional phone fallback lookup error
  }
  return null;
}

async function sendRealChannelMessage(params: {
  canal: 'whatsapp' | 'sms';
  phoneDigits: string;
  code: string;
  nome: string;
}): Promise<void> {
  const messageBody = `EHS More: seu código temporário de recuperação de senha é ${params.code}. Válido por 10 minutos e de uso único. Não compartilhe este código.`;
  const e164Phone = params.phoneDigits.startsWith('55') ? `+${params.phoneDigits}` : `+55${params.phoneDigits}`;

  if (params.canal === 'whatsapp') {
    const customUrl = process.env.WHATSAPP_API_URL?.trim();
    const customToken = process.env.WHATSAPP_API_TOKEN?.trim();
    if (customUrl && customToken) {
      const resp = await fetch(customUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customToken}`,
        },
        body: JSON.stringify({
          to: e164Phone,
          message: messageBody,
          recipientName: params.nome,
        }),
      });
      if (!resp.ok) {
        throw new Error(`Falha ao enviar mensagem WhatsApp (HTTP ${resp.status}).`);
      }
      return;
    }

    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const auth = process.env.TWILIO_AUTH_TOKEN?.trim();
    const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
    if (sid && auth && from) {
      const body = new URLSearchParams({
        To: `whatsapp:${e164Phone}`,
        From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        Body: messageBody,
      });
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!resp.ok) {
        throw new Error(`Falha ao enviar mensagem Twilio WhatsApp (HTTP ${resp.status}).`);
      }
      return;
    }
  }

  if (params.canal === 'sms') {
    const smsUrl = process.env.SMS_WEBHOOK_URL?.trim();
    const smsToken = process.env.SMS_API_TOKEN?.trim();
    if (smsUrl && smsToken) {
      const resp = await fetch(smsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${smsToken}`,
        },
        body: JSON.stringify({
          to: e164Phone,
          message: messageBody,
          recipientName: params.nome,
        }),
      });
      if (!resp.ok) {
        throw new Error(`Falha ao enviar SMS (HTTP ${resp.status}).`);
      }
      return;
    }

    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const auth = process.env.TWILIO_AUTH_TOKEN?.trim();
    const from = process.env.TWILIO_SMS_FROM?.trim();
    if (sid && auth && from) {
      const body = new URLSearchParams({
        To: e164Phone,
        From: from,
        Body: messageBody,
      });
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!resp.ok) {
        throw new Error(`Falha ao enviar Twilio SMS (HTTP ${resp.status}).`);
      }
      return;
    }
  }

  throw new RecoveryChannelUnconfiguredError(
    `Serviço de envio via ${params.canal === 'whatsapp' ? 'WhatsApp' : 'SMS'} não configurado no servidor.`
  );
}

/**
 * Solicitação de envio via WhatsApp ou SMS (Opção B).
 * Nunca simula envio quando não configurado e nunca revela se o CPF está cadastrado.
 */
export async function requestChannelRecoveryCode(params: {
  cpf: string;
  canal: 'whatsapp' | 'sms';
  ip?: string;
}): Promise<{ message: string }> {
  if (!getValidatedApiAuthSecret()) {
    throw new AuthConfigError('API_AUTH_SECRET não configurado ou inválido no servidor.');
  }

  const status = getRecoveryChannelsStatus();
  const isChannelConfigured =
    (params.canal === 'whatsapp' && status.whatsappConfigured) ||
    (params.canal === 'sms' && status.smsConfigured);

  if (!isChannelConfigured) {
    throw new RecoveryChannelUnconfiguredError(
      `O envio automático por ${params.canal === 'whatsapp' ? 'WhatsApp' : 'SMS'} não está configurado no servidor. Solicite o código temporário ao Administrador de EHS.`
    );
  }

  const cpfDigits = (params.cpf || '').replace(/\D/g, '');
  if (cpfDigits.length !== 11) {
    throw new RecoveryValidationError('Informe um CPF válido com 11 dígitos.', 'INVALID_CPF', 400);
  }

  await assertRecoveryNotRateLimited({ ip: params.ip, cpfDigits });

  const matched = await findUserProfileByCpfDigits(cpfDigits);
  if (matched && isValidRole(matched.data.role)) {
    const phoneDigits = await resolvePhoneForUser(matched.id, cpfDigits, matched.data);
    if (phoneDigits) {
      const created = await createAndStoreRecoveryCode({
        userId: matched.id,
        cpfDigits,
        canal: params.canal,
        geradoPorId: `canal:${params.canal}`,
        geradoPorNome: `Envio Automático (${params.canal.toUpperCase()})`,
        geradoPorCpf: formatCPF(cpfDigits),
      });

      await sendRealChannelMessage({
        canal: params.canal,
        phoneDigits,
        code: created.formattedCode,
        nome: matched.data.nome,
      });

      try {
        await addDoc(collection(db, 'auditLogs'), {
          usuario: matched.data.nome,
          usuarioEmail: matched.data.email || '',
          acao: 'Envio de Código de Recuperação',
          entidade: 'Usuários',
          entidadeId: matched.id,
          detalhes: `Código temporário (ID ${created.codeId}) enviado via ${params.canal.toUpperCase()} para CPF ${formatCPF(cpfDigits)}`,
          dataHora: created.createdAt,
        });
      } catch {
        // Non-blocking audit log warning
      }
    }
  }

  // Uniform response to prevent CPF enumeration
  return {
    message:
      'Se o CPF informado estiver cadastrado e possuir telefone habilitado, o código temporário de recuperação será enviado.',
  };
}

interface VerifiedCodeMatch {
  userId: string;
  userData: UserProfile;
  cpfDigits: string;
  codeId: string;
  codeDoc: StoredRecoveryCodeDoc;
}

async function verifyActiveRecoveryCodeInternal(params: {
  cpf: string;
  code: string;
  ip?: string;
}): Promise<VerifiedCodeMatch> {
  const secret = getValidatedApiAuthSecret();
  if (!secret) {
    throw new AuthConfigError('API_AUTH_SECRET não configurado ou inválido no servidor.');
  }

  const cpfDigits = (params.cpf || '').replace(/\D/g, '');
  const normalizedCode = normalizeRecoveryCodeInput(params.code);

  await assertRecoveryNotRateLimited({ ip: params.ip, cpfDigits });

  if (cpfDigits.length !== 11 || normalizedCode.length < 6) {
    await recordRecoveryFailure({ ip: params.ip, cpfDigits });
    throw new RecoveryValidationError('Código inválido ou expirado.', 'INVALID_OR_EXPIRED_CODE', 400);
  }

  const matchedUser = await findUserProfileByCpfDigits(cpfDigits);
  if (!matchedUser || !isValidRole(matchedUser.data.role)) {
    await recordRecoveryFailure({ ip: params.ip, cpfDigits });
    throw new RecoveryValidationError('Código inválido ou expirado.', 'INVALID_OR_EXPIRED_CODE', 400);
  }

  // Enforce Master Admin safeguard
  if (
    (matchedUser.id === MASTER_ADMIN_USER_ID || matchedUser.id === LEGACY_MASTER_ADMIN_USER_ID) &&
    matchedUser.data.role !== 'admin'
  ) {
    await recordRecoveryFailure({ ip: params.ip, cpfDigits });
    throw new RecoveryValidationError('Código inválido ou expirado.', 'INVALID_OR_EXPIRED_CODE', 400);
  }

  const q = query(collection(db, 'passwordRecoveryCodes'), where('userId', '==', matchedUser.id));
  const codesSnap = await getDocs(q);

  const nowMs = Date.now();
  const activeDocs = codesSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as StoredRecoveryCodeDoc }))
    .filter((entry) => !entry.data.usado && !entry.data.invalidado && entry.data.status === 'ativo')
    .sort((a, b) => Date.parse(b.data.createdAt) - Date.parse(a.data.createdAt));

  if (activeDocs.length === 0) {
    await recordRecoveryFailure({ ip: params.ip, cpfDigits });
    throw new RecoveryValidationError('Código inválido ou expirado.', 'INVALID_OR_EXPIRED_CODE', 400);
  }

  // Expire outdated active codes and inspect the newest valid candidate
  let validCandidate: { id: string; data: StoredRecoveryCodeDoc } | null = null;
  for (const candidate of activeDocs) {
    const expMs = Date.parse(candidate.data.expiresAt);
    if (!Number.isFinite(expMs) || nowMs > expMs) {
      await setDoc(
        doc(db, 'passwordRecoveryCodes', candidate.id),
        { invalidado: true, status: 'expirado' },
        { merge: true }
      );
      continue;
    }
    if (!validCandidate) {
      validCandidate = candidate;
    }
  }

  if (!validCandidate) {
    await recordRecoveryFailure({ ip: params.ip, cpfDigits });
    throw new RecoveryValidationError('Código inválido ou expirado.', 'INVALID_OR_EXPIRED_CODE', 400);
  }

  if (validCandidate.data.tentativas >= validCandidate.data.maxTentativas) {
    await setDoc(
      doc(db, 'passwordRecoveryCodes', validCandidate.id),
      { invalidado: true, status: 'bloqueado' },
      { merge: true }
    );
    await recordRecoveryFailure({ ip: params.ip, cpfDigits });
    throw new RecoveryValidationError('Código inválido ou expirado.', 'INVALID_OR_EXPIRED_CODE', 400);
  }

  const expectedHash = hashRecoveryCode(normalizedCode, validCandidate.data.codeSalt, secret);
  if (!timingSafeHexEqual(expectedHash, validCandidate.data.codeHash)) {
    const nextTentativas = validCandidate.data.tentativas + 1;
    const hitLimit = nextTentativas >= validCandidate.data.maxTentativas;

    await setDoc(
      doc(db, 'passwordRecoveryCodes', validCandidate.id),
      {
        tentativas: nextTentativas,
        ...(hitLimit ? { invalidado: true, status: 'bloqueado' } : {}),
      },
      { merge: true }
    );

    if (hitLimit) {
      try {
        await addDoc(collection(db, 'auditLogs'), {
          usuario: matchedUser.data.nome,
          usuarioEmail: matchedUser.data.email || '',
          acao: 'Bloqueio de Código de Recuperação',
          entidade: 'Usuários',
          entidadeId: matchedUser.id,
          detalhes: `Código temporário (ID ${validCandidate.id}) bloqueado após ${nextTentativas} tentativas inválidas para CPF ${formatCPF(cpfDigits)}`,
          dataHora: new Date().toISOString(),
        });
      } catch {
        // Non-blocking audit log warning
      }
    }

    await recordRecoveryFailure({ ip: params.ip, cpfDigits });
    throw new RecoveryValidationError('Código inválido ou expirado.', 'INVALID_OR_EXPIRED_CODE', 400);
  }

  return {
    userId: matchedUser.id,
    userData: matchedUser.data,
    cpfDigits,
    codeId: validCandidate.id,
    codeDoc: validCandidate.data,
  };
}

/**
 * Verificação prévia opcional (sem consumir o código ainda, mas com controle de tentativas e sigilo de CPF).
 */
export async function verifyRecoveryCodeStatus(params: {
  cpf: string;
  code: string;
  ip?: string;
}): Promise<{ valid: true }> {
  await verifyActiveRecoveryCodeInternal(params);
  return { valid: true };
}

/**
 * Valida código de uso único + requisitos mínimos de senha, redefine via bcrypt,
 * invalida o código utilizado e incrementa tokenVersion para encerrar sessões anteriores.
 */
export async function resetPasswordWithRecoveryCode(params: {
  cpf: string;
  code: string;
  newPassword: string;
  confirmPassword?: string;
  ip?: string;
}): Promise<{ message: string }> {
  const verified = await verifyActiveRecoveryCodeInternal({
    cpf: params.cpf,
    code: params.code,
    ip: params.ip,
  });

  if (
    typeof params.confirmPassword === 'string' &&
    params.newPassword.trim() !== params.confirmPassword.trim()
  ) {
    throw new RecoveryValidationError(
      'A confirmação da nova senha não confere.',
      'PASSWORD_CONFIRMATION_MISMATCH',
      400
    );
  }

  const strengthCheck = validateRecoveryPasswordStrength(params.newPassword, verified.cpfDigits);
  if (!strengthCheck.valid) {
    throw new RecoveryValidationError(
      strengthCheck.message || 'A nova senha não atende aos requisitos mínimos de segurança.',
      'WEAK_PASSWORD',
      400
    );
  }

  const newPasswordHash = await hashPasswordBcrypt(params.newPassword);
  const nowIso = new Date().toISOString();
  const nextTokenVersion =
    (typeof verified.userData.tokenVersion === 'number' ? verified.userData.tokenVersion : 1) + 1;

  try {
    // Update ONLY password & session revocation fields without modifying profile/role/permissions
    await setDoc(
      doc(db, 'userProfiles', verified.userId),
      {
        passwordHash: newPasswordHash,
        hashAlgorithm: 'bcrypt',
        passwordResetRequired: false,
        tokenVersion: nextTokenVersion,
        passwordChangedAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    await setDoc(
      doc(db, 'passwordRecoveryCodes', verified.codeId),
      {
        usado: true,
        invalidado: true,
        status: 'utilizado',
        usedAt: nowIso,
      },
      { merge: true }
    );

    await invalidateActiveCodesForUser(verified.userId, 'substituido', verified.codeId);
  } catch (err) {
    console.error('[PasswordRecovery] Erro ao persistir redefinição de senha:', err);
    throw new AuthServiceUnavailableError(
      'Não foi possível concluir a recuperação no banco de dados. Tente novamente.'
    );
  }

  await clearRecoveryFailures({ ip: params.ip, cpfDigits: verified.cpfDigits });

  try {
    const channelLabel =
      verified.codeDoc.canal === 'admin'
        ? `Administrador ${verified.codeDoc.geradoPorNome || 'EHS'}`
        : `Canal ${verified.codeDoc.canal.toUpperCase()}`;

    await addDoc(collection(db, 'auditLogs'), {
      usuario: verified.userData.nome,
      usuarioEmail: verified.userData.email || '',
      acao: 'Redefinição de Senha por Código',
      entidade: 'Usuários',
      entidadeId: verified.userId,
      detalhes: `Senha redefinida para ${verified.userData.nome} (CPF: ${formatCPF(verified.cpfDigits)}, perfil: ${verified.userData.role.toUpperCase()}) utilizando código ${verified.codeId} gerado por ${channelLabel}. Sessões anteriores revogadas (versão ${nextTokenVersion}).`,
      dataHora: nowIso,
    });
  } catch (auditErr) {
    console.warn('[AuditLog] Falha ao registrar redefinição de senha:', auditErr);
  }

  return {
    message: 'Senha alterada com sucesso.',
  };
}
