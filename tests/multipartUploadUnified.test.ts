import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../backend/app';
import { signAuthToken } from '../backend/authMiddleware';
import {
  ThirdPartyManagementService,
  createInMemoryThirdPartyRepository,
  DIRECT_FILE_URL_PREFIX,
} from '../backend/thirdPartyManagementService';
import {
  IntegrationWorkflowService,
  createInMemoryIntegrationRepository,
} from '../backend/integrationWorkflowService';
import {
  InAppNotificationService,
  createInMemoryInAppNotificationRepository,
} from '../backend/inAppNotificationService';
import { InMemoryIntegrationFileStorage } from '../backend/integrationFileStorage';
import type {
  ActivityDocumentRequirement,
  ActivityProfile,
  UserProfile,
} from '../src/types/sst';

// Valid binary fixtures with real magic bytes (PDF, PNG, JPEG)
const PDF_V1_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const PDF_V2_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Version (v2) >>\nendobj\n%%EOF\n');
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const SPOOFED_PDF_BYTES = Buffer.from('<html><script>alert(1)</script>not a real pdf</html>');
const OVERSIZED_PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.alloc(4 * 1024 * 1024 + 2048, 0x41),
]);

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function httpJson(
  baseUrl: string,
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown }
): Promise<{ status: number; json: any; rawBuffer: Buffer; contentType: string }> {
  const headers: Record<string, string> = {};
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
  let payload: string | undefined;
  if (opts?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(opts.body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const contentType = res.headers.get('content-type') || '';
  const rawBuffer = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(rawBuffer.toString('utf8'));
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, rawBuffer, contentType };
}

async function httpMultipart(
  baseUrl: string,
  path: string,
  formData: FormData,
  opts?: { token?: string }
): Promise<{ status: number; json: any; rawBuffer: Buffer; contentType: string }> {
  const headers: Record<string, string> = {};
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
  // Deliberately DO NOT set Content-Type so fetch emits multipart/form-data with boundary
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });
  const contentType = res.headers.get('content-type') || '';
  const rawBuffer = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(rawBuffer.toString('utf8'));
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, rawBuffer, contentType };
}

async function createUnifiedUploadHarness() {
  process.env.API_AUTH_SECRET = 'test-ehs-more-unified-multipart-secret-32c!';

  const users: Array<UserProfile & { cpf: string }> = [
    {
      id: 'admin-ehs-1',
      nome: 'Admin EHS Master',
      cpf: '00000000001',
      username: '00000000001',
      email: 'admin@ehsmore.com',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sol-a-1',
      nome: 'Solicitante Empresa A',
      cpf: '11111111111',
      username: '11111111111',
      email: 'sol.a@empresa-a.com',
      role: 'solicitante',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sol-b-1',
      nome: 'Solicitante Empresa B',
      cpf: '22222222222',
      username: '22222222222',
      email: 'sol.b@empresa-b.com',
      role: 'solicitante',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'auditor-1',
      nome: 'Auditor EHS',
      cpf: '33333333333',
      username: '33333333333',
      email: 'auditor@ehsmore.com',
      role: 'auditor',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const activityProfiles: ActivityProfile[] = [
    {
      id: 'act-altura',
      codigo: 'NR35_ALTURA',
      nome: 'Trabalho em Altura (NR-35)',
      descricao: 'Atividades acima de 2m.',
      nivelRisco: 'alto',
      riscosAssociados: ['Queda de altura'],
      normasAplicaveis: ['NR-01', 'NR-07', 'NR-35'],
      exigePT: true,
      exigeAPR: true,
      exigeLOTO: false,
      ativo: true,
      criadoPorId: users[0].id,
      criadoPorNome: users[0].nome,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const activityDocumentRequirements: ActivityDocumentRequirement[] = [
    {
      id: 'req-pgr',
      activityId: 'act-altura',
      escopo: 'empresa',
      origemColecao: 'documents',
      documentoCodigoCanonico: 'PGR',
      nomeExibicao: 'Programa de Gerenciamento de Riscos (PGR)',
      palavrasChaveMatch: ['pgr'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: false,
      baseLegal: 'NR-01',
      ordemExibicao: 1,
      ativo: true,
      criadoPorId: users[0].id,
      criadoPorNome: users[0].nome,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'req-aso',
      activityId: 'act-altura',
      escopo: 'colaborador',
      origemColecao: 'exams',
      documentoCodigoCanonico: 'ASO',
      nomeExibicao: 'Atestado de Saúde Ocupacional (ASO)',
      palavrasChaveMatch: ['aso'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: true,
      baseLegal: 'NR-07',
      ordemExibicao: 2,
      ativo: true,
      criadoPorId: users[0].id,
      criadoPorNome: users[0].nome,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const fileStorage = new InMemoryIntegrationFileStorage();
  const thirdPartyRepo = createInMemoryThirdPartyRepository({
    companies: [],
    userProfiles: users,
    employees: [],
    documents: [],
    exams: [],
    trainings: [],
  });
  const sharedState = thirdPartyRepo.state;

  const notifRepo = createInMemoryInAppNotificationRepository({
    companies: sharedState.companies,
    documents: sharedState.documents,
    trainings: sharedState.trainings,
    exams: sharedState.exams,
  });
  (notifRepo as any).companies = sharedState.companies;
  const notifService = new InAppNotificationService(notifRepo);

  const integrationRepo = createInMemoryIntegrationRepository({
    companies: sharedState.companies,
    employees: sharedState.employees,
    activityProfiles,
    activityDocumentRequirements,
    documents: sharedState.documents,
    trainings: sharedState.trainings,
    exams: sharedState.exams,
  });
  integrationRepo.listCompanies = async () => [...sharedState.companies];
  integrationRepo.getCompanyById = async (id: string) =>
    sharedState.companies.find((c) => c.id === id) || null;
  integrationRepo.listEmployees = async () => [...sharedState.employees];
  integrationRepo.getEmployeeById = async (id: string) =>
    sharedState.employees.find((e) => e.id === id) || null;

  const integrationService = new IntegrationWorkflowService({
    repo: integrationRepo,
    fileStorage,
    notificationService: notifService,
  });
  const thirdPartyService = new ThirdPartyManagementService({
    repo: thirdPartyRepo,
    fileStorage,
    notificationService: notifService,
  });

  const app = createApiApp({
    thirdPartyManagementService: thirdPartyService,
    integrationWorkflowService: integrationService,
    inAppNotificationService: notifService,
    authoritativeUserLookup: async (uid) => {
      const found = sharedState.userProfiles.find((u) => u.id === uid);
      return found ? { id: found.id, data: found } : null;
    },
    userProfilesLister: async () =>
      sharedState.userProfiles.map((u) => ({ id: u.id, data: u })),
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const tokens = {
    admin: signAuthToken({
      id: 'admin-ehs-1',
      role: 'admin',
      nome: 'Admin EHS Master',
      email: 'admin@ehsmore.com',
      cpf: '00000000001',
    }).token,
    solA: signAuthToken({
      id: 'sol-a-1',
      role: 'solicitante',
      nome: 'Solicitante Empresa A',
      email: 'sol.a@empresa-a.com',
      cpf: '11111111111',
    }).token,
    solB: signAuthToken({
      id: 'sol-b-1',
      role: 'solicitante',
      nome: 'Solicitante Empresa B',
      email: 'sol.b@empresa-b.com',
      cpf: '22222222222',
    }).token,
    auditor: signAuthToken({
      id: 'auditor-1',
      role: 'auditor',
      nome: 'Auditor EHS',
      email: 'auditor@ehsmore.com',
      cpf: '33333333333',
    }).token,
  };

  // Seed Company A (owned by Solicitante A) and an employee via protected routes
  const compRes = await httpJson(baseUrl, 'POST', '/api/companies/register', {
    token: tokens.solA,
    body: {
      razaoSocial: 'Montagens Industriais Alfa Ltda',
      nomeFantasia: 'Alfa Montagens',
      cnpj: '12.345.678/0001-90',
      responsavel: 'Carlos Gestor',
      email: 'contato@alfamontagens.com.br',
      telefone: '(11) 99999-1111',
      ramoAtividade: 'Montagem Industrial',
    },
  });
  assert.equal(compRes.status, 201, `Expected company creation 201, got ${compRes.status}`);
  const companyAId: string = compRes.json.company.id;

  const empRes = await httpJson(baseUrl, 'POST', '/api/employees/register', {
    token: tokens.solA,
    body: {
      empresaId: companyAId,
      nomeCompleto: 'João da Silva',
      cpf: '555.666.777-88',
      cargo: 'Montador de Andaime',
      setor: 'Manutenção',
      telefone: '(11) 98888-2222',
    },
  });
  assert.equal(empRes.status, 201, `Expected employee creation 201, got ${empRes.status}`);
  const employeeAId: string = empRes.json.employee.id;

  return {
    baseUrl,
    tokens,
    companyAId,
    employeeAId,
    thirdPartyRepo,
    integrationRepo,
    fileStorage,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('1. Minhas Empresas — multipart/form-data binary upload (Solicitante & Admin), private storage, zero Base64, preview/download', async () => {
  const h = await createUnifiedUploadHarness();
  try {
    // 1A. Solicitante A uploads corporate PGR PDF via multipart/form-data
    const fdSol = new FormData();
    fdSol.append('file', new Blob([PDF_V1_BYTES], { type: 'application/pdf' }), 'PGR_Alfa_2026.pdf');
    fdSol.append('kind', 'documento');
    fdSol.append('empresaId', h.companyAId);
    fdSol.append('nomeDocumento', 'Programa de Gerenciamento de Riscos (PGR)');
    fdSol.append('tipoDocumentoCanonico', 'PGR');
    fdSol.append('categoria', 'PGR');
    fdSol.append('dataEmissao', addDaysIso(-5));
    fdSol.append('dataValidade', addDaysIso(360));
    fdSol.append('arquivoNome', 'PGR_Alfa_2026.pdf');

    const uploadSol = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', fdSol, {
      token: h.tokens.solA,
    });
    assert.equal(uploadSol.status, 201, `Expected 201, got ${uploadSol.status}: ${JSON.stringify(uploadSol.json)}`);
    assert.equal(uploadSol.json.success, true);
    assert.ok(uploadSol.json.recordId, 'Top-level recordId must be returned');
    assert.equal(uploadSol.json.recordId, uploadSol.json.record.id);
    assert.equal(uploadSol.json.situacao, 'pendente', 'Solicitante upload must remain pendente');
    assert.equal(uploadSol.json.record.situacao, 'pendente');
    assert.equal(uploadSol.json.storageVerified, true);
    assert.equal(uploadSol.json.sha256, sha256(PDF_V1_BYTES));
    assert.equal(uploadSol.json.sizeBytes, PDF_V1_BYTES.length);
    assert.equal(uploadSol.json.fileSizeBytes, PDF_V1_BYTES.length);
    assert.equal(uploadSol.json.record.empresaId, h.companyAId);
    assert.ok(
      String(uploadSol.json.record.arquivoUrl || '').startsWith(DIRECT_FILE_URL_PREFIX),
      'Firestore record must store private storage pointer, never Base64'
    );
    assert.ok(
      !JSON.stringify(uploadSol.json.record).includes('data:application/pdf;base64'),
      'Record must not contain Base64 data URLs'
    );

    const docStorageKey: string = uploadSol.json.storageKey;

    // 1B. Solicitante A retrieves & previews the binary file
    const getSol = await httpJson(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(docStorageKey)}`,
      { token: h.tokens.solA }
    );
    assert.equal(getSol.status, 200);
    assert.ok(getSol.contentType.includes('application/pdf'));
    assert.ok(getSol.rawBuffer.equals(PDF_V1_BYTES), 'Downloaded PDF bytes must match uploaded bytes');

    // 1C. Administrador EHS retrieves & previews Solicitante A's uploaded file
    const getAdmin = await httpJson(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(docStorageKey)}`,
      { token: h.tokens.admin }
    );
    assert.equal(getAdmin.status, 200);
    assert.ok(getAdmin.contentType.includes('application/pdf'));
    assert.ok(getAdmin.rawBuffer.equals(PDF_V1_BYTES));

    // 1D. Administrador EHS uploads a corporate PNG via multipart/form-data -> auto-aprovado
    const fdAdmin = new FormData();
    fdAdmin.append('file', new Blob([PNG_BYTES], { type: 'image/png' }), 'PCMSO_Capa.png');
    fdAdmin.append('kind', 'documento');
    fdAdmin.append('empresaId', h.companyAId);
    fdAdmin.append('nomeDocumento', 'PCMSO 2026');
    fdAdmin.append('tipoDocumentoCanonico', 'PCMSO');
    fdAdmin.append('categoria', 'PCMSO');
    fdAdmin.append('dataEmissao', addDaysIso(-2));
    fdAdmin.append('dataValidade', addDaysIso(360));

    const uploadAdmin = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', fdAdmin, {
      token: h.tokens.admin,
    });
    assert.equal(uploadAdmin.status, 201);
    assert.equal(uploadAdmin.json.situacao, 'aprovado', 'Admin upload is immediately aprovado');
    assert.equal(uploadAdmin.json.sha256, sha256(PNG_BYTES));

    const getPngSol = await httpJson(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(uploadAdmin.json.storageKey)}`,
      { token: h.tokens.solA }
    );
    assert.equal(getPngSol.status, 200);
    assert.ok(getPngSol.contentType.includes('image/png'));
    assert.ok(getPngSol.rawBuffer.equals(PNG_BYTES));
  } finally {
    await h.close();
  }
});

test('2. Meus Colaboradores — multipart/form-data binary uploads for documento, exame (ASO JPEG), and treinamento (NR-35 PNG)', async () => {
  const h = await createUnifiedUploadHarness();
  try {
    // 2A. Collaborator document (PDF)
    const fdDoc = new FormData();
    fdDoc.append('file', new Blob([PDF_V1_BYTES], { type: 'application/pdf' }), 'Ficha_EPI_Joao.pdf');
    fdDoc.append('kind', 'documento');
    fdDoc.append('empresaId', h.companyAId);
    fdDoc.append('colaboradorId', h.employeeAId);
    fdDoc.append('nomeDocumento', 'Ficha de Entrega de EPI');
    fdDoc.append('tipoDocumentoCanonico', 'FICHA_EPI');
    fdDoc.append('semValidade', 'true');

    const resDoc = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', fdDoc, {
      token: h.tokens.solA,
    });
    assert.equal(resDoc.status, 201, `Doc upload failed: ${JSON.stringify(resDoc.json)}`);
    assert.equal(resDoc.json.situacao, 'pendente');
    assert.equal(resDoc.json.record.empresaId, h.companyAId);
    assert.equal(resDoc.json.record.colaboradorId, h.employeeAId);

    // 2B. Collaborator ASO exam (JPEG)
    const fdExam = new FormData();
    fdExam.append('file', new Blob([JPEG_BYTES], { type: 'image/jpeg' }), 'ASO_Joao.jpg');
    fdExam.append('kind', 'exame');
    fdExam.append('empresaId', h.companyAId);
    fdExam.append('colaboradorId', h.employeeAId);
    fdExam.append('nomeDocumento', 'ASO Periódico');
    fdExam.append('dataEmissao', addDaysIso(-10));
    fdExam.append('dataValidade', addDaysIso(350));
    fdExam.append('conclusao', 'apto');
    fdExam.append('aptidoesEspecificas', JSON.stringify(['NR-35 Trabalho em Altura']));

    const resExam = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', fdExam, {
      token: h.tokens.solA,
    });
    assert.equal(resExam.status, 201, `ASO upload failed: ${JSON.stringify(resExam.json)}`);
    assert.equal(resExam.json.situacao, 'pendente');
    assert.equal(resExam.json.record.colaboradorId, h.employeeAId);
    assert.equal(resExam.json.record.conclusao, 'apto');
    assert.equal(resExam.json.sha256, sha256(JPEG_BYTES));

    // 2C. Collaborator NR-35 training (PNG)
    const fdTr = new FormData();
    fdTr.append('file', new Blob([PNG_BYTES], { type: 'image/png' }), 'NR35_Joao.png');
    fdTr.append('kind', 'treinamento');
    fdTr.append('empresaId', h.companyAId);
    fdTr.append('colaboradorId', h.employeeAId);
    fdTr.append('nomeDocumento', 'NR-35 — Trabalho em Altura');
    fdTr.append('dataEmissao', addDaysIso(-15));
    fdTr.append('dataValidade', addDaysIso(700));

    const resTr = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', fdTr, {
      token: h.tokens.solA,
    });
    assert.equal(resTr.status, 201);
    assert.equal(resTr.json.situacao, 'pendente');
    assert.equal(resTr.json.record.colaboradorId, h.employeeAId);
    assert.equal(resTr.json.sha256, sha256(PNG_BYTES));

    // Verify Admin & Solicitante can retrieve all 3 binary files cleanly
    for (const check of [
      { key: resDoc.json.storageKey, bytes: PDF_V1_BYTES, mime: 'application/pdf' },
      { key: resExam.json.storageKey, bytes: JPEG_BYTES, mime: 'image/jpeg' },
      { key: resTr.json.storageKey, bytes: PNG_BYTES, mime: 'image/png' },
    ]) {
      for (const token of [h.tokens.solA, h.tokens.admin]) {
        const dl = await httpJson(
          h.baseUrl,
          'GET',
          `/api/direct-documents/file?key=${encodeURIComponent(check.key)}`,
          { token }
        );
        assert.equal(dl.status, 200);
        assert.ok(dl.contentType.includes(check.mime));
        assert.ok(dl.rawBuffer.equals(check.bytes));
      }
    }
  } finally {
    await h.close();
  }
});

test('3. Central de Integração — multipart/form-data upload, renewal, storage verification, and Solicitante/Admin preview', async () => {
  const h = await createUnifiedUploadHarness();
  try {
    // 3A. Solicitante A creates an integration for Company A + Employee A
    const createRes = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.employeeAId],
        atividadeIds: ['act-altura'],
        observacoesGerais: 'Integração com envio binário multipart',
      },
    });
    assert.equal(createRes.status, 201, `Create integration failed: ${JSON.stringify(createRes.json)}`);
    const integrationId: string = createRes.json.integration.id;
    const items: any[] = createRes.json.items || [];
    const pgrItem = items.find((i) => i.documentoCodigoCanonico === 'PGR');
    const asoItem = items.find((i) => i.documentoCodigoCanonico === 'ASO');
    assert.ok(pgrItem, 'PGR checklist item must exist');
    assert.ok(asoItem, 'ASO checklist item must exist');

    // 3B. Upload PGR (PDF) via multipart/form-data (no Base64)
    const fdPgr = new FormData();
    fdPgr.append('file', new Blob([PDF_V1_BYTES], { type: 'application/pdf' }), 'PGR_Integracao.pdf');
    fdPgr.append('itemId', pgrItem.id);
    fdPgr.append('categoria', 'empresa');
    fdPgr.append('documentoCodigoCanonico', 'PGR');
    fdPgr.append('nomeExibicao', 'Programa de Gerenciamento de Riscos (PGR)');
    fdPgr.append('origemColecao', 'documents');
    fdPgr.append('dataEmissao', addDaysIso(-5));
    fdPgr.append('dataValidade', addDaysIso(300));
    fdPgr.append('arquivoNome', 'PGR_Integracao.pdf');

    const upPgr = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/documents/upload`,
      fdPgr,
      { token: h.tokens.solA }
    );
    assert.equal(upPgr.status, 200, `PGR multipart upload failed: ${JSON.stringify(upPgr.json)}`);
    assert.equal(upPgr.json.success, true);
    assert.equal(upPgr.json.item.status, 'ENVIADO', 'Uploaded integration item must await Admin review');
    assert.equal(upPgr.json.uploadedFile.arquivoHashSha256, sha256(PDF_V1_BYTES));
    assert.equal(upPgr.json.uploadedFile.arquivoTamanhoBytes, PDF_V1_BYTES.length);
    assert.equal(upPgr.json.uploadedFile.arquivoMimeType, 'application/pdf');
    assert.ok(upPgr.json.uploadedFile.arquivoId, 'Uploaded arquivoId must be set');
    assert.ok(
      !JSON.stringify(upPgr.json.item).includes('data:application/pdf;base64'),
      'Integration item must never store Base64'
    );

    // 3C. Upload ASO (PNG) via multipart/form-data
    const fdAso = new FormData();
    fdAso.append('file', new Blob([PNG_BYTES], { type: 'image/png' }), 'ASO_Joao.png');
    fdAso.append('itemId', asoItem.id);
    fdAso.append('categoria', 'colaborador');
    fdAso.append('colaboradorId', h.employeeAId);
    fdAso.append('documentoCodigoCanonico', 'ASO');
    fdAso.append('nomeExibicao', 'Atestado de Saúde Ocupacional (ASO)');
    fdAso.append('origemColecao', 'exams');
    fdAso.append('dataEmissao', addDaysIso(-3));
    fdAso.append('dataValidade', addDaysIso(350));
    fdAso.append('conclusaoAso', 'apto');

    const upAso = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/documents/upload`,
      fdAso,
      { token: h.tokens.solA }
    );
    assert.equal(upAso.status, 200);
    assert.equal(upAso.json.item.status, 'ENVIADO');
    assert.equal(upAso.json.uploadedFile.arquivoHashSha256, sha256(PNG_BYTES));

    // 3D. Solicitante A can preview uploaded items immediately while in draft
    const solPgrDl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(pgrItem.id)}/file`,
      { token: h.tokens.solA }
    );
    assert.equal(solPgrDl.status, 200);
    assert.ok(solPgrDl.contentType.includes('application/pdf'));
    assert.ok(solPgrDl.rawBuffer.equals(PDF_V1_BYTES));

    const solAsoDl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(asoItem.id)}/file`,
      { token: h.tokens.solA }
    );
    assert.equal(solAsoDl.status, 200);
    assert.ok(solAsoDl.contentType.includes('image/png'));
    assert.ok(solAsoDl.rawBuffer.equals(PNG_BYTES));

    // 3E. Solicitante A submits integration -> Admin EHS now previews/downloads both files
    const submitRes = await httpJson(
      h.baseUrl,
      'POST',
      `/api/integrations/${encodeURIComponent(integrationId)}/submit`,
      { token: h.tokens.solA, body: {} }
    );
    assert.equal(submitRes.status, 200, `Submit failed: ${JSON.stringify(submitRes.json)}`);

    const adminPgrDl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(pgrItem.id)}/file`,
      { token: h.tokens.admin }
    );
    assert.equal(adminPgrDl.status, 200);
    assert.ok(adminPgrDl.contentType.includes('application/pdf'));
    assert.ok(adminPgrDl.rawBuffer.equals(PDF_V1_BYTES));

    const adminAsoDl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(asoItem.id)}/file`,
      { token: h.tokens.admin }
    );
    assert.equal(adminAsoDl.status, 200);
    assert.ok(adminAsoDl.contentType.includes('image/png'));
    assert.ok(adminAsoDl.rawBuffer.equals(PNG_BYTES));

    // 3F. Renew PGR item with PDF v2 via multipart/form-data
    const fdRenew = new FormData();
    fdRenew.append('file', new Blob([PDF_V2_BYTES], { type: 'application/pdf' }), 'PGR_Integracao_v2.pdf');
    fdRenew.append('arquivoNome', 'PGR_Integracao_v2.pdf');
    fdRenew.append('dataEmissao', addDaysIso(-1));
    fdRenew.append('dataValidade', addDaysIso(365));

    const renewRes = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(pgrItem.id)}/renew`,
      fdRenew,
      { token: h.tokens.solA }
    );
    assert.equal(renewRes.status, 200, `Renew failed: ${JSON.stringify(renewRes.json)}`);
    const updatedPgr = (renewRes.json.items || []).find((i: any) => i.id === pgrItem.id);
    assert.ok(updatedPgr);
    assert.equal(updatedPgr.versaoAtual, 2);

    const pgrV2Dl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(pgrItem.id)}/file`,
      { token: h.tokens.admin }
    );
    assert.equal(pgrV2Dl.status, 200);
    assert.ok(pgrV2Dl.rawBuffer.equals(PDF_V2_BYTES), 'Admin must retrieve renewed v2 binary PDF');
  } finally {
    await h.close();
  }
});

test('4. Security & Validation — spoofed MIME (400), >4 MB limit (413), missing file (400), cross-company (403), Auditor RBAC, unauthenticated (401)', async () => {
  const h = await createUnifiedUploadHarness();
  try {
    // Seed 1 valid direct document + 1 integration item for access control tests
    const validFd = new FormData();
    validFd.append('file', new Blob([PDF_V1_BYTES], { type: 'application/pdf' }), 'Doc_A.pdf');
    validFd.append('kind', 'documento');
    validFd.append('empresaId', h.companyAId);
    validFd.append('nomeDocumento', 'PGR Alfa');
    validFd.append('tipoDocumentoCanonico', 'PGR');
    const validDocRes = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', validFd, {
      token: h.tokens.solA,
    });
    assert.equal(validDocRes.status, 201, `Seed valid doc failed: ${JSON.stringify(validDocRes.json)}`);
    const docAStorageKey: string = validDocRes.json.storageKey;

    const createInt = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.employeeAId],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(createInt.status, 201);
    const integrationId: string = createInt.json.integration.id;
    const pgrItem = (createInt.json.items || []).find((i: any) => i.documentoCodigoCanonico === 'PGR');

    // 4A. Spoofed MIME on direct upload -> 400
    const spoofDirect = new FormData();
    spoofDirect.append('file', new Blob([SPOOFED_PDF_BYTES], { type: 'application/pdf' }), 'fake.pdf');
    spoofDirect.append('kind', 'documento');
    spoofDirect.append('empresaId', h.companyAId);
    spoofDirect.append('nomeDocumento', 'Fake PDF');
    const resSpoofDirect = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', spoofDirect, {
      token: h.tokens.solA,
    });
    assert.equal(resSpoofDirect.status, 400, 'Spoofed PDF must be rejected on direct upload');

    // 4B. Spoofed MIME on integration upload -> 400
    const spoofInt = new FormData();
    spoofInt.append('file', new Blob([SPOOFED_PDF_BYTES], { type: 'application/pdf' }), 'fake.pdf');
    spoofInt.append('itemId', pgrItem.id);
    spoofInt.append('categoria', 'empresa');
    spoofInt.append('documentoCodigoCanonico', 'PGR');
    const resSpoofInt = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/documents/upload`,
      spoofInt,
      { token: h.tokens.solA }
    );
    assert.equal(resSpoofInt.status, 400, 'Spoofed PDF must be rejected on integration upload');

    // 4C. Oversized file (>4 MB) -> 413 on BOTH direct upload and integration upload
    const bigDirect = new FormData();
    bigDirect.append('file', new Blob([OVERSIZED_PDF_BYTES], { type: 'application/pdf' }), 'huge.pdf');
    bigDirect.append('kind', 'documento');
    bigDirect.append('empresaId', h.companyAId);
    bigDirect.append('nomeDocumento', 'Huge PGR');
    const resBigDirect = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', bigDirect, {
      token: h.tokens.solA,
    });
    assert.equal(resBigDirect.status, 413, 'Direct upload > 4 MB must return 413');
    assert.equal(resBigDirect.json?.code, 'FILE_TOO_LARGE');

    const bigInt = new FormData();
    bigInt.append('file', new Blob([OVERSIZED_PDF_BYTES], { type: 'application/pdf' }), 'huge.pdf');
    bigInt.append('itemId', pgrItem.id);
    const resBigInt = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/documents/upload`,
      bigInt,
      { token: h.tokens.solA }
    );
    assert.equal(resBigInt.status, 413, 'Integration upload > 4 MB must return 413');
    assert.equal(resBigInt.json?.code, 'FILE_TOO_LARGE');

    // 4D. Missing file -> 400 on both endpoints
    const emptyDirect = new FormData();
    emptyDirect.append('kind', 'documento');
    emptyDirect.append('empresaId', h.companyAId);
    emptyDirect.append('nomeDocumento', 'Empty PGR');
    const resEmptyDirect = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', emptyDirect, {
      token: h.tokens.solA,
    });
    assert.equal(resEmptyDirect.status, 400);

    const emptyInt = new FormData();
    emptyInt.append('itemId', pgrItem.id);
    const resEmptyInt = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/documents/upload`,
      emptyInt,
      { token: h.tokens.solA }
    );
    assert.equal(resEmptyInt.status, 400);

    // 4E. Cross-company isolation: Solicitante B cannot upload to or download from Company A
    const solBUpload = new FormData();
    solBUpload.append('file', new Blob([PDF_V1_BYTES], { type: 'application/pdf' }), 'intruder.pdf');
    solBUpload.append('kind', 'documento');
    solBUpload.append('empresaId', h.companyAId);
    solBUpload.append('nomeDocumento', 'Intruder PGR');
    const resSolBUpload = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', solBUpload, {
      token: h.tokens.solB,
    });
    assert.equal(resSolBUpload.status, 403, 'Cross-company direct upload must be 403');

    const resSolBDl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(docAStorageKey)}`,
      { token: h.tokens.solB }
    );
    assert.equal(resSolBDl.status, 403, 'Cross-company direct file download must be 403');

    const solBIntUp = new FormData();
    solBIntUp.append('file', new Blob([PDF_V1_BYTES], { type: 'application/pdf' }), 'intruder.pdf');
    solBIntUp.append('itemId', pgrItem.id);
    const resSolBIntUp = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/documents/upload`,
      solBIntUp,
      { token: h.tokens.solB }
    );
    assert.equal(resSolBIntUp.status, 403, 'Cross-company integration upload must be 403');

    // 4F. Auditor RBAC: cannot upload (403), CAN read/preview (200)
    const auditorUp = new FormData();
    auditorUp.append('file', new Blob([PDF_V1_BYTES], { type: 'application/pdf' }), 'auditor.pdf');
    auditorUp.append('kind', 'documento');
    auditorUp.append('empresaId', h.companyAId);
    auditorUp.append('nomeDocumento', 'Auditor PGR');
    const resAuditorUp = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', auditorUp, {
      token: h.tokens.auditor,
    });
    assert.equal(resAuditorUp.status, 403, 'Auditor must be blocked from uploading');

    const resAuditorDl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(docAStorageKey)}`,
      { token: h.tokens.auditor }
    );
    assert.equal(resAuditorDl.status, 200, 'Auditor retains read-only preview access');
    assert.ok(resAuditorDl.rawBuffer.equals(PDF_V1_BYTES));

    // 4G. Unauthenticated requests -> 401
    const unauthUp = new FormData();
    unauthUp.append('file', new Blob([PDF_V1_BYTES], { type: 'application/pdf' }), 'anon.pdf');
    unauthUp.append('kind', 'documento');
    unauthUp.append('empresaId', h.companyAId);
    unauthUp.append('nomeDocumento', 'Anon PGR');
    const resUnauthUp = await httpMultipart(h.baseUrl, '/api/direct-documents/upload', unauthUp);
    assert.equal(resUnauthUp.status, 401, 'Unauthenticated upload must be 401');

    const resUnauthDl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(docAStorageKey)}`
    );
    assert.equal(resUnauthDl.status, 401, 'Unauthenticated download must be 401');
  } finally {
    await h.close();
  }
});
