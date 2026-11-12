/**
 * Utility for hashing and verifying passwords using Web Crypto API (SHA-256)
 */
export async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DemoAccount {
  cpf: string; // Número do CPF (Identificador principal de acesso)
  username: string;
  email: string;
  passwordPlainText: string;
  nome: string;
  role: 'admin' | 'solicitante' | 'auditor';
  empresaNome?: string;
  cargo: string;
}

export const DEMO_PLATFORM_ACCOUNTS: DemoAccount[] = [
  {
    cpf: '452.066.308-37',
    username: '452.066.308-37',
    email: 'lucastecseg1@gmail.com',
    passwordPlainText: '001122',
    nome: 'Lucas Valdeci Gonçalves',
    role: 'admin',
    cargo: 'Administrador Mestre EHS (Acesso Completo)',
  },
];
