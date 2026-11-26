import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApiApp } from '../backend/app';
import { hashPasswordBcrypt } from '../backend/authMiddleware';
import { InMemoryIntegrationFileStorage } from '../backend/integrationFileStorage';
import {
  createInMemoryIntegrationRepository,
  IntegrationWorkflowService,
} from '../backend/integrationWorkflowService';
import type { UserProfile } from '../src/types/sst';

const WORKSPACE_ROOT = process.cwd();

async function createAuthTestServer() {
  const prevSecret = process.env.API_AUTH_SECRET;
  process.env.API_AUTH_SECRET = 'test-only-admin-login-auth-secret-32chars-minimum!!';

  const adminPasswordHash = await hashPasswordBcrypt('AdminEhs#2026Strong');
  const solicitantePasswordHash = await hashPasswordBcrypt('SolEhs#2026Strong');
  const auditorPasswordHash = await hashPasswordBcrypt('AudEhs#2026Strong');
  const invalidRolePasswordHash = await hashPasswordBcrypt('InvEhs#2026Strong');

  const users: Array<{ id: string; data: UserProfile }> = [
    {
      id: 'user-123.456.789-01',
      data: {
        id: 'user-123.456.789-01',
        cpf: '123.456.789-01',
        username: '123.456.789-01',
        email: 'admin.teste@ehsmore.local',
        nome: 'Administrador EHS Teste',
        role: 'admin',
        passwordHash: adminPasswordHash,
        hashAlgorithm: 'bcrypt',
        passwordResetRequired: false,
        tokenVersion: 1,
      },
    },
    {
      id: 'user-987.654.321-00',
      data: {
        id: 'user-987.654.321-00',
        cpf: '987.654.321-00',
        username: '987.654.321-00',
        email: 'solicitante.teste@contratada.local',
        nome: 'Solicitante Contratada Teste',
        role: 'solicitante',
        empresaId: 'comp-test-1',
        empresaNome: 'Contratada Teste Ltda',
        passwordHash: solicitantePasswordHash,
        hashAlgorithm: 'bcrypt',
        passwordResetRequired: false,
        tokenVersion: 1,
      },
    },
    {
      id: 'user-555.444.333-22',
      data: {
        id: 'user-555.444.333-22',
        cpf: '555.444.333-22',
        username: '555.444.333-22',
        email: 'auditor.teste@ehsmore.local',
        nome: 'Auditor SST Teste',
        role: 'auditor',
        passwordHash: auditorPasswordHash,
        hashAlgorithm: 'bcrypt',
        passwordResetRequired: false,
        tokenVersion: 1,
      },
    },
    {
      id: 'user-111.222.333-44',
      data: {
        id: 'user-111.222.333-44',
        cpf: '111.222.333-44',
        username: '111.222.333-44',
        email: 'invalido.teste@ehsmore.local',
        nome: 'Usuário Sem Papel Válido',
        role: 'visitante' as any,
        passwordHash: invalidRolePasswordHash,
        hashAlgorithm: 'bcrypt',
        passwordResetRequired: false,
        tokenVersion: 1,
      },
    },
  ];

  const userMap = new Map(users.map((u) => [u.id, u]));
  const repo = createInMemoryIntegrationRepository();
  const integrationWorkflowService = new IntegrationWorkflowService({
    repo,
    fileStorage: new InMemoryIntegrationFileStorage(),
  });

  const app = createApiApp({
    integrationWorkflowService,
    userProfilesLister: async () => users.map((u) => ({ id: u.id, data: { ...u.data } })),
    authoritativeUserLookup: async (userId: string) => {
      const found = userMap.get(userId);
      return found ? { id: found.id, data: { ...found.data } } : null;
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevSecret === undefined) delete process.env.API_AUTH_SECRET;
    else process.env.API_AUTH_SECRET = prevSecret;
  };

  return { baseUrl, close };
}

test('Autenticação Admin EHS — App.tsx usa isAuthenticated && profile (nunca !user) e redireciona para Dashboard', () => {
  const appSrc = fs.readFileSync(path.join(WORKSPACE_ROOT, 'src/App.tsx'), 'utf8');
  const authCtxSrc = fs.readFileSync(path.join(WORKSPACE_ROOT, 'src/context/AuthContext.tsx'), 'utf8');
  const loginSrc = fs.readFileSync(path.join(WORKSPACE_ROOT, 'src/components/auth/LoginPage.tsx'), 'utf8');

  assert.equal(appSrc.includes('if (!user)'), false, 'App.tsx não pode bloquear acesso com if (!user)');
  assert.equal(
    appSrc.includes('if (!isAuthenticated || !profile)'),
    true,
    'App.tsx deve verificar if (!isAuthenticated || !profile)'
  );
  assert.equal(
    appSrc.includes("profile.role === 'solicitante' ? 'painel_contratada' : 'dashboard'"),
    true,
    'App.tsx deve direcionar Admin EHS para dashboard e Solicitante para painel_contratada'
  );
  assert.equal(
    authCtxSrc.includes('isValidUserRole'),
    true,
    'AuthContext deve validar papel oficial antes de autenticar sessão'
  );
  assert.equal(
    loginSrc.includes('role="alert"'),
    true,
    'LoginPage deve renderizar mensagens de erro visíveis com role=alert'
  );
});

test('Autenticação Admin EHS — 10 cenários obrigatórios ponta a ponta (CPF pontuado/sem pontuação, erros, sessão, RBAC, logout e novo login)', async () => {
  const { baseUrl, close } = await createAuthTestServer();

  try {
    // 1 & 2. Login válido do Administrador EHS com CPF contendo pontuação
    const loginPunctuated = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpfOrIdentifier: '123.456.789-01',
        password: 'AdminEhs#2026Strong',
      }),
    });
    const loginPunctuatedBody = await loginPunctuated.json();
    assert.equal(loginPunctuated.status, 200);
    assert.equal(loginPunctuatedBody.success, true);
    assert.equal(loginPunctuatedBody.role, 'admin');
    assert.equal(loginPunctuatedBody.user.role, 'admin');
    assert.equal(loginPunctuatedBody.user.id, 'user-123.456.789-01');
    assert.equal('passwordHash' in loginPunctuatedBody.user, false, 'Nunca expor passwordHash');
    assert.ok(typeof loginPunctuatedBody.token === 'string' && loginPunctuatedBody.token.split('.').length === 3);

    // 3. Login válido do Administrador EHS com CPF sem pontuação
    const loginPlainCpf = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpfOrIdentifier: '12345678901',
        password: 'AdminEhs#2026Strong',
      }),
    });
    const loginPlainBody = await loginPlainCpf.json();
    assert.equal(loginPlainCpf.status, 200);
    assert.equal(loginPlainBody.success, true);
    assert.equal(loginPlainBody.user.role, 'admin');
    assert.equal(loginPlainBody.user.id, 'user-123.456.789-01');

    // 4. Senha incorreta
    const wrongPass = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpfOrIdentifier: '123.456.789-01',
        password: 'SenhaErrada#9999',
      }),
    });
    const wrongPassBody = await wrongPass.json();
    assert.equal(wrongPass.status, 401);
    assert.equal(wrongPassBody.success, false);
    assert.match(wrongPassBody.message, /CPF ou senha incorretos/i);

    // 5. CPF inexistente
    const missingCpf = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpfOrIdentifier: '999.999.999-99',
        password: 'AdminEhs#2026Strong',
      }),
    });
    const missingCpfBody = await missingCpf.json();
    assert.equal(missingCpf.status, 401);
    assert.equal(missingCpfBody.success, false);
    assert.match(missingCpfBody.message, /CPF ou senha incorretos/i);

    // 6. Usuário sem perfil administrativo (Solicitante e Auditor) + usuário com papel inválido
    const solLogin = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpfOrIdentifier: '98765432100',
        password: 'SolEhs#2026Strong',
      }),
    });
    const solBody = await solLogin.json();
    assert.equal(solLogin.status, 200);
    assert.equal(solBody.user.role, 'solicitante');
    assert.equal(solBody.user.empresaId, 'comp-test-1');

    const audLogin = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpfOrIdentifier: '555.444.333-22',
        password: 'AudEhs#2026Strong',
      }),
    });
    const audBody = await audLogin.json();
    assert.equal(audLogin.status, 200);
    assert.equal(audBody.user.role, 'auditor');

    const invRoleLogin = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpfOrIdentifier: '111.222.333-44',
        password: 'InvEhs#2026Strong',
      }),
    });
    assert.equal(invRoleLogin.status, 401, 'Usuário com perfil inválido não pode autenticar');

    // 7 & 8. Persistência da sessão ao atualizar a página (GET /api/auth/me) e acesso administrativo
    const meAdmin = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${loginPunctuatedBody.token}` },
    });
    const meAdminBody = await meAdmin.json();
    assert.equal(meAdmin.status, 200);
    assert.equal(meAdminBody.success, true);
    assert.equal(meAdminBody.user.role, 'admin');
    assert.equal(meAdminBody.user.id, 'user-123.456.789-01');

    // Admin acessa dados protegidos do Dashboard (/api/integrations e /api/integrations/items)
    const adminIntegrations = await fetch(`${baseUrl}/api/integrations`, {
      headers: { Authorization: `Bearer ${loginPunctuatedBody.token}` },
    });
    assert.equal(adminIntegrations.status, 200);

    const adminItems = await fetch(`${baseUrl}/api/integrations/items`, {
      headers: { Authorization: `Bearer ${loginPunctuatedBody.token}` },
    });
    assert.equal(adminItems.status, 200);

    // 9. Bloqueio de acesso administrativo para perfis não autorizados (Solicitante, Auditor e anônimo)
    const solAdminAction = await fetch(`${baseUrl}/api/integrations/int-inexistente/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${solBody.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(solAdminAction.status, 403, 'Solicitante deve receber 403 em rota exclusiva de Admin EHS');

    const audAdminAction = await fetch(`${baseUrl}/api/integrations/int-inexistente/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${audBody.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(audAdminAction.status, 403, 'Auditor deve receber 403 em rota exclusiva de Admin EHS');

    const anonMe = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(anonMe.status, 401, 'Sessão ausente deve retornar 401');

    const tamperedMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    assert.equal(tamperedMe.status, 401, 'Token adulterado deve retornar 401');

    // 10. Logout (descarte de token) e novo login válido do Administrador EHS
    const reLogin = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpfOrIdentifier: '123.456.789-01',
        password: 'AdminEhs#2026Strong',
      }),
    });
    const reLoginBody = await reLogin.json();
    assert.equal(reLogin.status, 200);
    assert.equal(reLoginBody.success, true);
    assert.equal(reLoginBody.user.role, 'admin');

    const meAfterReLogin = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${reLoginBody.token}` },
    });
    assert.equal(meAfterReLogin.status, 200);
    const meAfterReLoginBody = await meAfterReLogin.json();
    assert.equal(meAfterReLoginBody.user.role, 'admin');
  } finally {
    await close();
  }
});
