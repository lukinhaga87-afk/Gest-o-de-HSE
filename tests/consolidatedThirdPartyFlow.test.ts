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
  identifyExtendedExpirationMilestone,
} from '../backend/inAppNotificationService';
import { InMemoryIntegrationFileStorage } from '../backend/integrationFileStorage';
import { evaluateActivityCompliance } from '../src/utils/activityComplianceEngine';
import type {
  ActivityDocumentRequirement,
  ActivityProfile,
  Company,
  DocumentSST,
  Employee,
  OccupationalExam,
  Training,
  UserProfile,
} from '../src/types/sst';

const PDF_V1_BYTES = Buffer.from('%PDF-1.4\n%EHS More Consolidado Documento V1\n%%EOF');
const PDF_V2_BYTES = Buffer.from('%PDF-1.4\n%EHS More Consolidado Documento V2 Corrigido\n%%EOF');
const PDF_V1_DATA_URL = `data:application/pdf;base64,${PDF_V1_BYTES.toString('base64')}`;
const PDF_V2_DATA_URL = `data:application/pdf;base64,${PDF_V2_BYTES.toString('base64')}`;

function addDaysIso(days: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function httpRequest(
  baseUrl: string,
  method: string,
  path: string,
  opts?: { token?: string; body?: any }
): Promise<{ status: number; json: any; rawBuffer: Buffer; contentType: string }> {
  const headers: Record<string, string> = {};
  if (opts?.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  let payload: string | undefined;
  if (opts?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(opts.body);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: payload,
  });
  const contentType = res.headers.get('content-type') || '';
  const arrayBuf = await res.arrayBuffer();
  const rawBuffer = Buffer.from(arrayBuf);
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

interface TestHarness {
  baseUrl: string;
  close: () => Promise<void>;
  tokens: {
    admin: string;
    solA: string;
    solB: string;
    auditor: string;
  };
  users: Array<UserProfile & { cpf: string }>;
  thirdPartyRepo: ReturnType<typeof createInMemoryThirdPartyRepository>;
  integrationRepo: ReturnType<typeof createInMemoryIntegrationRepository>;
  notifRepo: ReturnType<typeof createInMemoryInAppNotificationRepository>;
  fileStorage: InMemoryIntegrationFileStorage;
  notifService: InAppNotificationService;
  integrationService: IntegrationWorkflowService;
  thirdPartyService: ThirdPartyManagementService;
  activityProfiles: ActivityProfile[];
  activityDocumentRequirements: ActivityDocumentRequirement[];
}

function buildActivityMatrix(adminId: string, adminNome: string): {
  activityProfiles: ActivityProfile[];
  activityDocumentRequirements: ActivityDocumentRequirement[];
} {
  const activityProfiles: ActivityProfile[] = [
    {
      id: 'act-altura',
      codigo: 'NR35_ALTURA',
      nome: 'Trabalho em Altura (NR-35)',
      descricao: 'Atividades acima de 2 metros com risco de queda.',
      nivelRisco: 'alto',
      riscosAssociados: ['Queda de altura'],
      normasAplicaveis: ['NR-01', 'NR-07', 'NR-35'],
      exigePT: true,
      exigeAPR: true,
      exigeLOTO: false,
      ativo: true,
      criadoPorId: adminId,
      criadoPorNome: adminNome,
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
      criadoPorId: adminId,
      criadoPorNome: adminNome,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'req-aso',
      activityId: 'act-altura',
      escopo: 'colaborador',
      origemColecao: 'exams',
      documentoCodigoCanonico: 'ASO',
      nomeExibicao: 'Atestado de Saude Ocupacional (ASO)',
      palavrasChaveMatch: ['aso'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: true,
      baseLegal: 'NR-07',
      ordemExibicao: 2,
      ativo: true,
      criadoPorId: adminId,
      criadoPorNome: adminNome,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'req-nr35',
      activityId: 'act-altura',
      escopo: 'colaborador',
      origemColecao: 'trainings',
      documentoCodigoCanonico: 'NR-35',
      nomeExibicao: 'Certificado NR-35',
      palavrasChaveMatch: ['nr-35', 'nr35', 'altura'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: false,
      baseLegal: 'NR-35',
      ordemExibicao: 3,
      ativo: true,
      criadoPorId: adminId,
      criadoPorNome: adminNome,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  return { activityProfiles, activityDocumentRequirements };
}

async function createHarness(existing?: {
  companies: Company[];
  employees: Employee[];
  documents: DocumentSST[];
  exams: OccupationalExam[];
  trainings: Training[];
  users: Array<UserProfile & { cpf: string }>;
  fileStorage: InMemoryIntegrationFileStorage;
  integrationRepo?: ReturnType<typeof createInMemoryIntegrationRepository>;
  notifRepo?: ReturnType<typeof createInMemoryInAppNotificationRepository>;
}): Promise<TestHarness> {
  process.env.API_AUTH_SECRET = 'test-ehs-more-consolidado-secret-32-chars!!';

  const users: Array<UserProfile & { cpf: string }> = existing?.users || [
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
      email: 'sol.a@contratada-a.com',
      role: 'solicitante',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sol-b-1',
      nome: 'Solicitante Empresa B',
      cpf: '22222222222',
      username: '22222222222',
      email: 'sol.b@contratada-b.com',
      role: 'solicitante',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'auditor-1',
      nome: 'Auditor Somente Leitura',
      cpf: '33333333333',
      username: '33333333333',
      email: 'auditor@ehsmore.com',
      role: 'auditor',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const { activityProfiles, activityDocumentRequirements } = buildActivityMatrix(
    users[0].id,
    users[0].nome
  );

  const fileStorage = existing?.fileStorage || new InMemoryIntegrationFileStorage();

  const thirdPartyRepo = createInMemoryThirdPartyRepository({
    companies: existing?.companies || [],
    userProfiles: users,
    employees: existing?.employees || [],
    documents: existing?.documents || [],
    exams: existing?.exams || [],
    trainings: existing?.trainings || [],
  });

  // Share the exact same arrays so writes via ThirdPartyManagementService are immediately visible
  // to IntegrationWorkflowService and InAppNotificationService (just like shared Firestore collections).
  const sharedState = thirdPartyRepo.state;

  const notifRepo =
    existing?.notifRepo ||
    createInMemoryInAppNotificationRepository({
      companies: sharedState.companies,
      documents: sharedState.documents,
      trainings: sharedState.trainings,
      exams: sharedState.exams,
    });
  // Keep notifRepo pointing at shared mutable arrays when newly created
  if (!existing?.notifRepo) {
    (notifRepo as any).companies = sharedState.companies;
  }

  const notifService = new InAppNotificationService(notifRepo);

  const integrationRepo =
    existing?.integrationRepo ||
    createInMemoryIntegrationRepository({
      companies: sharedState.companies,
      employees: sharedState.employees,
      activityProfiles,
      activityDocumentRequirements,
      documents: sharedState.documents,
      trainings: sharedState.trainings,
      exams: sharedState.exams,
    });

  // Synchronize integrationRepo read lookups with sharedState arrays so newly registered companies/employees appear
  const origListCompanies = integrationRepo.listCompanies.bind(integrationRepo);
  integrationRepo.listCompanies = async () => [...sharedState.companies];
  integrationRepo.getCompanyById = async (id: string) =>
    sharedState.companies.find((c) => c.id === id) || null;
  integrationRepo.listEmployees = async () => [...sharedState.employees];
  integrationRepo.getEmployeeById = async (id: string) =>
    sharedState.employees.find((e) => e.id === id) || null;
  void origListCompanies;

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
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    tokens: {
      admin: signAuthToken(users[0]).token,
      solA: signAuthToken(users[1]).token,
      solB: signAuthToken(users[2]).token,
      auditor: signAuthToken(users[3]).token,
    },
    users,
    thirdPartyRepo,
    integrationRepo,
    notifRepo,
    fileStorage,
    notifService,
    integrationService,
    thirdPartyService,
    activityProfiles,
    activityDocumentRequirements,
  };
}

test('Teste 1 — Cadastro de empresa pelo Solicitante, vinculo automatico, CNPJ duplicado e persistencia pos-login', async () => {
  const h = await createHarness();
  try {
    // 1. Solicitante A cadastra Empresa 1
    const reg1 = await httpRequest(h.baseUrl, 'POST', '/api/companies/register', {
      token: h.tokens.solA,
      body: {
        razaoSocial: 'Alfa Servicos Industriais Ltda',
        nomeFantasia: 'Alfa Industrial',
        cnpj: '11.222.333/0001-44',
        responsavelLegal: 'Carlos Alfa',
        responsavelSST: 'Eng. Ana Alfa',
        telefone: '11999990001',
        email: 'contato@alfa.com',
        unidadeAtendimento: 'Planta SP',
        atividadeContratada: 'Trabalho em Altura (NR-35)',
        atividadesAutorizadasIds: ['act-altura'],
        contrato_indeterminado: true,
      },
    });
    assert.equal(reg1.status, 201, `Esperado 201, recebido ${reg1.status}: ${JSON.stringify(reg1.json)}`);
    const comp1: Company = reg1.json.company;
    assert.ok(comp1.id);
    assert.equal(comp1.criadoPorId, 'sol-a-1');
    assert.ok(comp1.solicitantesAutorizadosIds?.includes('sol-a-1'));
    assert.ok(reg1.json.user.empresaIds?.includes(comp1.id));
    assert.equal(reg1.json.user.empresaId, comp1.id);

    // 2. CNPJ duplicado deve ser bloqueado (409)
    const dupRes = await httpRequest(h.baseUrl, 'POST', '/api/companies/register', {
      token: h.tokens.solA,
      body: {
        razaoSocial: 'Duplicada Ltda',
        cnpj: '11222333000144',
      },
    });
    assert.equal(dupRes.status, 409, 'CNPJ duplicado deve retornar 409');

    // 3. Solicitante A cadastra segunda empresa (multiempresa)
    const reg2 = await httpRequest(h.baseUrl, 'POST', '/api/companies/register', {
      token: h.tokens.solA,
      body: {
        razaoSocial: 'Alfa Filial Nordeste Ltda',
        cnpj: '22.333.444/0001-55',
        atividadesAutorizadasIds: ['act-altura'],
      },
    });
    assert.equal(reg2.status, 201);
    const comp2: Company = reg2.json.company;
    assert.equal(reg2.json.user.empresaIds.length, 2);
    assert.ok(reg2.json.user.empresaIds.includes(comp1.id));
    assert.ok(reg2.json.user.empresaIds.includes(comp2.id));

    // 4. Logout & re-login: GET /api/auth/me retorna o perfil atualizado com ambas empresas vinculadas
    const solAUser = h.thirdPartyRepo.state.userProfiles[1];
    const freshTokenSolA = signAuthToken({ ...solAUser, cpf: solAUser.cpf || '11111111111' }).token;
    const meRes = await httpRequest(h.baseUrl, 'GET', '/api/auth/me', {
      token: freshTokenSolA,
    });
    assert.equal(meRes.status, 200);
    assert.deepEqual(new Set(meRes.json.user.empresaIds), new Set([comp1.id, comp2.id]));

    // 5. Admin pode gerenciar multiplos solicitantes vinculados a mesma empresa
    const linkRes = await httpRequest(h.baseUrl, 'PUT', `/api/companies/${comp1.id}/links`, {
      token: h.tokens.admin,
      body: { solicitanteUserIds: ['sol-a-1', 'sol-b-1'] },
    });
    assert.equal(linkRes.status, 200);
    assert.ok(linkRes.json.company.solicitantesAutorizadosIds.includes('sol-b-1'));
    const solBProfile = h.thirdPartyRepo.state.userProfiles.find((u) => u.id === 'sol-b-1')!;
    assert.ok(solBProfile.empresaIds?.includes(comp1.id));
  } finally {
    await h.close();
  }
});

test('Teste 2 — Upload direto de documento empresarial, armazenamento verificado, download binario e bloqueio de autoaprovacao', async () => {
  const h = await createHarness();
  try {
    const reg = await httpRequest(h.baseUrl, 'POST', '/api/companies/register', {
      token: h.tokens.solA,
      body: {
        razaoSocial: 'Beta Engenharia Ltda',
        cnpj: '33.444.555/0001-66',
      },
    });
    const companyId = reg.json.company.id;

    // Upload de PGR (PDF real)
    const uploadRes = await httpRequest(h.baseUrl, 'POST', '/api/direct-documents/upload', {
      token: h.tokens.solA,
      body: {
        kind: 'documento',
        empresaId: companyId,
        nomeDocumento: 'PGR 2026',
        tipoDocumentoCanonico: 'PGR',
        categoria: 'PGR',
        dataEmissao: addDaysIso(-5),
        dataValidade: addDaysIso(360),
        arquivoNome: 'pgr-beta-2026.pdf',
        arquivoBase64: PDF_V1_DATA_URL,
      },
    });
    assert.equal(uploadRes.status, 201, `Upload falhou: ${JSON.stringify(uploadRes.json)}`);
    assert.equal(uploadRes.json.storageVerified, true);
    assert.equal(
      uploadRes.json.sha256,
      crypto.createHash('sha256').update(PDF_V1_BYTES).digest('hex')
    );

    const record: DocumentSST = uploadRes.json.record;
    // Jamais autoaprovar envio do Solicitante
    assert.equal(record.situacao, 'pendente', 'Documento enviado por Solicitante DEVE iniciar como pendente');
    // Nao deve armazenar Base64 bruto no documento
    assert.ok(record.arquivoUrl?.startsWith(DIRECT_FILE_URL_PREFIX));
    assert.equal(record.arquivoUrl?.startsWith('data:'), false);

    // Download/visualizacao autenticado deve retornar os bytes exatos do PDF
    const storageKey = uploadRes.json.storageKey;
    const dlRes = await httpRequest(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(storageKey)}`,
      { token: h.tokens.solA }
    );
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.contentType.includes('application/pdf'), true);
    assert.equal(Buffer.compare(dlRes.rawBuffer, PDF_V1_BYTES), 0, 'Bytes baixados devem corresponder 100% ao PDF enviado');

    // Admin tambem consegue abrir o arquivo
    const adminDl = await httpRequest(
      h.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(storageKey)}`,
      { token: h.tokens.admin }
    );
    assert.equal(adminDl.status, 200);
    assert.equal(Buffer.compare(adminDl.rawBuffer, PDF_V1_BYTES), 0);
  } finally {
    await h.close();
  }
});

test('Teste 3 — Cadastro de colaborador, bloqueio de CPF duplicado e prontuario individual com upload verificado', async () => {
  const h = await createHarness();
  try {
    const compRes = await httpRequest(h.baseUrl, 'POST', '/api/companies/register', {
      token: h.tokens.solA,
      body: { razaoSocial: 'Gama Montagens Ltda', cnpj: '44.555.666/0001-77' },
    });
    const companyId = compRes.json.company.id;

    // Cadastrar colaborador
    const empRes = await httpRequest(h.baseUrl, 'POST', '/api/employees/register', {
      token: h.tokens.solA,
      body: {
        empresaId: companyId,
        nomeCompleto: 'Joao Pedro Silva',
        cpf: '123.456.789-01',
        cargo: 'Montador Industrial',
        setor: 'Montagem',
        atividadeExecutada: 'Trabalho em Altura (NR-35)',
        dataAdmissao: '2026-01-10',
      },
    });
    assert.equal(empRes.status, 201);
    const employee: Employee = empRes.json.employee;
    assert.equal(employee.empresaId, companyId);

    // CPF duplicado rejeitado com 409
    const dupEmp = await httpRequest(h.baseUrl, 'POST', '/api/employees/register', {
      token: h.tokens.solA,
      body: {
        empresaId: companyId,
        nomeCompleto: 'Outro Nome Mesmo CPF',
        cpf: '12345678901',
        cargo: 'Auxiliar',
      },
    });
    assert.equal(dupEmp.status, 409, 'CPF duplicado deve retornar 409');

    // Upload de exame ASO no prontuario individual do colaborador
    const examUpload = await httpRequest(h.baseUrl, 'POST', '/api/direct-documents/upload', {
      token: h.tokens.solA,
      body: {
        kind: 'exame',
        empresaId: companyId,
        colaboradorId: employee.id,
        nomeDocumento: 'ASO Periodico',
        conclusao: 'apto',
        dataEmissao: addDaysIso(-2),
        dataValidade: addDaysIso(363),
        arquivoNome: 'aso-joao.pdf',
        arquivoBase64: PDF_V1_DATA_URL,
      },
    });
    assert.equal(examUpload.status, 201);
    assert.equal(examUpload.json.record.colaboradorId, employee.id);
    assert.equal(examUpload.json.record.situacao, 'pendente');

    // Upload de treinamento NR-35 no prontuario individual
    const trnUpload = await httpRequest(h.baseUrl, 'POST', '/api/direct-documents/upload', {
      token: h.tokens.solA,
      body: {
        kind: 'treinamento',
        empresaId: companyId,
        colaboradorId: employee.id,
        nomeDocumento: 'NR-35 Trabalho em Altura',
        tipoDocumentoCanonico: 'NR-35',
        cargaHoraria: '8h',
        dataEmissao: addDaysIso(-10),
        dataValidade: addDaysIso(700),
        arquivoNome: 'nr35-joao.pdf',
        arquivoBase64: PDF_V1_DATA_URL,
      },
    });
    assert.equal(trnUpload.status, 201);
    assert.equal(trnUpload.json.record.colaboradorId, employee.id);
    assert.equal(trnUpload.json.record.situacao, 'pendente');
  } finally {
    await h.close();
  }
});

test('Teste 4 e Teste 5 — Fluxo completo de integracao: rascunho, bloqueio sem obrigatorios, envio, aprovacao parcial, reprovacao com justificativa obrigatoria, correcao sem reenviar aprovados e aprovacao final', async () => {
  const h = await createHarness();
  try {
    // Setup empresa + colaborador
    const compRes = await httpRequest(h.baseUrl, 'POST', '/api/companies/register', {
      token: h.tokens.solA,
      body: {
        razaoSocial: 'Delta Engenharia S.A.',
        cnpj: '55.666.777/0001-88',
        atividadesAutorizadasIds: ['act-altura'],
      },
    });
    const companyId = compRes.json.company.id;

    const empRes = await httpRequest(h.baseUrl, 'POST', '/api/employees/register', {
      token: h.tokens.solA,
      body: {
        empresaId: companyId,
        nomeCompleto: 'Maria Oliveira',
        cpf: '987.654.321-00',
        cargo: 'Tecnica de Campo',
      },
    });
    const empId = empRes.json.employee.id;

    // 1. Criar rascunho de integracao
    const draftRes = await httpRequest(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: companyId,
        atividadeIds: ['act-altura'],
        colaboradorIds: [empId],
        observacoesGerais: 'Rascunho inicial salvo',
      },
    });
    assert.equal(draftRes.status, 201);
    const integrationId = draftRes.json.integration.id;
    assert.equal(draftRes.json.integration.status, 'RASCUNHO');
    assert.equal(draftRes.json.items.length, 3, 'Deve gerar 3 requisitos obrigatorios (PGR, ASO, NR-35)');

    // 2. Retomar rascunho via GET
    const resumed = await httpRequest(h.baseUrl, 'GET', `/api/integrations/${integrationId}`, {
      token: h.tokens.solA,
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.json.integration.status, 'RASCUNHO');

    // 3. Bloquear envio enquanto faltam documentos obrigatorios (422)
    const blockedSubmit = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/submit`,
      { token: h.tokens.solA, body: {} }
    );
    assert.equal(blockedSubmit.status, 422, 'Envio sem obrigatorios deve retornar 422');

    // 4. Anexar os 3 documentos obrigatorios
    const items: any[] = resumed.json.items;
    for (const item of items) {
      const up = await httpRequest(
        h.baseUrl,
        'POST',
        `/api/integrations/${integrationId}/documents/upload`,
        {
          token: h.tokens.solA,
          body: {
            itemId: item.id,
            arquivoNome: `${item.documentoCodigoCanonico.toLowerCase()}-v1.pdf`,
            arquivoBase64: PDF_V1_DATA_URL,
            dataEmissao: addDaysIso(-5),
            dataValidade: addDaysIso(300),
            conclusaoAso: item.documentoCodigoCanonico === 'ASO' ? 'apto' : undefined,
            runSmartDocsAi: false,
          },
        }
      );
      assert.equal(up.status, 200, `Upload do item ${item.documentoCodigoCanonico} falhou: ${JSON.stringify(up.json)}`);
    }

    // 5. Submeter pacote para analise
    const submitRes = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/submit`,
      { token: h.tokens.solA, body: {} }
    );
    assert.equal(submitRes.status, 200);
    assert.equal(submitRes.json.integration.status, 'AGUARDANDO_ANALISE');

    const pgrItem = items.find((i) => i.documentoCodigoCanonico === 'PGR');
    const asoItem = items.find((i) => i.documentoCodigoCanonico === 'ASO');
    const nr35Item = items.find((i) => i.documentoCodigoCanonico === 'NR-35');

    // 6. Admin aprova PGR
    const approvePgr = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/items/${pgrItem.id}/review`,
      {
        token: h.tokens.admin,
        body: { decisao: 'APROVADO', observacoes: 'PGR valido e assinado.' },
      }
    );
    assert.equal(approvePgr.status, 200, `Aprovacao PGR falhou: ${JSON.stringify(approvePgr.json)}`);
    const reviewedPgr = approvePgr.json.items.find((i: any) => i.id === pgrItem.id);
    assert.equal(reviewedPgr.status, 'APROVADO');

    // 7. Reprovar sem justificativa deve falhar (400)
    const rejectWithoutReason = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/items/${asoItem.id}/review`,
      {
        token: h.tokens.admin,
        body: { decisao: 'REPROVADO', motivo: '' },
      }
    );
    assert.equal(rejectWithoutReason.status, 400, 'Reprovacao sem justificativa deve ser bloqueada');

    // 8. Admin reprova ASO com justificativa obrigatoria e devolve para correcao
    const rejectAso = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/items/${asoItem.id}/review`,
      {
        token: h.tokens.admin,
        body: {
          decisao: 'REPROVADO',
          motivo: 'ASO sem carimbo e assinatura do medico examinador.',
        },
      }
    );
    assert.equal(rejectAso.status, 200, `Reprovacao ASO falhou: ${JSON.stringify(rejectAso.json)}`);
    const reviewedAso = rejectAso.json.items.find((i: any) => i.id === asoItem.id);
    assert.equal(reviewedAso.status, 'REPROVADO');

    const reqCorr = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/request-correction`,
      {
        token: h.tokens.admin,
        body: {
          justificativa: 'Corrigir ASO sem carimbo do medico examinador.',
          itemIds: [asoItem.id],
        },
      }
    );
    assert.equal(reqCorr.status, 200, `Devolucao falhou: ${JSON.stringify(reqCorr.json)}`);
    assert.equal(reqCorr.json.integration.status, 'PENDENTE_CORRECAO');

    // 9. Solicitante recebe notificacao da reprovacao/devolucao
    const solNotifs = await httpRequest(h.baseUrl, 'GET', '/api/in-app-notifications', {
      token: h.tokens.solA,
    });
    assert.equal(solNotifs.status, 200);
    assert.ok(
      solNotifs.json.notifications.some(
        (n: any) =>
          (n.type === 'DOCUMENTO_REJEITADO' || n.type === 'INTEGRACAO_AGUARDANDO_COMPLEMENTACAO') &&
          String(n.message).toLowerCase().includes('carimbo')
      ),
      'Solicitante deve receber notificacao com motivo da reprovacao'
    );

    // 10. Solicitante corrige APENAS o ASO (v1 -> v2 preservando historico) e reenvia
    const fixAso = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/documents/upload`,
      {
        token: h.tokens.solA,
        body: {
          itemId: asoItem.id,
          arquivoNome: 'aso-v2-carimbado.pdf',
          arquivoBase64: PDF_V2_DATA_URL,
          dataEmissao: addDaysIso(-1),
          dataValidade: addDaysIso(364),
          conclusaoAso: 'apto',
          runSmartDocsAi: false,
        },
      }
    );
    assert.equal(fixAso.status, 200, `Reenvio ASO falhou: ${JSON.stringify(fixAso.json)}`);
    const updatedAso = fixAso.json.items.find((i: any) => i.id === asoItem.id);
    assert.equal(updatedAso.versaoAtual, 2, 'Versao do documento corrigido deve incrementar para v2');
    assert.ok(updatedAso.versoes.length >= 2, 'Historico de versoes deve preservar v1 e v2');

    const resubmit = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/submit`,
      { token: h.tokens.solA, body: { justificativa: 'ASO reenviado com carimbo.' } }
    );
    assert.equal(resubmit.status, 200, `Reenvio da integracao falhou: ${JSON.stringify(resubmit.json)}`);
    assert.equal(resubmit.json.integration.status, 'REENVIADA');

    // Verificar que PGR permaneceu APROVADO (sem necessidade de reenvio)
    const afterResubmit = await httpRequest(h.baseUrl, 'GET', `/api/integrations/${integrationId}`, {
      token: h.tokens.admin,
    });
    const pgrAfter = afterResubmit.json.items.find((i: any) => i.id === pgrItem.id);
    assert.equal(pgrAfter.status, 'APROVADO', 'Documento ja aprovado NAO pode ser resetado no reenvio');

    // 11. Admin aprova ASO v2 e NR-35 e finaliza a integracao
    const approveAso = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/items/${asoItem.id}/review`,
      { token: h.tokens.admin, body: { decisao: 'APROVADO' } }
    );
    assert.equal(approveAso.status, 200);

    const approveNr35 = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/items/${nr35Item.id}/review`,
      { token: h.tokens.admin, body: { decisao: 'APROVADO' } }
    );
    assert.equal(approveNr35.status, 200);

    const finalApprove = await httpRequest(
      h.baseUrl,
      'POST',
      `/api/integrations/${integrationId}/approve`,
      { token: h.tokens.admin, body: { observacao: 'Integracao concluida na Base Oficial.' } }
    );
    assert.equal(finalApprove.status, 200, `Aprovacao final falhou: ${JSON.stringify(finalApprove.json)}`);
    assert.equal(finalApprove.json.integration.status, 'APROVADA');
  } finally {
    await h.close();
  }
});

test('Teste 6 — Integridade da Base Oficial: somente documentos aprovados contam como validos; pendentes e reprovados nunca contam', () => {
  const { activityProfiles, activityDocumentRequirements } = buildActivityMatrix(
    'admin-1',
    'Admin EHS'
  );

  const company: Company = {
    id: 'comp-oficial',
    razaoSocial: 'Base Oficial Engenharia Ltda',
    nomeFantasia: 'Base Oficial',
    cnpj: '66.777.888/0001-99',
    responsavelLegal: 'Diretor',
    responsavelSST: 'Eng. SST',
    telefone: '11999990000',
    email: 'sst@baseoficial.com',
    endereco: 'Av. Central, 10',
    unidadeAtendimento: 'Planta SP',
    atividadeContratada: 'Trabalho em Altura',
    atividadesAutorizadasIds: ['act-altura'],
    dataInicioContrato: '2026-01-01',
    dataTerminoContrato: '2028-12-31',
    contrato_indeterminado: false,
    situacao: 'ativa',
  };

  const employee: Employee = {
    id: 'emp-oficial-1',
    empresaId: company.id,
    empresaNome: company.razaoSocial,
    nomeCompleto: 'Lucas Operador',
    cpf: '555.444.333-22',
    cargo: 'Montador',
    setor: 'Campo',
    telefone: '11988887777',
    email: 'lucas@baseoficial.com',
    atividadeExecutada: 'Trabalho em Altura',
    dataAdmissao: '2026-01-01',
    situacaoCadastral: 'ativo',
  };

  // Cenario A: PGR pendente, ASO rejeitado, NR-35 pendente -> ZERO conformes, bloqueado
  const evalPending = evaluateActivityCompliance({
    company,
    atividadeIds: ['act-altura'],
    colaboradorIds: [employee.id],
    activityProfiles,
    requirements: activityDocumentRequirements,
    employees: [employee],
    documents: [
      {
        id: 'd-pgr-pending',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        nomeDocumento: 'PGR 2026',
        tipoDocumentoCanonico: 'PGR',
        categoria: 'PGR',
        dataEmissao: addDaysIso(-5),
        dataValidade: addDaysIso(300),
        responsavelEnvio: 'Solicitante',
        arquivoUrl: 'ehs-direct://integrations/comp-oficial/pgr.pdf',
        arquivoNome: 'pgr.pdf',
        versao: 1,
        situacao: 'pendente',
      },
    ],
    exams: [
      {
        id: 'e-aso-rejected',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        colaboradorId: employee.id,
        colaboradorNome: employee.nomeCompleto,
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['trabalho_altura'],
        dataRealizacao: addDaysIso(-5),
        dataValidade: addDaysIso(300),
        conclusao: 'apto',
        situacao: 'reprovado',
      },
    ],
    trainings: [
      {
        id: 't-nr35-pending',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        colaboradorId: employee.id,
        colaboradorNome: employee.nomeCompleto,
        nomeTreinamento: 'NR-35 Trabalho em Altura',
        tipoDocumentoCanonico: 'NR-35',
        cargaHoraria: '8h',
        dataRealizacao: addDaysIso(-5),
        dataValidade: addDaysIso(300),
        situacao: 'pendente',
      },
    ],
    epiDeliveries: [],
    safetyPermits: [],
    smartDocs: [],
  });

  assert.equal(evalPending.resumo.conformes, 0, 'Documentos pendentes/reprovados NUNCA podem contar como conformes');
  assert.equal(evalPending.podeLiberar, false);
  assert.equal(evalPending.resumo.bloqueiosObrigatorios > 0, true);

  // Cenario B: Todos aprovados e validos -> 100% conforme e liberado
  const evalApproved = evaluateActivityCompliance({
    company,
    atividadeIds: ['act-altura'],
    colaboradorIds: [employee.id],
    activityProfiles,
    requirements: activityDocumentRequirements,
    employees: [employee],
    documents: [
      {
        id: 'd-pgr-ok',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        nomeDocumento: 'PGR 2026',
        tipoDocumentoCanonico: 'PGR',
        categoria: 'PGR',
        dataEmissao: addDaysIso(-5),
        dataValidade: addDaysIso(300),
        responsavelEnvio: 'Admin',
        arquivoUrl: 'ehs-direct://integrations/comp-oficial/pgr-ok.pdf',
        arquivoNome: 'pgr-ok.pdf',
        versao: 1,
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'e-aso-ok',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        colaboradorId: employee.id,
        colaboradorNome: employee.nomeCompleto,
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['trabalho_altura'],
        dataRealizacao: addDaysIso(-5),
        dataValidade: addDaysIso(300),
        conclusao: 'apto',
        observacoes: 'Apto para Trabalho em Altura (NR-35)',
        situacao: 'aprovado',
      },
    ],
    trainings: [
      {
        id: 't-nr35-ok',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        colaboradorId: employee.id,
        colaboradorNome: employee.nomeCompleto,
        nomeTreinamento: 'NR-35 Trabalho em Altura',
        tipoDocumentoCanonico: 'NR-35',
        cargaHoraria: '8h',
        dataRealizacao: addDaysIso(-5),
        dataValidade: addDaysIso(300),
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [],
    safetyPermits: [],
    smartDocs: [],
  });

  assert.equal(evalApproved.resumo.conformes, 3);
  assert.equal(evalApproved.podeLiberar, true);
  assert.equal(evalApproved.resumo.bloqueiosObrigatorios, 0);
});

test('Teste 7 — Controle de vencimentos: 5 marcos obrigatorios (30d, 15d, 7d, hoje, vencido) e deduplicacao', async () => {
  // Validar classificacao dos 5 marcos
  assert.equal(identifyExtendedExpirationMilestone(30), '30_dias');
  assert.equal(identifyExtendedExpirationMilestone(15), '15_dias');
  assert.equal(identifyExtendedExpirationMilestone(7), '7_dias');
  assert.equal(identifyExtendedExpirationMilestone(0), 'hoje');
  assert.equal(identifyExtendedExpirationMilestone(-3), 'vencido');

  const company: Company = {
    id: 'comp-venc',
    razaoSocial: 'Vencimentos Teste Ltda',
    nomeFantasia: 'Vencimentos Teste',
    cnpj: '77.888.999/0001-11',
    responsavelLegal: 'Resp',
    responsavelSST: 'SST',
    telefone: '11999990000',
    email: 'v@v.com',
    endereco: 'Rua A',
    unidadeAtendimento: 'Planta 1',
    atividadeContratada: 'Altura',
    dataInicioContrato: '2026-01-01',
    dataTerminoContrato: '2027-01-01',
    contrato_indeterminado: false,
    situacao: 'ativa',
  };

  const notifRepo = createInMemoryInAppNotificationRepository({
    companies: [company],
    documents: [
      {
        id: 'doc-30d',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        nomeDocumento: 'PGR 30 dias',
        categoria: 'PGR',
        dataEmissao: addDaysIso(-335),
        dataValidade: addDaysIso(30),
        responsavelEnvio: 'Admin',
        arquivoUrl: 'ehs-direct://integrations/comp-venc/pgr.pdf',
        arquivoNome: 'pgr.pdf',
        versao: 1,
        situacao: 'aprovado',
      },
      {
        id: 'doc-15d',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        nomeDocumento: 'PCMSO 15 dias',
        categoria: 'PCMSO',
        dataEmissao: addDaysIso(-350),
        dataValidade: addDaysIso(15),
        responsavelEnvio: 'Admin',
        arquivoUrl: 'ehs-direct://integrations/comp-venc/pcmso.pdf',
        arquivoNome: 'pcmso.pdf',
        versao: 1,
        situacao: 'aprovado',
      },
      {
        id: 'doc-hoje',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        nomeDocumento: 'ART Hoje',
        categoria: 'Outros',
        dataEmissao: addDaysIso(-365),
        dataValidade: addDaysIso(0),
        responsavelEnvio: 'Admin',
        arquivoUrl: 'ehs-direct://integrations/comp-venc/art.pdf',
        arquivoNome: 'art.pdf',
        versao: 1,
        situacao: 'aprovado',
      },
    ],
    trainings: [
      {
        id: 'trn-7d',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        colaboradorId: 'emp-1',
        colaboradorNome: 'Colaborador 1',
        nomeTreinamento: 'NR-35 7 dias',
        cargaHoraria: '8h',
        dataRealizacao: addDaysIso(-723),
        dataValidade: addDaysIso(7),
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'exam-venc',
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        colaboradorId: 'emp-1',
        colaboradorNome: 'Colaborador 1',
        tipoExame: 'Periodico',
        dataRealizacao: addDaysIso(-370),
        dataValidade: addDaysIso(-4),
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
  });

  const notifService = new InAppNotificationService(notifRepo);
  const run1 = await notifService.syncExpirationNotifications();
  assert.equal(run1.createdCount, 10, '5 itens nos 5 marcos devem gerar 5 alertas Admin + 5 alertas Solicitante');

  const run2 = await notifService.syncExpirationNotifications();
  assert.equal(run2.createdCount, 0, 'Execucao repetida no mesmo dia deve ser 100% idempotente');
});

test('Teste 8 — Seguranca e RBAC: isolamento multiempresa (Solicitante B 403) e Auditor estritamente somente leitura (403 em escritas, 200 em leitura)', async () => {
  const h = await createHarness();
  try {
    // Solicitante A registra empresa, colaborador, documento e integracao
    const compRes = await httpRequest(h.baseUrl, 'POST', '/api/companies/register', {
      token: h.tokens.solA,
      body: { razaoSocial: 'Empresa Isolada A Ltda', cnpj: '88.999.111/0001-22' },
    });
    const compAId = compRes.json.company.id;

    const empRes = await httpRequest(h.baseUrl, 'POST', '/api/employees/register', {
      token: h.tokens.solA,
      body: {
        empresaId: compAId,
        nomeCompleto: 'Funcionario Secreto A',
        cpf: '111.222.333-44',
        cargo: 'Tecnico',
      },
    });
    const empAId = empRes.json.employee.id;

    const docRes = await httpRequest(h.baseUrl, 'POST', '/api/direct-documents/upload', {
      token: h.tokens.solA,
      body: {
        kind: 'documento',
        empresaId: compAId,
        nomeDocumento: 'PGR Confidencial A',
        arquivoNome: 'pgr-a.pdf',
        arquivoBase64: PDF_V1_DATA_URL,
      },
    });
    const storageKeyA = docRes.json.storageKey;

    const intRes = await httpRequest(h.baseUrl, 'POST', '/api/integrations', {
      token: h.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: compAId,
        atividadeIds: ['act-altura'],
        colaboradorIds: [empAId],
      },
    });
    const intAId = intRes.json.integration.id;

    // --- SOLICITANTE B tentando invadir Empresa A (todos devem retornar 403) ---
    assert.equal(
      (
        await httpRequest(h.baseUrl, 'POST', '/api/employees/register', {
          token: h.tokens.solB,
          body: {
            empresaId: compAId,
            nomeCompleto: 'Invasor B',
            cpf: '999.888.777-66',
            cargo: 'Invasor',
          },
        })
      ).status,
      403
    );

    assert.equal(
      (
        await httpRequest(h.baseUrl, 'POST', '/api/direct-documents/upload', {
          token: h.tokens.solB,
          body: {
            kind: 'documento',
            empresaId: compAId,
            nomeDocumento: 'Doc Invasor',
            arquivoNome: 'inv.pdf',
            arquivoBase64: PDF_V1_DATA_URL,
          },
        })
      ).status,
      403
    );

    assert.equal(
      (
        await httpRequest(
          h.baseUrl,
          'GET',
          `/api/direct-documents/file?key=${encodeURIComponent(storageKeyA)}`,
          { token: h.tokens.solB }
        )
      ).status,
      403,
      'Solicitante B NAO pode baixar arquivo da Empresa A'
    );

    assert.equal(
      (
        await httpRequest(h.baseUrl, 'GET', `/api/integrations/${intAId}`, {
          token: h.tokens.solB,
        })
      ).status,
      403
    );

    assert.equal(
      (
        await httpRequest(h.baseUrl, 'POST', '/api/integrations', {
          token: h.tokens.solB,
          body: {
            tipo: 'INTEGRACAO_INICIAL',
            empresaId: compAId,
            atividadeIds: ['act-altura'],
            colaboradorIds: [empAId],
          },
        })
      ).status,
      403
    );

    // --- AUDITOR: 403 em TODAS as rotas de escrita, 200 em leitura ---
    assert.equal(
      (
        await httpRequest(h.baseUrl, 'POST', '/api/companies/register', {
          token: h.tokens.auditor,
          body: { razaoSocial: 'Auditor Empresa', cnpj: '99.111.222/0001-33' },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await httpRequest(h.baseUrl, 'POST', '/api/employees/register', {
          token: h.tokens.auditor,
          body: {
            empresaId: compAId,
            nomeCompleto: 'Auditor Emp',
            cpf: '222.333.444-55',
            cargo: 'Auditor',
          },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await httpRequest(h.baseUrl, 'POST', '/api/direct-documents/upload', {
          token: h.tokens.auditor,
          body: {
            kind: 'documento',
            empresaId: compAId,
            nomeDocumento: 'Auditor Doc',
            arquivoNome: 'a.pdf',
            arquivoBase64: PDF_V1_DATA_URL,
          },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await httpRequest(h.baseUrl, 'POST', '/api/integrations', {
          token: h.tokens.auditor,
          body: {
            tipo: 'INTEGRACAO_INICIAL',
            empresaId: compAId,
            atividadeIds: ['act-altura'],
            colaboradorIds: [empAId],
          },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await httpRequest(h.baseUrl, 'PUT', `/api/companies/${compAId}/links`, {
          token: h.tokens.auditor,
          body: { solicitanteUserIds: ['sol-a-1'] },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await httpRequest(h.baseUrl, 'POST', '/api/in-app-notifications/broadcast', {
          token: h.tokens.auditor,
          body: {
            title: 'Teste',
            message: 'Auditor nao envia comunicado',
            targetScope: 'all_solicitantes',
          },
        })
      ).status,
      403
    );

    // Auditor MANTEM acesso de leitura (200)
    assert.equal(
      (
        await httpRequest(h.baseUrl, 'GET', `/api/integrations/${intAId}`, {
          token: h.tokens.auditor,
        })
      ).status,
      200
    );
    assert.equal(
      (
        await httpRequest(
          h.baseUrl,
          'GET',
          `/api/direct-documents/file?key=${encodeURIComponent(storageKeyA)}`,
          { token: h.tokens.auditor }
        )
      ).status,
      200
    );
  } finally {
    await h.close();
  }
});

test('Teste 9 — Persistencia completa apos reinicio dos servicos e nova sessao', async () => {
  const h1 = await createHarness();
  let savedCompanyId = '';
  let savedEmpId = '';
  let savedStorageKey = '';
  let savedIntegrationId = '';

  try {
    // 1. Criar dados na instancia 1
    const c = await httpRequest(h1.baseUrl, 'POST', '/api/companies/register', {
      token: h1.tokens.solA,
      body: {
        razaoSocial: 'Persistencia Total Engenharia Ltda',
        cnpj: '12.345.678/0001-90',
        atividadesAutorizadasIds: ['act-altura'],
      },
    });
    savedCompanyId = c.json.company.id;

    const e = await httpRequest(h1.baseUrl, 'POST', '/api/employees/register', {
      token: h1.tokens.solA,
      body: {
        empresaId: savedCompanyId,
        nomeCompleto: 'Roberto Persistente',
        cpf: '321.654.987-00',
        cargo: 'Eletricista',
      },
    });
    savedEmpId = e.json.employee.id;

    const d = await httpRequest(h1.baseUrl, 'POST', '/api/direct-documents/upload', {
      token: h1.tokens.solA,
      body: {
        kind: 'documento',
        empresaId: savedCompanyId,
        nomeDocumento: 'PGR Persistente',
        arquivoNome: 'pgr-persist.pdf',
        arquivoBase64: PDF_V1_DATA_URL,
      },
    });
    savedStorageKey = d.json.storageKey;

    const integ = await httpRequest(h1.baseUrl, 'POST', '/api/integrations', {
      token: h1.tokens.solA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: savedCompanyId,
        atividadeIds: ['act-altura'],
        colaboradorIds: [savedEmpId],
      },
    });
    savedIntegrationId = integ.json.integration.id;

    // Marcar notificacao como lida
    const notifList = await httpRequest(h1.baseUrl, 'GET', '/api/in-app-notifications', {
      token: h1.tokens.solA,
    });
    assert.ok(notifList.json.notifications.length > 0);
    const firstNotifId = notifList.json.notifications[0].id;
    const markRead = await httpRequest(
      h1.baseUrl,
      'POST',
      `/api/in-app-notifications/${firstNotifId}/read`,
      { token: h1.tokens.solA }
    );
    assert.equal(markRead.status, 200);
  } finally {
    await h1.close();
  }

  // 2. Reiniciar servicos e servidor HTTP reutilizando os mesmos repositorios/storage persistidos
  const h2 = await createHarness({
    companies: h1.thirdPartyRepo.state.companies,
    employees: h1.thirdPartyRepo.state.employees,
    documents: h1.thirdPartyRepo.state.documents,
    exams: h1.thirdPartyRepo.state.exams,
    trainings: h1.thirdPartyRepo.state.trainings,
    users: h1.thirdPartyRepo.state.userProfiles as Array<UserProfile & { cpf: string }>,
    fileStorage: h1.fileStorage,
    integrationRepo: h1.integrationRepo,
    notifRepo: h1.notifRepo,
  });

  try {
    // Nova sessao do Solicitante A
    const solA2 = h2.thirdPartyRepo.state.userProfiles[1];
    const freshToken = signAuthToken({ ...solA2, cpf: solA2.cpf || '11111111111' }).token;
    const me = await httpRequest(h2.baseUrl, 'GET', '/api/auth/me', { token: freshToken });
    assert.equal(me.status, 200);
    assert.ok(me.json.user.empresaIds.includes(savedCompanyId), 'Vinculo empresa-solicitante persistido');

    // Arquivo continua disponivel com integridade binaria
    const fileRes = await httpRequest(
      h2.baseUrl,
      'GET',
      `/api/direct-documents/file?key=${encodeURIComponent(savedStorageKey)}`,
      { token: freshToken }
    );
    assert.equal(fileRes.status, 200);
    assert.equal(Buffer.compare(fileRes.rawBuffer, PDF_V1_BYTES), 0);

    // Integracao e itens permanecem intactos
    const integAfter = await httpRequest(
      h2.baseUrl,
      'GET',
      `/api/integrations/${savedIntegrationId}`,
      { token: freshToken }
    );
    assert.equal(integAfter.status, 200);
    assert.equal(integAfter.json.integration.empresaId, savedCompanyId);
    assert.equal(integAfter.json.items.length, 3);

    // Notificacao marcada como lida permanece lida
    const notifsAfter = await httpRequest(h2.baseUrl, 'GET', '/api/in-app-notifications', {
      token: freshToken,
    });
    assert.equal(notifsAfter.status, 200);
    assert.ok(
      notifsAfter.json.notifications.some((n: any) => n.readByCurrentUser === true || n.read === true),
      'Estado de leitura das notificacoes deve persistir'
    );
  } finally {
    await h2.close();
  }
});
