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

const PDF_V1 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /V (1) >>\nendobj\n%%EOF\n');
const PDF_V2 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /V (2) >>\nendobj\n%%EOF\n');
const PDF_V3 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /V (3) >>\nendobj\n%%EOF\n');
const PNG_ASO = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const JPEG_NR35 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
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

async function createCentralizedReuseHarness() {
  process.env.API_AUTH_SECRET = 'test-ehs-more-centralization-reuse-secret-32c!';

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
      id: 'req-pcmso',
      activityId: 'act-altura',
      escopo: 'empresa',
      origemColecao: 'documents',
      documentoCodigoCanonico: 'PCMSO',
      nomeExibicao: 'PCMSO — Programa de Controle Médico',
      palavrasChaveMatch: ['pcmso'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: false,
      baseLegal: 'NR-07',
      ordemExibicao: 2,
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
      ordemExibicao: 3,
      ativo: true,
      criadoPorId: users[0].id,
      criadoPorNome: users[0].nome,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'req-nr35',
      activityId: 'act-altura',
      escopo: 'colaborador',
      origemColecao: 'trainings',
      documentoCodigoCanonico: 'NR35',
      nomeExibicao: 'Certificado NR-35 Trabalho em Altura',
      palavrasChaveMatch: ['nr-35', 'nr35', 'trabalho em altura'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: false,
      baseLegal: 'NR-35',
      ordemExibicao: 4,
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
  const shared = thirdPartyRepo.state;

  const notifRepo = createInMemoryInAppNotificationRepository({
    companies: shared.companies,
    documents: shared.documents,
    trainings: shared.trainings,
    exams: shared.exams,
  });
  (notifRepo as any).companies = shared.companies;
  const notifService = new InAppNotificationService(notifRepo);

  const integrationRepo = createInMemoryIntegrationRepository({
    activityProfiles,
    activityDocumentRequirements,
  });
  // Share live arrays so direct uploads/approvals & integration workflows see the exact same official base (as in Firestore)
  integrationRepo.state.companies = shared.companies;
  integrationRepo.state.employees = shared.employees;
  integrationRepo.state.documents = shared.documents;
  integrationRepo.state.exams = shared.exams;
  integrationRepo.state.trainings = shared.trainings;

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
      const found = shared.userProfiles.find((u) => u.id === uid);
      return found ? { id: found.id, data: found } : null;
    },
    userProfilesLister: async () =>
      shared.userProfiles.map((u) => ({ id: u.id, data: u })),
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

  // Register Company A & Company B
  const compARes = await httpJson(baseUrl, 'POST', '/api/companies/register', {
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
  assert.equal(compARes.status, 201);
  const companyAId: string = compARes.json.company.id;

  const compBRes = await httpJson(baseUrl, 'POST', '/api/companies/register', {
    token: tokens.solB,
    body: {
      razaoSocial: 'Engenharia Beta S.A.',
      nomeFantasia: 'Beta Eng',
      cnpj: '98.765.432/0001-10',
      responsavel: 'Marina Gestora',
      email: 'contato@betaeng.com.br',
      telefone: '(11) 98888-0000',
      ramoAtividade: 'Engenharia Elétrica',
    },
  });
  assert.equal(compBRes.status, 201);
  const companyBId: string = compBRes.json.company.id;

  // Register Collaborator A1, Collaborator A2 (SAME NAME, DIFFERENT CPF!), and Collaborator B1
  const empA1Res = await httpJson(baseUrl, 'POST', '/api/employees/register', {
    token: tokens.solA,
    body: {
      empresaId: companyAId,
      nomeCompleto: 'João da Silva',
      cpf: '555.666.777-88',
      cargo: 'Montador',
      setor: 'Manutenção',
    },
  });
  assert.equal(empA1Res.status, 201);
  const empA1Id: string = empA1Res.json.employee.id;

  const empA2SameNameRes = await httpJson(baseUrl, 'POST', '/api/employees/register', {
    token: tokens.solA,
    body: {
      empresaId: companyAId,
      nomeCompleto: 'João da Silva',
      cpf: '999.888.777-66',
      cargo: 'Montador',
      setor: 'Manutenção',
    },
  });
  assert.equal(empA2SameNameRes.status, 201);
  const empA2Id: string = empA2SameNameRes.json.employee.id;

  const empB1Res = await httpJson(baseUrl, 'POST', '/api/employees/register', {
    token: tokens.solB,
    body: {
      empresaId: companyBId,
      nomeCompleto: 'João da Silva',
      cpf: '444.333.222-11',
      cargo: 'Eletricista',
      setor: 'Obras',
    },
  });
  assert.equal(empB1Res.status, 201);
  const empB1Id: string = empB1Res.json.employee.id;

  return {
    baseUrl,
    tokens,
    companyAId,
    companyBId,
    empA1Id,
    empA2Id,
    empB1Id,
    shared,
    integrationRepo,
    fileStorage,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function uploadDirect(
  baseUrl: string,
  token: string,
  params: {
    kind: 'documento' | 'exame' | 'treinamento';
    empresaId: string;
    colaboradorId?: string;
    recordId?: string;
    nomeDocumento: string;
    tipoDocumentoCanonico?: string;
    categoria?: string;
    dataEmissao?: string;
    dataValidade?: string;
    semValidade?: boolean;
    conclusao?: 'apto' | 'apto_com_restricoes' | 'inapto';
    fileName: string;
    bytes: Buffer;
    mime: string;
  }
) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(params.bytes)], { type: params.mime }), params.fileName);
  fd.append('kind', params.kind);
  fd.append('empresaId', params.empresaId);
  if (params.colaboradorId) fd.append('colaboradorId', params.colaboradorId);
  if (params.recordId) fd.append('recordId', params.recordId);
  fd.append('nomeDocumento', params.nomeDocumento);
  if (params.tipoDocumentoCanonico) fd.append('tipoDocumentoCanonico', params.tipoDocumentoCanonico);
  if (params.categoria) fd.append('categoria', params.categoria);
  if (params.dataEmissao) fd.append('dataEmissao', params.dataEmissao);
  if (params.dataValidade) fd.append('dataValidade', params.dataValidade);
  if (params.semValidade) fd.append('semValidade', 'true');
  if (params.conclusao) fd.append('conclusao', params.conclusao);
  fd.append('arquivoNome', params.fileName);

  return httpMultipart(baseUrl, '/api/direct-documents/upload', fd, { token });
}

test('1. Corporate doc uploaded once is automatically reused across 2+ integrations without re-upload', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    // Upload PGR once in Minhas Empresas -> pending
    const up = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      categoria: 'PGR / PPRA',
      dataEmissao: addDaysIso(-5),
      dataValidade: addDaysIso(360),
      fileName: 'PGR_Alfa_Unico.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    assert.equal(up.status, 201);
    assert.equal(up.json.situacao, 'pendente');
    assert.ok(String(up.json.record.arquivoUrl).startsWith(DIRECT_FILE_URL_PREFIX));
    const pgrRecordId: string = up.json.recordId;

    // Admin approves PGR once
    const rev = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pgrRecordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );
    assert.equal(rev.status, 200);
    assert.equal(rev.json.record.situacao, 'aprovado');

    // Integration #1 automatically reuses PGR
    const int1 = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(int1.status, 201);
    const pgrItem1 = int1.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    assert.ok(pgrItem1);
    assert.equal(pgrItem1.status, 'APROVADO');
    assert.equal(pgrItem1.reaproveitado, true);
    assert.equal(pgrItem1.situacaoDocumentoExistente, 'REAPROVEITADO_VALIDO');
    assert.equal(pgrItem1.officialRecordId, pgrRecordId);
    assert.equal(pgrItem1.hasStoredFile, true);

    // Integration #2 ALSO automatically reuses the exact same PGR without re-upload
    const int2 = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'ATUALIZACAO_DOCUMENTAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA2Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(int2.status, 201);
    const pgrItem2 = int2.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    assert.ok(pgrItem2);
    assert.equal(pgrItem2.status, 'APROVADO');
    assert.equal(pgrItem2.reaproveitado, true);
    assert.equal(pgrItem2.officialRecordId, pgrRecordId);

    // Binary file downloadable directly via both integration item endpoints (no duplicate storage)
    for (const [intId, itemId] of [
      [int1.json.integration.id, pgrItem1.id],
      [int2.json.integration.id, pgrItem2.id],
    ]) {
      const dl = await httpJson(
        h.baseUrl,
        'GET',
        `/api/integrations/${encodeURIComponent(intId)}/items/${encodeURIComponent(itemId)}/file`,
        { token: h.tokens.solA }
      );
      assert.equal(dl.status, 200);
      assert.ok(dl.rawBuffer.equals(PDF_V1), 'Reused binary must match original uploaded PDF');
    }
    assert.equal(h.shared.documents.length, 1, 'Document stored once in official collection');
  } finally {
    await h.close();
  }
});

test('2. Individual doc reused strictly for exact collaborator (ID/CPF) — NEVER matched by name similarity', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    // Upload ASO & NR-35 for João da Silva (empA1, CPF 555.666.777-88) and approve
    const upAso = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'exame',
      empresaId: h.companyAId,
      colaboradorId: h.empA1Id,
      nomeDocumento: 'ASO Admissional',
      dataEmissao: addDaysIso(-10),
      dataValidade: addDaysIso(350),
      conclusao: 'apto',
      fileName: 'ASO_Joao_A1.png',
      bytes: PNG_ASO,
      mime: 'image/png',
    });
    assert.equal(upAso.status, 201);

    const upNr35 = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'treinamento',
      empresaId: h.companyAId,
      colaboradorId: h.empA1Id,
      nomeDocumento: 'Certificado NR-35 Trabalho em Altura',
      dataEmissao: addDaysIso(-10),
      dataValidade: addDaysIso(700),
      fileName: 'NR35_Joao_A1.jpg',
      bytes: JPEG_NR35,
      mime: 'image/jpeg',
    });
    assert.equal(upNr35.status, 201);

    const revAso = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/exame/${encodeURIComponent(upAso.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );
    assert.equal(revAso.status, 200);
    const revNr35 = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/treinamento/${encodeURIComponent(upNr35.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );
    assert.equal(revNr35.status, 200);

    // Create integration with BOTH empA1 AND empA2 (IDENTICAL name "João da Silva", DIFFERENT CPF!)
    const intRes = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id, h.empA2Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(intRes.status, 201);
    const items: any[] = intRes.json.items;

    const a1Aso = items.find((i) => i.colaboradorId === h.empA1Id && i.documentoCodigoCanonico === 'ASO');
    const a1Nr35 = items.find((i) => i.colaboradorId === h.empA1Id && i.documentoCodigoCanonico === 'NR35');
    const a2Aso = items.find((i) => i.colaboradorId === h.empA2Id && i.documentoCodigoCanonico === 'ASO');
    const a2Nr35 = items.find((i) => i.colaboradorId === h.empA2Id && i.documentoCodigoCanonico === 'NR35');

    assert.equal(a1Aso.status, 'APROVADO');
    assert.equal(a1Aso.reaproveitado, true);
    assert.equal(a1Nr35.status, 'APROVADO');
    assert.equal(a1Nr35.reaproveitado, true);

    // Same-name collaborator with different CPF MUST NOT reuse empA1's documents
    assert.equal(a2Aso.status, 'PENDENTE_ENVIO');
    assert.notEqual(a2Aso.reaproveitado, true);
    assert.equal(a2Aso.situacaoDocumentoExistente, 'AUSENTE');
    assert.equal(a2Nr35.status, 'PENDENTE_ENVIO');
    assert.notEqual(a2Nr35.reaproveitado, true);
    assert.equal(a2Nr35.situacaoDocumentoExistente, 'AUSENTE');
  } finally {
    await h.close();
  }
});

test('3. Pending documents are NEVER treated as approved', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    // Upload PGR (remains pendente — NOT approved by Admin)
    const up = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-2),
      dataValidade: addDaysIso(360),
      fileName: 'PGR_Pendente.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    assert.equal(up.status, 201);
    assert.equal(up.json.situacao, 'pendente');

    const intRes = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(intRes.status, 201);
    const pgrItem = intRes.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    assert.ok(pgrItem);
    assert.notEqual(pgrItem.status, 'APROVADO', 'Pending doc must NEVER be marked APROVADO');
    assert.equal(pgrItem.status, 'ENVIADO');
    assert.equal(pgrItem.reaproveitado, false);
    assert.equal(pgrItem.situacaoDocumentoExistente, 'PENDENTE_APROVACAO');
    assert.equal(pgrItem.officialRecordId, up.json.recordId);

    // Upload remaining 3 docs so integration can be submitted, while PGR stays PENDENTE_APROVACAO
    for (const item of intRes.json.items) {
      if (item.documentoCodigoCanonico === 'PGR') continue;
      const fd = new FormData();
      const bytes = item.documentoCodigoCanonico === 'ASO' ? PNG_ASO : PDF_V1;
      const mime = item.documentoCodigoCanonico === 'ASO' ? 'image/png' : 'application/pdf';
      fd.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `${item.documentoCodigoCanonico}.dat`);
      fd.append('itemId', item.id);
      fd.append('categoria', item.categoria);
      if (item.colaboradorId) fd.append('colaboradorId', item.colaboradorId);
      fd.append('documentoCodigoCanonico', item.documentoCodigoCanonico);
      fd.append('dataEmissao', addDaysIso(-2));
      fd.append('dataValidade', addDaysIso(360));
      if (item.documentoCodigoCanonico === 'ASO') fd.append('conclusaoAso', 'apto');
      const u = await httpMultipart(
        h.baseUrl,
        `/api/integrations/${encodeURIComponent(intRes.json.integration.id)}/documents/upload`,
        fd,
        { token: h.tokens.solA }
      );
      assert.equal(u.status, 200);
    }
    const sub = await httpJson(
      h.baseUrl,
      'POST',
      `/api/integrations/${encodeURIComponent(intRes.json.integration.id)}/submit`,
      { token: h.tokens.solA, body: {} }
    );
    assert.equal(sub.status, 200);

    // Attempt to approve integration without approveWholePackage must fail with 422 because PGR is still pending approval
    const approveRes = await httpJson(
      h.baseUrl,
      'POST',
      `/api/integrations/${encodeURIComponent(intRes.json.integration.id)}/approve`,
      { token: h.tokens.admin, body: {} }
    );
    assert.equal(approveRes.status, 422);
    assert.equal(approveRes.json.code, 'MANDATORY_ITEMS_INCOMPLETE');
  } finally {
    await h.close();
  }
});

test('4. Rejected documents are NOT reused and require replacement with visible justification', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    const up = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-2),
      dataValidade: addDaysIso(360),
      fileName: 'PGR_Ilegivel.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    assert.equal(up.status, 201);

    // Blank rejection reason must fail with 400
    const badReject = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(up.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'REPROVAR', motivo: '   ' } }
    );
    assert.equal(badReject.status, 400);

    // Valid rejection with justification
    const rej = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(up.json.recordId)}/review`,
      {
        token: h.tokens.admin,
        body: { decision: 'REPROVAR', motivo: 'Assinatura do engenheiro responsável ausente.' },
      }
    );
    assert.equal(rej.status, 200);
    assert.equal(rej.json.record.situacao, 'reprovado');

    const intRes = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(intRes.status, 201);
    const pgrItem = intRes.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    assert.equal(pgrItem.status, 'PENDENTE_ENVIO');
    assert.equal(pgrItem.reaproveitado, false);
    assert.equal(pgrItem.situacaoDocumentoExistente, 'RECUSADO');
    assert.ok(String(pgrItem.documentoExistenteAviso || '').includes('Assinatura do engenheiro'));
  } finally {
    await h.close();
  }
});

test('5. Expired approved documents are NEVER reused as valid', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    // Admin uploads an already-approved PGR whose validity date is in the past
    const up = await uploadDirect(h.baseUrl, h.tokens.admin, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-400),
      dataValidade: addDaysIso(-5),
      fileName: 'PGR_Vencido.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    assert.equal(up.status, 201);
    assert.equal(up.json.situacao, 'aprovado');

    const preview = await httpJson(h.baseUrl, 'POST', '/api/integrations/reuse-preview', {
      token: h.tokens.solA,
      body: {
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(preview.status, 200);
    const pgrPrev = preview.json.preview.itens.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    assert.equal(pgrPrev.situacao, 'VENCIDO');
    assert.equal(pgrPrev.reaproveitado, false);

    const intRes = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(intRes.status, 201);
    const pgrItem = intRes.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    assert.equal(pgrItem.status, 'PENDENTE_ENVIO');
    assert.equal(pgrItem.reaproveitado, false);
    assert.equal(pgrItem.situacaoDocumentoExistente, 'VENCIDO');
  } finally {
    await h.close();
  }
});

test('6. Updating 1 valid approved doc queues versaoPendente without invalidating active version or affecting other valid docs', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    // Seed & approve BOTH PGR and PCMSO
    const pgrUp = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-30),
      dataValidade: addDaysIso(180),
      fileName: 'PGR_v1.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    const pcmsoUp = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'PCMSO — Programa de Controle Médico',
      tipoDocumentoCanonico: 'PCMSO',
      dataEmissao: addDaysIso(-30),
      dataValidade: addDaysIso(180),
      fileName: 'PCMSO_v1.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pgrUp.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );
    await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pcmsoUp.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );

    // Solicitante updates ONLY PGR (v2) while v1 is still valid & approved
    const pgrV2 = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      recordId: pgrUp.json.recordId,
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-1),
      dataValidade: addDaysIso(365),
      fileName: 'PGR_v2.pdf',
      bytes: PDF_V2,
      mime: 'application/pdf',
    });
    assert.equal(pgrV2.status, 201);
    assert.equal(pgrV2.json.pendingVersionQueued, true);
    assert.equal(pgrV2.json.record.situacao, 'aprovado', 'Active approved version MUST NOT be invalidated');
    assert.equal(pgrV2.json.record.arquivoNome, 'PGR_v1.pdf', 'Active file remains v1 until Admin approves');
    assert.ok(pgrV2.json.record.versaoPendente, 'versaoPendente must be populated');
    assert.equal(pgrV2.json.record.versaoPendente.arquivoNome, 'PGR_v2.pdf');
    assert.equal(pgrV2.json.record.versaoPendente.versao, 2);

    // A new integration created right now STILL reuses BOTH PGR (active v1) and PCMSO without re-upload!
    const intDuringPending = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(intDuringPending.status, 201);
    const pgrCheck = intDuringPending.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    const pcmsoCheck = intDuringPending.json.items.find((i: any) => i.documentoCodigoCanonico === 'PCMSO');
    assert.equal(pgrCheck.status, 'APROVADO');
    assert.equal(pgrCheck.reaproveitado, true);
    assert.equal(pcmsoCheck.status, 'APROVADO');
    assert.equal(pcmsoCheck.reaproveitado, true);

    // If Admin rejects versaoPendente, active v1 stays approved and valid!
    const rejectV2 = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pgrUp.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'REPROVAR', motivo: 'Página 3 cortada no PDF v2.' } }
    );
    assert.equal(rejectV2.status, 200);
    assert.equal(rejectV2.json.record.situacao, 'aprovado', 'Rejecting pending v2 preserves active approved v1');
    assert.equal(rejectV2.json.record.arquivoNome, 'PGR_v1.pdf');
    assert.equal(rejectV2.json.record.versaoPendente ?? null, null);

    // Solicitante sends corrected v3 and Admin approves -> v3 becomes active!
    const pgrV3 = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      recordId: pgrUp.json.recordId,
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(0),
      dataValidade: addDaysIso(400),
      fileName: 'PGR_v3.pdf',
      bytes: PDF_V3,
      mime: 'application/pdf',
    });
    assert.equal(pgrV3.status, 201);
    assert.equal(pgrV3.json.pendingVersionQueued, true);

    const approveV3 = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pgrUp.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );
    assert.equal(approveV3.status, 200);
    assert.equal(approveV3.json.record.situacao, 'aprovado');
    assert.equal(approveV3.json.record.arquivoNome, 'PGR_v3.pdf');
    assert.equal(approveV3.json.record.versaoPendente ?? null, null);
  } finally {
    await h.close();
  }
});

test('7. Admin approval of a document automatically propagates to all applicable open integrations + RBAC on review', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    // Upload PGR (pending)
    const pgrUp = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-2),
      dataValidade: addDaysIso(360),
      fileName: 'PGR_Propagacao.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    assert.equal(pgrUp.status, 201);
    const pgrId: string = pgrUp.json.recordId;

    // Create 2 open integrations referencing this pending PGR
    const int1 = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    const int2 = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INCLUSAO_COLABORADOR',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA2Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(int1.status, 201);
    assert.equal(int2.status, 201);

    // Both start with PGR = ENVIADO (PENDENTE_APROVACAO)
    assert.equal(
      int1.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR').status,
      'ENVIADO'
    );
    assert.equal(
      int2.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR').status,
      'ENVIADO'
    );

    // RBAC: Solicitante and Auditor CANNOT call /review (403)
    const solTry = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pgrId)}/review`,
      { token: h.tokens.solA, body: { decision: 'APROVAR' } }
    );
    assert.equal(solTry.status, 403);
    const audTry = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pgrId)}/review`,
      { token: h.tokens.auditor, body: { decision: 'APROVAR' } }
    );
    assert.equal(audTry.status, 403);

    // Admin approves PGR ONCE -> both open integrations MUST automatically update to APROVADO!
    const adminRev = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pgrId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );
    assert.equal(adminRev.status, 200);

    for (const intId of [int1.json.integration.id, int2.json.integration.id]) {
      const detail = await httpJson(
        h.baseUrl,
        'GET',
        `/api/integrations/${encodeURIComponent(intId)}`,
        { token: h.tokens.solA }
      );
      assert.equal(detail.status, 200);
      const pgr = detail.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
      assert.equal(pgr.status, 'APROVADO', `Integration ${intId} PGR must auto-update to APROVADO`);
      assert.equal(pgr.reaproveitado, true);
      assert.equal(pgr.situacaoDocumentoExistente, 'REAPROVEITADO_VALIDO');
      assert.ok(detail.json.integration.resumoItens.aprovados >= 1);
    }
  } finally {
    await h.close();
  }
});

test('8. Multi-tenant isolation: Company A docs are inaccessible to Company B (403) and never cross-reused', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    // Company A uploads and gets approved PGR
    const upA = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-2),
      dataValidade: addDaysIso(360),
      fileName: 'PGR_Privado_A.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(upA.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );

    // Solicitante B cannot preview reuse for Company A (403)
    const crossPreview = await httpJson(h.baseUrl, 'POST', '/api/integrations/reuse-preview', {
      token: h.tokens.solB,
      body: {
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(crossPreview.status, 403);

    // Solicitante B cannot download Company A's file (403)
    const crossDl = await httpJson(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(upA.json.storageKey)}`,
      { token: h.tokens.solB }
    );
    assert.equal(crossDl.status, 403);

    // Company B's integration NEVER reuses Company A's approved PGR
    const intB = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solB,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyBId,
        colaboradorIds: [h.empB1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(intB.status, 201);
    const pgrB = intB.json.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    assert.equal(pgrB.status, 'PENDENTE_ENVIO');
    assert.notEqual(pgrB.reaproveitado, true);
    assert.equal(pgrB.situacaoDocumentoExistente, 'AUSENTE');
  } finally {
    await h.close();
  }
});

test('9. Version history (historicoVersoes) is strictly preserved across upload, pending update, rejection, and approval', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    const v1 = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-20),
      dataValidade: addDaysIso(200),
      fileName: 'PGR_hist_v1.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    assert.equal(v1.status, 201);
    const id = v1.json.recordId;
    assert.equal(v1.json.record.versao, 1);
    assert.equal(v1.json.record.historicoVersoes.length, 1);
    assert.equal(v1.json.record.historicoVersoes[0].arquivoHashSha256, sha256(PDF_V1));

    await httpJson(h.baseUrl, 'POST', `/api/direct-documents/documento/${encodeURIComponent(id)}/review`, {
      token: h.tokens.admin,
      body: { decision: 'APROVAR' },
    });

    const v2 = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      recordId: id,
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-1),
      dataValidade: addDaysIso(365),
      fileName: 'PGR_hist_v2.pdf',
      bytes: PDF_V2,
      mime: 'application/pdf',
    });
    assert.equal(v2.status, 201);
    assert.equal(v2.json.record.historicoVersoes.length, 2);

    const rev2 = await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(id)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );
    assert.equal(rev2.status, 200);
    assert.equal(rev2.json.record.versao, 2);
    assert.equal(rev2.json.record.historicoVersoes.length, 2);
    assert.equal(rev2.json.record.historicoVersoes[0].versao, 1);
    assert.equal(rev2.json.record.historicoVersoes[0].situacao, 'aprovado');
    assert.equal(rev2.json.record.historicoVersoes[0].arquivoHashSha256, sha256(PDF_V1));
    assert.equal(rev2.json.record.historicoVersoes[1].versao, 2);
    assert.equal(rev2.json.record.historicoVersoes[1].situacao, 'aprovado');
    assert.equal(rev2.json.record.historicoVersoes[1].arquivoHashSha256, sha256(PDF_V2));
  } finally {
    await h.close();
  }
});

test('10. Complete end-to-end integration finishes with zero duplicate uploads and exact Etapa 4 counters', async () => {
  const h = await createCentralizedReuseHarness();
  try {
    // Pre-register & approve PGR (corporate) and ASO (individual for empA1) ONCE
    const pgrUp = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'documento',
      empresaId: h.companyAId,
      nomeDocumento: 'Programa de Gerenciamento de Riscos (PGR)',
      tipoDocumentoCanonico: 'PGR',
      dataEmissao: addDaysIso(-5),
      dataValidade: addDaysIso(360),
      fileName: 'PGR_E2E.pdf',
      bytes: PDF_V1,
      mime: 'application/pdf',
    });
    const asoUp = await uploadDirect(h.baseUrl, h.tokens.solA, {
      kind: 'exame',
      empresaId: h.companyAId,
      colaboradorId: h.empA1Id,
      nomeDocumento: 'ASO Periódico',
      dataEmissao: addDaysIso(-5),
      dataValidade: addDaysIso(360),
      conclusao: 'apto',
      fileName: 'ASO_E2E.png',
      bytes: PNG_ASO,
      mime: 'image/png',
    });
    await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/documento/${encodeURIComponent(pgrUp.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );
    await httpJson(
      h.baseUrl,
      'POST',
      `/api/direct-documents/exame/${encodeURIComponent(asoUp.json.recordId)}/review`,
      { token: h.tokens.admin, body: { decision: 'APROVAR' } }
    );

    // Step 1: Reuse Preview before creation -> 2 reused (PGR + ASO), 2 missing (PCMSO + NR35)
    const preview = await httpJson(h.baseUrl, 'POST', '/api/integrations/reuse-preview', {
      token: h.tokens.solA,
      body: {
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.preview.reaproveitadosAprovados, 2);
    assert.equal(preview.json.preview.ausentes, 2);

    // Step 2: Create integration -> PGR & ASO auto-approved, only PCMSO & NR35 need upload
    const created = await httpJson(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(created.status, 201);
    const integrationId: string = created.json.integration.id;
    const pcmsoItem = created.json.items.find((i: any) => i.documentoCodigoCanonico === 'PCMSO');
    const nr35Item = created.json.items.find((i: any) => i.documentoCodigoCanonico === 'NR35');
    assert.equal(pcmsoItem.status, 'PENDENTE_ENVIO');
    assert.equal(nr35Item.status, 'PENDENTE_ENVIO');

    // Step 3: Upload ONLY the 2 missing docs (zero re-uploads of PGR or ASO)
    const fdPcmso = new FormData();
    fdPcmso.append('file', new Blob([new Uint8Array(PDF_V2)], { type: 'application/pdf' }), 'PCMSO_E2E.pdf');
    fdPcmso.append('itemId', pcmsoItem.id);
    fdPcmso.append('categoria', 'empresa');
    fdPcmso.append('documentoCodigoCanonico', 'PCMSO');
    fdPcmso.append('dataEmissao', addDaysIso(-2));
    fdPcmso.append('dataValidade', addDaysIso(360));
    const upPcmso = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/documents/upload`,
      fdPcmso,
      { token: h.tokens.solA }
    );
    assert.equal(upPcmso.status, 200);

    const fdNr35 = new FormData();
    fdNr35.append('file', new Blob([new Uint8Array(JPEG_NR35)], { type: 'image/jpeg' }), 'NR35_E2E.jpg');
    fdNr35.append('itemId', nr35Item.id);
    fdNr35.append('categoria', 'colaborador');
    fdNr35.append('colaboradorId', h.empA1Id);
    fdNr35.append('documentoCodigoCanonico', 'NR35');
    fdNr35.append('dataEmissao', addDaysIso(-2));
    fdNr35.append('dataValidade', addDaysIso(700));
    const upNr35 = await httpMultipart(
      h.baseUrl,
      `/api/integrations/${encodeURIComponent(integrationId)}/documents/upload`,
      fdNr35,
      { token: h.tokens.solA }
    );
    assert.equal(upNr35.status, 200);

    // Verify Etapa 4 readiness counters before submission
    const detailBeforeSubmit = await httpJson(
      h.baseUrl,
      'GET',
      `/api/integrations/${encodeURIComponent(integrationId)}`,
      { token: h.tokens.solA }
    );
    assert.equal(detailBeforeSubmit.status, 200);
    const readiness = detailBeforeSubmit.json.submissionReadiness;
    assert.equal(readiness.podeSubmeter, true);
    assert.equal(readiness.reaproveitadosAprovados, 2);
    assert.equal(readiness.novosEnviados, 2);
    assert.equal(readiness.recusados, 0);
    assert.equal(readiness.atualizacaoNecessaria, 0);

    // Step 4: Submit integration ("ENVIAR DOCUMENTAÇÃO PARA ANÁLISE")
    const submit = await httpJson(
      h.baseUrl,
      'POST',
      `/api/integrations/${encodeURIComponent(integrationId)}/submit`,
      { token: h.tokens.solA, body: {} }
    );
    assert.equal(submit.status, 200);
    assert.equal(submit.json.integration.status, 'AGUARDANDO_ANALISE');

    // Step 5: Admin approves integration package -> APROVADA, and PCMSO + NR35 enter official base
    const approve = await httpJson(
      h.baseUrl,
      'POST',
      `/api/integrations/${encodeURIComponent(integrationId)}/approve`,
      { token: h.tokens.admin, body: { approveWholePackage: true } }
    );
    assert.equal(approve.status, 200);
    assert.equal(approve.json.integration.status, 'APROVADA');

    // Step 6: A subsequent integration for the same company & collaborator now reuses ALL 4 docs (zero uploads required!)
    const nextPreview = await httpJson(h.baseUrl, 'POST', '/api/integrations/reuse-preview', {
      token: h.tokens.solA,
      body: {
        empresaId: h.companyAId,
        colaboradorIds: [h.empA1Id],
        atividadeIds: ['act-altura'],
      },
    });
    assert.equal(nextPreview.status, 200);
    assert.equal(nextPreview.json.preview.reaproveitadosAprovados, 4);
    assert.equal(nextPreview.json.preview.ausentes, 0);
  } finally {
    await h.close();
  }
});
