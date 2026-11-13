/**
 * Identificadores públicos do Administrador Mestre EHS (sem credenciais ou senhas fixas).
 * Toda verificação e geração de hash de senha (bcrypt) ocorre exclusivamente no backend.
 */
export const MASTER_ADMIN_USER_ID = 'user-452.066.308-37';
export const LEGACY_MASTER_ADMIN_USER_ID = 'user-543.066.308-37';
export const MASTER_ADMIN_CPF = '452.066.308-37';
export const MASTER_ADMIN_DEFAULT_NAME = 'Lucas Valdeci Gonçalves';
export const MASTER_ADMIN_DEFAULT_EMAIL = 'lucastecseg1@gmail.com';

export function isMasterAdminIdentifier(idOrCpf?: string | null): boolean {
  if (!idOrCpf) return false;
  const trimmed = idOrCpf.trim();
  const digits = trimmed.replace(/\D/g, '');
  return (
    trimmed === MASTER_ADMIN_USER_ID ||
    trimmed === LEGACY_MASTER_ADMIN_USER_ID ||
    digits === '45206630837' ||
    digits === '54306630837'
  );
}
