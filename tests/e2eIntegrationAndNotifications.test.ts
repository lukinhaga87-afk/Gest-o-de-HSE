import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  IntegrationWorkflowActor,
  IntegrationWorkflowService,
  createInMemoryIntegrationRepository,
} from '../backend/integrationWorkflowService';
import {
  InAppNotificationService,
  createInMemoryInAppNotificationRepository,
  identifyExtendedExpirationMilestone,
} from '../backend/inAppNotificationService';
import { identifyMilestone } from '../backend/notificationEngine';
import { createApiApp } from '../backend/app';
import { signAuthToken } from '../backend/authMiddleware';
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

const SAMPLE_PDF_V1 =
  'data:application/pdf;base64,' +
  Buffer.from('%PDF-1.4\n%EHS More E2E Document V1\n%%EOF').toString('base64');
const SAMPLE_PDF_V2 =
  'data:application/pdf;base64,' +
  Buffer.from('%PDF-1.4\n%EHS More E2E Document V2 (Corrigido)\n%%EOF').toString('base64');

const ADMIN: IntegrationWorkflowActor = {
  id: 'admin-ehs-1',
  nome: 'Lucas Administrador EHS',
  email: 'admin@ehsmore.com',
  role: 'admin',
};

const SOLICITANTE_A: IntegrationWorkflowActor = {
  id: 'sol-alfa-1',
  nome: 'Maria Solicitante Alfa',
  email: 'maria@alfa.com',
  role: 'solicitante',
  empresaId: 'comp-alfa',
};

const SOLICITANTE_B: IntegrationWorkflowActor = {
  id: 'sol-beta-1',
  nome: 'Joao Solicitante Beta',
  email: 'joao@beta.com',
  role: 'solicitante',
  empresaId: 'comp-beta',
};

const AUDITOR: IntegrationWorkflowActor = {
  id: 'auditor-1',
  nome: 'Clara Auditora',
  email: 'clara@auditoria.com',
  role: 'auditor',
};

function buildSeed() {
  const companies: Company[] = [
    {
      id: 'comp-alfa',
      razaoSocial: 'Alfa Engenharia e Manutencao Ltda',
      nomeFantasia: 'Alfa Engenharia',
      cnpj: '11.222.333/0001-44',
      responsavelLegal: 'Roberto Alfa',
      responsavelSST: 'Eng. Paula Alfa',
      telefone: '11999991111',
      email: 'contato@alfa.com',
      endereco: 'Av. Industrial, 100',
      unidadeAtendimento: 'Planta SP',
      atividadeContratada: 'Trabalho em Altura',
      dataInicioContrato: '2025-01-01',
      dataTerminoContrato: '2027-12-31',
      contrato_indeterminado: false,
      situacao: 'ativa',
    },
    {
      id: 'comp-beta',
      razaoSocial: 'Beta Montagens Industriais S.A.',
      nomeFantasia: 'Beta Montagens',
      cnpj: '55.666.777/0001-88',
      responsavelLegal: 'Carlos Beta',
      responsavelSST: 'Eng. Marina Beta',
      telefone: '11999992222',
      email: 'contato@beta.com',
      endereco: 'Rua Tecnica, 200',
      unidadeAtendimento: 'Planta RJ',
      atividadeContratada: 'Eletrica',
      dataInicioContrato: '2025-01-01',
      dataTerminoContrato: '2027-12-31',
      contrato_indeterminado: false,
      situacao: 'ativa',
    },
  ];

  const employees: Employee[] = [
    {
      id: 'emp-alfa-1',
      empresaId: 'comp-alfa',
      empresaNome: 'Alfa Engenharia e Manutencao Ltda',
      nomeCompleto: 'Pedro Henrique Costa',
      cpf: '123.456.789-01',
      cargo: 'Montador Industrial',
      setor: 'Manutencao',
      telefone: '11988887777',
      email: 'pedro@alfa.com',
      atividadeExecutada: 'Trabalho em Altura',
      dataAdmissao: '2025-01-10',
      situacaoCadastral: 'ativo',
    },
  ];

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
      criadoPorId: ADMIN.id,
      criadoPorNome: ADMIN.nome,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
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
      criadoPorId: ADMIN.id,
      criadoPorNome: ADMIN.nome,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'req-aso',
      activityId: 'act-altura',
      escopo: 'colaborador',
      origemColecao: 'exams',
      documentoCodigoCanonico: 'ASO',
      nomeExibicao: 'ASO (Atestado de Saude Ocupacional)',
      palavrasChaveMatch: ['aso'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: true,
      aptidaoEspecifica: 'Trabalho em Altura',
      baseLegal: 'NR-07',
      ordemExibicao: 2,
      ativo: true,
      criadoPorId: ADMIN.id,
      criadoPorNome: ADMIN.nome,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'req-nr35',
      activityId: 'act-altura',
      escopo: 'colaborador',
      origemColecao: 'trainings',
      documentoCodigoCanonico: 'NR35',
      nomeExibicao: 'Certificado NR-35',
      palavrasChaveMatch: ['nr-35', 'nr35'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: false,
      baseLegal: 'NR-35',
      ordemExibicao: 3,
      ativo: true,
      criadoPorId: ADMIN.id,
      criadoPorNome: ADMIN.nome,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
  ];

  return { companies, employees, activityProfiles, activityDocumentRequirements };
}

function addDaysIso(daysFromToday: number): string {
  const dt = new Date();
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCDate(dt.getUTCDate() + daysFromToday);
  return dt.toISOString().slice(0, 10);
}

async function httpRequest(
  baseUrl: string,
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown }
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = opts?.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(opts?.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode || 0, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('Testes 1, 2, 3, 4 e 6 — Ciclo Completo Solicitante -> Reprovacao ADM -> Notificacao -> Correcao v2 -> Reenvio -> Aprovacao Integral -> Persistencia', async () => {
  const seed = buildSeed();
  const repo = createInMemoryIntegrationRepository(seed);
  const notifRepo = createInMemoryInAppNotificationRepository({ companies: seed.companies });
  const notifService = new InAppNotificationService(notifRepo);
  const service = new IntegrationWorkflowService({
    repo,
    notificationService: notifService,
    nowProvider: () => new Date('2026-06-15T12:00:00.000Z'),
  });

  // -------------------------------------------------------------------------
  // TESTE 1 — SOLICITANTE: Empresa + Colaboradores + Atividade + Lista + Upload + Envio
  // -------------------------------------------------------------------------
  const created = await service.createIntegration(SOLICITANTE_A, {
    tipo: 'INTEGRACAO_INICIAL',
    empresaId: 'comp-alfa',
    atividadeIds: ['act-altura'],
    colaboradorIds: ['emp-alfa-1'],
    observacoes: 'Equipe de manutencao em altura',
  });

  assert.equal(created.integration.status, 'RASCUNHO');
  const empresaItems = created.items.filter((i) => i.categoria === 'empresa');
  const colaboradorItems = created.items.filter((i) => i.categoria === 'colaborador');
  assert.ok(empresaItems.length >= 1, 'Deve gerar lista documental empresarial');
  assert.ok(colaboradorItems.length >= 2, 'Deve gerar lista documental individual (ASO + NR-35)');

  // Submissao antes de 100% obrigatorios deve ser bloqueada
  await assert.rejects(
    () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
    (err: any) => err?.statusCode === 422 && err?.code === 'MANDATORY_DOCUMENTS_INCOMPLETE'
  );

  // Enviar todos os documentos obrigatorios
  for (const item of created.items.filter((i) => i.obrigatorio)) {
    await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
      itemId: item.id,
      arquivoNome: `${item.documentoCodigoCanonico}_v1.pdf`,
      arquivoBase64: SAMPLE_PDF_V1,
      dataEmissao: '2026-06-01',
      dataValidade: '2027-06-01',
      conclusaoAso: 'apto',
      runSmartDocsAi: false,
    });
  }

  const submitted = await service.submitIntegration(SOLICITANTE_A, created.integration.id);
  assert.equal(submitted.integration.status, 'AGUARDANDO_ANALISE');

  // Verificar notificacoes automaticas apos envio
  const adminNotifsAfterSubmit = await notifService.listForActor(ADMIN);
  assert.ok(
    adminNotifsAfterSubmit.notifications.some(
      (n) =>
        n.type === 'INTEGRACAO_ENVIADA' &&
        n.integrationId === created.integration.id &&
        !n.readByCurrentUser
    ),
    'ADM deve receber notificacao de nova integracao enviada'
  );

  const solNotifsAfterSubmit = await notifService.listForActor(SOLICITANTE_A);
  assert.ok(
    solNotifsAfterSubmit.notifications.some(
      (n) => n.type === 'INTEGRACAO_ENVIADA' && n.integrationId === created.integration.id
    ),
    'Solicitante deve receber confirmacao de integracao recebida'
  );

  // -------------------------------------------------------------------------
  // TESTE 2 — ADMINISTRADOR EHS: Reprovacao com justificativa obrigatoria + doc especifico
  // -------------------------------------------------------------------------
  const asoItem = submitted.items.find((i) => i.documentoCodigoCanonico === 'ASO');
  assert.ok(asoItem, 'Item ASO deve existir na integracao');

  // Reprovar sem justificativa deve falhar (400)
  await assert.rejects(
    () =>
      service.rejectIntegration(ADMIN, created.integration.id, {
        justificativa: '   ',
      }),
    (err: any) => err?.statusCode === 400 && err?.code === 'JUSTIFICATION_REQUIRED'
  );

  const rejected = await service.rejectIntegration(ADMIN, created.integration.id, {
    justificativa: 'ASO enviado esta sem assinatura do medico coordenador.',
    rejectedItemIds: [asoItem!.id],
    itemReasons: {
      [asoItem!.id]: 'Enviar ASO assinado e carimbado.',
    },
  });

  assert.equal(rejected.integration.status, 'REPROVADA');
  assert.equal(
    rejected.integration.motivoReprovacaoOuDevolucao,
    'ASO enviado esta sem assinatura do medico coordenador.'
  );
  const rejectedAso = rejected.items.find((i) => i.id === asoItem!.id);
  assert.equal(rejectedAso?.status, 'REPROVADO');
  assert.equal(rejectedAso?.versaoAtual, 1);

  // -------------------------------------------------------------------------
  // TESTE 3 — RETORNO DO SOLICITANTE: Notificacao + Leitura + Correcao v2 + Reenvio
  // -------------------------------------------------------------------------
  const solNotifsAfterReject = await notifService.listForActor(SOLICITANTE_A);
  const rejectNotif = solNotifsAfterReject.notifications.find(
    (n) => n.type === 'INTEGRACAO_REPROVADA' && n.integrationId === created.integration.id
  );
  assert.ok(rejectNotif, 'Solicitante deve receber notificacao de integracao reprovada');
  assert.equal(rejectNotif!.readByCurrentUser, false);

  // Marcar notificacao como lida
  await notifService.markAsRead(SOLICITANTE_A, rejectNotif!.id);
  const solNotifsAfterRead = await notifService.listForActor(SOLICITANTE_A);
  assert.equal(
    solNotifsAfterRead.notifications.find((n) => n.id === rejectNotif!.id)?.readByCurrentUser,
    true,
    'Notificacao marcada como lida deve persistir como lida'
  );

  // Corrigir o ASO (preservando versao 1 e criando versao 2)
  const correctedUpload = await service.uploadSingleDocument(
    SOLICITANTE_A,
    created.integration.id,
    {
      itemId: asoItem!.id,
      arquivoNome: 'ASO_assinado_v2.pdf',
      arquivoBase64: SAMPLE_PDF_V2,
      dataEmissao: '2026-06-14',
      dataValidade: '2027-06-14',
      conclusaoAso: 'apto',
      runSmartDocsAi: false,
    }
  );
  assert.equal(correctedUpload.item.versaoAtual, 2, 'Versao do documento corrigido deve ser v2');
  assert.equal(
    correctedUpload.item.versoes.length,
    2,
    'Versao anterior (v1) deve ser preservada no historico de versoes'
  );
  assert.equal(correctedUpload.item.versoes[0].versao, 1);
  assert.equal(correctedUpload.item.versoes[1].versao, 2);

  // Reenviar pacote corrigido
  const resubmitted = await service.submitIntegration(SOLICITANTE_A, created.integration.id);
  assert.equal(resubmitted.integration.status, 'REENVIADA');

  // -------------------------------------------------------------------------
  // TESTE 4 — APROVACAO INTEGRAL PELO ADM + NOTIFICACAO + HISTORICO COMPLETO
  // -------------------------------------------------------------------------
  const adminNotifsAfterResubmit = await notifService.listForActor(ADMIN);
  assert.ok(
    adminNotifsAfterResubmit.notifications.some(
      (n) => n.type === 'DOCUMENTO_CORRIGIDO' && n.integrationId === created.integration.id
    ),
    'ADM deve receber notificacao de documento corrigido'
  );
  assert.ok(
    adminNotifsAfterResubmit.notifications.some(
      (n) => n.type === 'INTEGRACAO_REENVIADA' && n.integrationId === created.integration.id
    ),
    'ADM deve receber notificacao de pacote reenviado'
  );

  // ADM aprova integralmente o pacote sem precisar aprovar item por item
  const approved = await service.approveIntegration(ADMIN, created.integration.id, {
    justificativa: 'Pacote completo conferido e aprovado integralmente.',
    approveWholePackage: true,
  });

  assert.equal(approved.integration.status, 'APROVADA');
  assert.ok(
    approved.items.filter((i) => i.obrigatorio).every((i) => i.status === 'APROVADO'),
    'Todos os itens obrigatorios devem estar APROVADO apos aprovacao integral'
  );
  assert.ok(repo.state.documents.length >= 1, 'PGR aprovado deve ser oficializado em documents');
  assert.ok(repo.state.exams.length >= 1, 'ASO aprovado deve ser oficializado em exams');
  assert.ok(repo.state.trainings.length >= 1, 'NR-35 aprovada deve ser oficializada em trainings');
  assert.ok(
    approved.integration.historicoWorkflow.length >= 5,
    'Trilha de auditoria deve registrar todo o historico (criacao, envios, reprovacao, reenvio, aprovacao)'
  );

  const solNotifsAfterApprove = await notifService.listForActor(SOLICITANTE_A);
  assert.ok(
    solNotifsAfterApprove.notifications.some(
      (n) => n.type === 'INTEGRACAO_APROVADA' && n.integrationId === created.integration.id
    ),
    'Solicitante deve receber notificacao de integracao aprovada'
  );

  // -------------------------------------------------------------------------
  // TESTE 6 — PERSISTENCIA (REINSTANCIACAO / RECARREGAMENTO DE SERVICOS)
  // -------------------------------------------------------------------------
  const reloadedIntegrationService = new IntegrationWorkflowService({
    repo,
    notificationService: notifService,
    nowProvider: () => new Date('2026-06-15T12:05:00.000Z'),
  });
  const reloadedNotifService = new InAppNotificationService(notifRepo);

  const persistedDetail = await reloadedIntegrationService.getIntegrationDetail(
    SOLICITANTE_A,
    created.integration.id
  );
  assert.equal(persistedDetail.integration.status, 'APROVADA');
  const persistedAso = persistedDetail.items.find((i) => i.id === asoItem!.id);
  assert.equal(persistedAso?.versaoAtual, 2);
  assert.equal(persistedAso?.versoes.length, 2);

  const persistedSolNotifs = await reloadedNotifService.listForActor(SOLICITANTE_A);
  assert.equal(
    persistedSolNotifs.notifications.find((n) => n.id === rejectNotif!.id)?.readByCurrentUser,
    true,
    'Estado de leitura deve permanecer persistido apos recarregamento'
  );
});

test('Teste 4B — 5 Marcos de Vencimento (30d, 15d, 7d, hoje, vencido) + Deduplicacao + Comunicados Direcionados ADM', async () => {
  assert.equal(identifyMilestone(30), '30_dias');
  assert.equal(identifyMilestone(15), '15_dias');
  assert.equal(identifyMilestone(7), '7_dias');
  assert.equal(identifyMilestone(0), 'hoje');
  assert.equal(identifyMilestone(-3), 'vencido');
  assert.equal(identifyMilestone(22), null);

  assert.equal(identifyExtendedExpirationMilestone(30), '30_dias');
  assert.equal(identifyExtendedExpirationMilestone(15), '15_dias');
  assert.equal(identifyExtendedExpirationMilestone(7), '7_dias');
  assert.equal(identifyExtendedExpirationMilestone(0), 'hoje');
  assert.equal(identifyExtendedExpirationMilestone(-2), 'vencido');

  const seed = buildSeed();
  const docs: DocumentSST[] = [
    {
      id: 'doc-30d',
      tipoDocumentoCanonico: 'PGR',
      categoria: 'Documento Empresarial',
      nomeDocumento: 'PGR 30 dias',
      empresaId: 'comp-alfa',
      empresaNome: 'Alfa Engenharia',
      dataEmissao: addDaysIso(-335),
      dataValidade: addDaysIso(30),
      responsavelEnvio: 'Maria Solicitante Alfa',
      arquivoUrl: 'https://example.test/pgr.pdf',
      arquivoNome: 'pgr.pdf',
      situacao: 'aprovado',
      versao: 1,
    },
  ];
  const trainings: Training[] = [
    {
      id: 'trn-7d',
      colaboradorId: 'emp-alfa-1',
      colaboradorNome: 'Pedro Henrique Costa',
      empresaId: 'comp-alfa',
      empresaNome: 'Alfa Engenharia',
      nomeTreinamento: 'NR-35 7 dias',
      tipoDocumentoCanonico: 'NR-35',
      cargaHoraria: '8h',
      dataRealizacao: addDaysIso(-723),
      dataValidade: addDaysIso(7),
      situacao: 'aprovado',
    },
  ];
  const exams: OccupationalExam[] = [
    {
      id: 'exam-vencido',
      colaboradorId: 'emp-alfa-1',
      colaboradorNome: 'Pedro Henrique Costa',
      empresaId: 'comp-alfa',
      empresaNome: 'Alfa Engenharia',
      tipoExame: 'Periodico',
      dataRealizacao: addDaysIso(-370),
      dataValidade: addDaysIso(-5),
      conclusao: 'apto',
      situacao: 'aprovado',
    },
  ];

  const notifRepo = createInMemoryInAppNotificationRepository({
    companies: seed.companies,
    documents: docs,
    trainings,
    exams,
  });
  const notifService = new InAppNotificationService(notifRepo);

  const run1 = await notifService.syncExpirationNotifications();
  assert.equal(
    run1.createdCount,
    6,
    '3 itens vencendo/vencidos devem gerar 3 alertas Solicitante + 3 alertas ADM'
  );

  // Segunda execucao nao deve duplicar alertas
  const run2 = await notifService.syncExpirationNotifications();
  assert.equal(run2.createdCount, 0, 'Execucao repetida nao deve criar duplicatas');

  // Comunicado direcionado para 1 empresa (comp-alfa) nao deve vazar para comp-beta
  await notifService.sendAdminAnnouncement(ADMIN, {
    title: 'Reciclagem NR-35 obrigatoria',
    message: 'Favor atualizar certificados NR-35 ate sexta-feira.',
    severity: 'warning',
    targetScope: 'single_company',
    empresaIds: ['comp-alfa'],
  });

  const alfaNotifs = await notifService.listForActor(SOLICITANTE_A);
  const betaNotifs = await notifService.listForActor(SOLICITANTE_B);

  assert.ok(alfaNotifs.notifications.some((n) => n.type === 'COMUNICADO_ADM'));
  assert.equal(
    betaNotifs.notifications.some((n) => n.type === 'COMUNICADO_ADM'),
    false,
    'Empresa Beta NAO pode visualizar comunicado direcionado exclusivamente para Empresa Alfa'
  );
});

test('Teste 5 — Seguranca, Isolamento Multiempresa, Bloqueio de Autoaprovacao e Nao Autenticado (HTTP API)', async () => {
  process.env.API_AUTH_SECRET = 'test-ehs-more-e2e-secret-32-chars-minimum!';

  const seed = buildSeed();
  const repo = createInMemoryIntegrationRepository(seed);
  const notifRepo = createInMemoryInAppNotificationRepository({ companies: seed.companies });
  const notifService = new InAppNotificationService(notifRepo);
  const integrationService = new IntegrationWorkflowService({
    repo,
    notificationService: notifService,
  });

  const users: Array<UserProfile & { cpf: string }> = [
    {
      id: ADMIN.id,
      nome: ADMIN.nome,
      cpf: '00000000001',
      username: '00000000001',
      email: ADMIN.email,
      role: 'admin',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: SOLICITANTE_A.id,
      nome: SOLICITANTE_A.nome,
      cpf: '11111111111',
      username: '11111111111',
      email: SOLICITANTE_A.email,
      role: 'solicitante',
      empresaId: 'comp-alfa',
      empresaNome: 'Alfa Engenharia',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: SOLICITANTE_B.id,
      nome: SOLICITANTE_B.nome,
      cpf: '22222222222',
      username: '22222222222',
      email: SOLICITANTE_B.email,
      role: 'solicitante',
      empresaId: 'comp-beta',
      empresaNome: 'Beta Montagens',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: AUDITOR.id,
      nome: AUDITOR.nome,
      cpf: '33333333333',
      username: '33333333333',
      email: AUDITOR.email,
      role: 'auditor',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ];

  const app = createApiApp({
    integrationWorkflowService: integrationService,
    inAppNotificationService: notifService,
    authoritativeUserLookup: async (uid) => {
      const found = users.find((u) => u.id === uid);
      return found ? { id: found.id, data: found } : null;
    },
    userProfilesLister: async () => users.map((u) => ({ id: u.id, data: u })),
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const tokenAdmin = signAuthToken(users[0]).token;
    const tokenSolA = signAuthToken(users[1]).token;
    const tokenSolB = signAuthToken(users[2]).token;
    const tokenAuditor = signAuthToken(users[3]).token;

    // 1. Requisicoes sem autenticacao devem retornar 401
    const unauthInt = await httpRequest(baseUrl, 'GET', '/api/integrations');
    assert.equal(unauthInt.status, 401);
    const unauthNotif = await httpRequest(baseUrl, 'GET', '/api/in-app-notifications');
    assert.equal(unauthNotif.status, 401);

    // 2. Solicitante A cria integracao da Alfa
    const createRes = await httpRequest(baseUrl, 'POST', '/api/integrations', {
      token: tokenSolA,
      body: {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: 'comp-alfa',
        atividadeIds: ['act-altura'],
        colaboradorIds: ['emp-alfa-1'],
      },
    });
    assert.equal(createRes.status, 201);
    const integrationId = createRes.json.integration.id;

    // 3. Solicitante B (Beta) NAO pode visualizar integracao da Alfa (403)
    const crossRead = await httpRequest(
      baseUrl,
      'GET',
      `/api/integrations/${encodeURIComponent(integrationId)}`,
      { token: tokenSolB }
    );
    assert.equal(crossRead.status, 403);

    // 4. Solicitante A NAO pode aprovar nem reprovar a propria integracao (403)
    const selfApprove = await httpRequest(
      baseUrl,
      'POST',
      `/api/integrations/${encodeURIComponent(integrationId)}/approve`,
      { token: tokenSolA, body: { approveWholePackage: true } }
    );
    assert.equal(selfApprove.status, 403);

    const selfReject = await httpRequest(
      baseUrl,
      'POST',
      `/api/integrations/${encodeURIComponent(integrationId)}/reject`,
      { token: tokenSolA, body: { justificativa: 'Tentativa indevida' } }
    );
    assert.equal(selfReject.status, 403);

    // 5. Solicitante e Auditor NAO podem enviar comunicado ADM (403)
    const solBroadcast = await httpRequest(baseUrl, 'POST', '/api/in-app-notifications/broadcast', {
      token: tokenSolA,
      body: {
        title: 'Invasao',
        message: 'Tentativa nao autorizada',
        targetScope: 'all_solicitantes',
      },
    });
    assert.equal(solBroadcast.status, 403);

    const audBroadcast = await httpRequest(baseUrl, 'POST', '/api/in-app-notifications/broadcast', {
      token: tokenAuditor,
      body: {
        title: 'Auditoria',
        message: 'Auditor nao escreve',
        targetScope: 'all_solicitantes',
      },
    });
    assert.equal(audBroadcast.status, 403);

    // 6. Admin consegue enviar comunicado direcionado e isolamento impede Beta de ver comunicado da Alfa
    const adminBroadcast = await httpRequest(
      baseUrl,
      'POST',
      '/api/in-app-notifications/broadcast',
      {
        token: tokenAdmin,
        body: {
          title: 'Aviso Exclusivo Alfa',
          message: 'Somente empresa Alfa deve visualizar este comunicado.',
          targetScope: 'single_company',
          empresaIds: ['comp-alfa'],
        },
      }
    );
    assert.equal(adminBroadcast.status, 201);

    const solANotifs = await httpRequest(baseUrl, 'GET', '/api/in-app-notifications', {
      token: tokenSolA,
    });
    const solBNotifs = await httpRequest(baseUrl, 'GET', '/api/in-app-notifications', {
      token: tokenSolB,
    });
    assert.equal(solANotifs.status, 200);
    assert.equal(solBNotifs.status, 200);
    assert.ok(
      solANotifs.json.notifications.some((n: any) => n.title === 'Aviso Exclusivo Alfa')
    );
    assert.equal(
      solBNotifs.json.notifications.some((n: any) => n.title === 'Aviso Exclusivo Alfa'),
      false
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
