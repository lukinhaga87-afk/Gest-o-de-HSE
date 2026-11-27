import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApiApp } from '../backend/app';
import { signAuthToken } from '../backend/authMiddleware';
import { InMemoryIntegrationFileStorage } from '../backend/integrationFileStorage';
import {
  createInMemoryIntegrationRepository,
  IntegrationWorkflowActor,
  IntegrationWorkflowService,
} from '../backend/integrationWorkflowService';
import type {
  ActivityDocumentRequirement,
  ActivityProfile,
  Company,
  UserProfile,
} from '../src/types/sst';
import {
  ALL_STANDARDIZED_STATUSES,
  STANDARDIZED_STATUS_META,
  resolveIntegrationItemStandardizedStatus,
} from '../src/utils/documentStatus';

const WORKSPACE_ROOT = process.cwd();
const VALID_PDF_V1 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Doc V1) >>\nendobj\n%%EOF\n', 'utf8');
const VALID_PDF_V2 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Doc V2 Corrigido) >>\nendobj\n%%EOF\n', 'utf8');
const DATA_URL_V1 = `data:application/pdf;base64,${VALID_PDF_V1.toString('base64')}`;
const DATA_URL_V2 = `data:application/pdf;base64,${VALID_PDF_V2.toString('base64')}`;

const FIXED_NOW = new Date('2026-06-15T12:00:00.000Z');

const ADMIN_PROFILE: UserProfile = {
  id: 'usr-admin',
  nome: 'Administrador EHS Principal',
  email: 'admin@ehs.local',
  cpf: '11111111111',
  username: '11111111111',
  role: 'admin',
  tokenVersion: 1,
};

const SOLICITANTE_A_PROFILE: UserProfile = {
  id: 'usr-sol-a',
  nome: 'Gestor Contratada Alpha',
  email: 'gestor@alpha.local',
  cpf: '22222222222',
  username: '22222222222',
  role: 'solicitante',
  empresaId: 'comp-alpha',
  empresaNome: 'Alpha Montagens Ltda',
  tokenVersion: 1,
};

const SOLICITANTE_B_PROFILE: UserProfile = {
  id: 'usr-sol-b',
  nome: 'Gestor Contratada Beta',
  email: 'gestor@beta.local',
  cpf: '33333333333',
  username: '33333333333',
  role: 'solicitante',
  empresaId: 'comp-beta',
  empresaNome: 'Beta Manutenção Ltda',
  tokenVersion: 1,
};

const AUDITOR_PROFILE: UserProfile = {
  id: 'usr-auditor',
  nome: 'Auditor SST',
  email: 'auditor@ehs.local',
  cpf: '44444444444',
  username: '44444444444',
  role: 'auditor',
  tokenVersion: 1,
};

function createTestHarness() {
  process.env.API_AUTH_SECRET = 'test-secret-mirrored-ehs-more-32-chars-minimum!!';

  const companies: Company[] = [
    {
      id: 'comp-alpha',
      razaoSocial: 'Alpha Montagens Ltda',
      nomeFantasia: 'Alpha Montagens',
      cnpj: '11.222.333/0001-81',
      responsavelLegal: 'Carlos Alpha',
      responsavelSST: 'Ana SST Alpha',
      telefone: '11999990001',
      email: 'contato@alpha.local',
      endereco: 'Rua A, 100',
      unidadeAtendimento: 'Planta 1',
      atividadeContratada: 'Montagem Industrial',
      dataInicioContrato: '2026-01-01',
      dataTerminoContrato: '2027-01-01',
      situacao: 'ativa',
    },
    {
      id: 'comp-beta',
      razaoSocial: 'Beta Manutenção Ltda',
      nomeFantasia: 'Beta Manutenção',
      cnpj: '44.555.666/0001-99',
      responsavelLegal: 'Bruno Beta',
      responsavelSST: 'Paula SST Beta',
      telefone: '11999990002',
      email: 'contato@beta.local',
      endereco: 'Rua B, 200',
      unidadeAtendimento: 'Planta 2',
      atividadeContratada: 'Manutenção Elétrica',
      dataInicioContrato: '2026-01-01',
      dataTerminoContrato: '2027-01-01',
      situacao: 'ativa',
    },
  ];

  const activityProfiles: ActivityProfile[] = [
    {
      id: 'act-nr35',
      codigo: 'TRAB_ALTURA',
      nome: 'Trabalho em Altura',
      descricao: 'Atividades acima de 2 metros',
      nivelRisco: 'alto',
      riscosAssociados: ['Queda de altura'],
      normasAplicaveis: ['NR-35'],
      exigePT: false,
      exigeAPR: false,
      exigeLOTO: false,
      ativo: true,
      criadoPorId: 'usr-admin',
      criadoPorNome: 'Admin',
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    },
  ];

  const activityDocumentRequirements: ActivityDocumentRequirement[] = [
    {
      id: 'req-pgr',
      activityId: 'act-nr35',
      escopo: 'empresa',
      origemColecao: 'documents',
      documentoCodigoCanonico: 'PGR',
      nomeExibicao: 'PGR — Programa de Gerenciamento de Riscos',
      palavrasChaveMatch: ['pgr'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      ativo: true,
      ordemExibicao: 1,
      criadoPorId: 'usr-admin',
      criadoPorNome: 'Admin',
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    },
    {
      id: 'req-aso',
      activityId: 'act-nr35',
      escopo: 'colaborador',
      origemColecao: 'exams',
      documentoCodigoCanonico: 'ASO',
      nomeExibicao: 'ASO — Atestado de Saúde Ocupacional',
      palavrasChaveMatch: ['aso'],
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: true,
      ativo: true,
      ordemExibicao: 2,
      criadoPorId: 'usr-admin',
      criadoPorNome: 'Admin',
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    },
  ];

  const repo = createInMemoryIntegrationRepository({
    companies,
    activityProfiles,
    activityDocumentRequirements,
  });
  const fileStorage = new InMemoryIntegrationFileStorage();
  const service = new IntegrationWorkflowService({
    repo,
    fileStorage,
    nowProvider: () => FIXED_NOW,
  });

  const profilesMap = new Map<string, UserProfile>([
    [ADMIN_PROFILE.id, ADMIN_PROFILE],
    [SOLICITANTE_A_PROFILE.id, SOLICITANTE_A_PROFILE],
    [SOLICITANTE_B_PROFILE.id, SOLICITANTE_B_PROFILE],
    [AUDITOR_PROFILE.id, AUDITOR_PROFILE],
  ]);

  const app = createApiApp({
    integrationWorkflowService: service,
    authoritativeUserLookup: async (userId: string) => {
      const found = profilesMap.get(userId);
      return found ? { id: found.id, data: found } : null;
    },
  });

  const signFor = (p: UserProfile) =>
    signAuthToken({
      id: p.id,
      cpf: p.cpf || p.username || '00000000000',
      email: p.email,
      nome: p.nome,
      role: p.role,
      tokenVersion: p.tokenVersion,
    })!.token;

  const tokens = {
    admin: signFor(ADMIN_PROFILE),
    solA: signFor(SOLICITANTE_A_PROFILE),
    solB: signFor(SOLICITANTE_B_PROFILE),
    auditor: signFor(AUDITOR_PROFILE),
  };

  return { app, repo, service, tokens };
}

async function callJson(
  server: http.Server,
  method: string,
  urlPath: string,
  token: string,
  body?: unknown
): Promise<{ status: number; data: any }> {
  const addr = server.address() as { port: number };
  const resp = await fetch(`http://127.0.0.1:${addr.port}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

test('Etapa 5 — Estrutura simplificada de navegação e padronização dos 8 status obrigatórios', () => {
  const sidebarSrc = fs.readFileSync(
    path.join(WORKSPACE_ROOT, 'src/components/layout/Sidebar.tsx'),
    'utf8'
  );
  const appSrc = fs.readFileSync(path.join(WORKSPACE_ROOT, 'src/App.tsx'), 'utf8');

  // Ensure the 4 removed modules are not exposed in navigation or App routing
  for (const removedKey of ["'epi'", "'apr_pt'", "'inspecoes'", "'planos_acao'"]) {
    assert.equal(sidebarSrc.includes(removedKey), false, `Sidebar não deve conter ${removedKey}`);
    assert.equal(appSrc.includes(removedKey), false, `App.tsx não deve rotear ${removedKey}`);
  }

  // Ensure all required simplified menu labels exist
  for (const requiredLabel of [
    'Painel da Contratada',
    'Minhas Empresas',
    'Meus Colaboradores',
    'Envio de Documentos',
    'Gestão de Integração',
    'Pendências e Vencimentos',
    'Dashboard',
    'Empresas Contratadas',
    'Colaboradores',
    'Central de Análise Documental',
    'Controle de Vencimentos',
    'Usuários e Permissões',
  ]) {
    assert.equal(sidebarSrc.includes(requiredLabel), true, `Sidebar deve conter "${requiredLabel}"`);
  }

  // Verify all 8 standardized statuses and classification logic
  assert.equal(ALL_STANDARDIZED_STATUSES.length, 8);
  assert.equal(STANDARDIZED_STATUS_META.NAO_ENVIADO.label, 'Não enviado');
  assert.equal(STANDARDIZED_STATUS_META.PENDENTE_ENVIO.label, 'Pendente de envio');
  assert.equal(STANDARDIZED_STATUS_META.AGUARDANDO_ANALISE.label, 'Aguardando análise');
  assert.equal(STANDARDIZED_STATUS_META.EM_ANALISE.label, 'Em análise');
  assert.equal(STANDARDIZED_STATUS_META.APROVADO.label, 'Aprovado');
  assert.equal(STANDARDIZED_STATUS_META.REPROVADO.label, 'Reprovado');
  assert.equal(STANDARDIZED_STATUS_META.VENCIDO.label, 'Vencido');
  assert.equal(STANDARDIZED_STATUS_META.PROXIMO_VENCIMENTO.label, 'Próximo do vencimento');

  const refIso = FIXED_NOW.toISOString();
  assert.equal(
    resolveIntegrationItemStandardizedStatus(
      { status: 'PENDENTE_ENVIO', versaoAtual: 0, obrigatorio: true },
      'RASCUNHO',
      refIso
    ),
    'NAO_ENVIADO'
  );
  assert.equal(
    resolveIntegrationItemStandardizedStatus(
      { status: 'PENDENTE_ENVIO', versaoAtual: 0, obrigatorio: true },
      'PENDENTE_DOCUMENTACAO',
      refIso
    ),
    'PENDENTE_ENVIO'
  );
  assert.equal(
    resolveIntegrationItemStandardizedStatus(
      { status: 'ENVIADO', versaoAtual: 1, arquivoNome: 'doc.pdf', hasStoredFile: true, obrigatorio: true },
      'AGUARDANDO_ANALISE',
      refIso
    ),
    'AGUARDANDO_ANALISE'
  );
  assert.equal(
    resolveIntegrationItemStandardizedStatus(
      { status: 'ENVIADO', versaoAtual: 1, arquivoNome: 'doc.pdf', hasStoredFile: true, obrigatorio: true },
      'EM_ANALISE',
      refIso
    ),
    'EM_ANALISE'
  );
  assert.equal(
    resolveIntegrationItemStandardizedStatus(
      { status: 'APROVADO', versaoAtual: 1, dataValidade: '2026-12-31', obrigatorio: true },
      'APROVADA',
      refIso
    ),
    'APROVADO'
  );
  assert.equal(
    resolveIntegrationItemStandardizedStatus(
      { status: 'APROVADO', versaoAtual: 1, dataValidade: '2026-07-05', obrigatorio: true },
      'APROVADA',
      refIso
    ),
    'PROXIMO_VENCIMENTO'
  );
  assert.equal(
    resolveIntegrationItemStandardizedStatus(
      { status: 'APROVADO', versaoAtual: 1, dataValidade: '2026-06-01', obrigatorio: true },
      'APROVADA',
      refIso
    ),
    'VENCIDO'
  );
  assert.equal(
    resolveIntegrationItemStandardizedStatus(
      { status: 'REPROVADO', versaoAtual: 1, obrigatorio: true },
      'PENDENTE_CORRECAO',
      refIso
    ),
    'REPROVADO'
  );
});

test('Etapa 5 — Fluxo espelhado completo (envio, análise, aprovação, reprovação com justificativa, reenvio com histórico, validade, bloqueio final e isolamento)', async () => {
  const { app, tokens } = createTestHarness();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    // 1. Contratada Alpha cria integração com colaborador novo -> gera checklist obrigatório (PGR + ASO)
    const createRes = await callJson(server, 'POST', '/api/integrations', tokens.solA, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-alpha',
      atividadeIds: ['act-nr35'],
      novosColaboradores: [
        {
          nomeCompleto: 'João Técnico Alpha',
          cpf: '55566677788',
          cargo: 'Montador Industrial',
          setor: 'Montagem',
        },
      ],
    });
    assert.equal(createRes.status, 201);
    const integrationId: string = createRes.data.integration.id;
    const pgrItem = createRes.data.items.find((i: any) => i.documentoCodigoCanonico === 'PGR');
    const asoItem = createRes.data.items.find((i: any) => i.documentoCodigoCanonico === 'ASO');
    assert.ok(pgrItem && asoItem, 'Checklist obrigatório deve gerar PGR e ASO');

    // Antes do envio completo, Solicitante vê seus itens pendentes; Admin NÃO vê rascunho
    const solItemsDraft = await callJson(server, 'GET', '/api/integrations/items', tokens.solA);
    assert.equal(solItemsDraft.status, 200);
    assert.equal(solItemsDraft.data.items.length, 2);

    const adminItemsBeforeSubmit = await callJson(server, 'GET', '/api/integrations/items', tokens.admin);
    assert.equal(adminItemsBeforeSubmit.status, 200);
    assert.equal(adminItemsBeforeSubmit.data.items.length, 0);

    // 2. Contratada Alpha anexa todos os obrigatórios e submete
    const up1 = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/documents/upload`,
      tokens.solA,
      {
        itemId: pgrItem.id,
        arquivoNome: 'pgr-alpha-v1.pdf',
        arquivoBase64: DATA_URL_V1,
        dataEmissao: '2026-01-10',
        dataValidade: '2026-12-31',
      }
    );
    assert.equal(up1.status, 200);

    const up2 = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/documents/upload`,
      tokens.solA,
      {
        itemId: asoItem.id,
        arquivoNome: 'aso-joao-v1.pdf',
        arquivoBase64: DATA_URL_V1,
        dataEmissao: '2026-01-15',
        dataValidade: '2026-12-15',
        conclusaoAso: 'apto',
      }
    );
    assert.equal(up2.status, 200);

    const submitRes = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/submit`,
      tokens.solA,
      {}
    );
    assert.equal(submitRes.status, 200);

    // 3. Espelhamento imediato: Admin visualiza ambos os documentos em GET /api/integrations/items
    const adminItemsAfterSubmit = await callJson(server, 'GET', '/api/integrations/items', tokens.admin);
    assert.equal(adminItemsAfterSubmit.status, 200);
    assert.equal(adminItemsAfterSubmit.data.items.length, 2);
    assert.equal(
      adminItemsAfterSubmit.data.items.every((it: any) => it.codigoProtocolo === createRes.data.integration.codigoProtocolo),
      true
    );

    // 4. Isolamento entre Contratada A e Contratada B (Beta NÃO vê nada de Alpha)
    const solBItems = await callJson(server, 'GET', '/api/integrations/items', tokens.solB);
    assert.equal(solBItems.status, 200);
    assert.equal(solBItems.data.items.length, 0);

    const solBDetail = await callJson(server, 'GET', `/api/integrations/${integrationId}`, tokens.solB);
    assert.equal(solBDetail.status, 403);

    // 5. Bloqueio de autoaprovação pela Contratada e bloqueio de mutação pelo Auditor
    const selfApprove = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/items/${pgrItem.id}/review`,
      tokens.solA,
      { decisao: 'APROVADO' }
    );
    assert.equal(selfApprove.status, 403);

    const auditorReview = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/items/${pgrItem.id}/review`,
      tokens.auditor,
      { decisao: 'APROVADO' }
    );
    assert.equal(auditorReview.status, 403);

    // 6. Admin aprova PGR e tenta reprovar ASO sem justificativa (bloqueado com 400)
    const approvePgr = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/items/${pgrItem.id}/review`,
      tokens.admin,
      { decisao: 'APROVADO', dataValidade: '2026-12-31' }
    );
    assert.equal(approvePgr.status, 200);

    const rejectNoReason = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/items/${asoItem.id}/review`,
      tokens.admin,
      { decisao: 'REPROVADO', motivo: '   ' }
    );
    assert.equal(rejectNoReason.status, 400);
    assert.equal(rejectNoReason.data.code, 'JUSTIFICATION_REQUIRED');

    // Admin reprova ASO com justificativa obrigatória
    const rejectAso = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/items/${asoItem.id}/review`,
      tokens.admin,
      { decisao: 'REPROVADO', motivo: 'Falta assinatura e CRM do médico examinador no ASO.' }
    );
    assert.equal(rejectAso.status, 200);

    // 7. Espelhamento de volta para Contratada Alpha: vê PGR APROVADO e ASO REPROVADO com justificativa, avaliador e data
    const solAMirrored = await callJson(server, 'GET', '/api/integrations/items', tokens.solA);
    assert.equal(solAMirrored.status, 200);
    const mirroredPgr = solAMirrored.data.items.find((i: any) => i.id === pgrItem.id);
    const mirroredAso = solAMirrored.data.items.find((i: any) => i.id === asoItem.id);
    assert.equal(mirroredPgr.status, 'APROVADO');
    assert.equal(mirroredPgr.analisadoPorNome, ADMIN_PROFILE.nome);
    assert.equal(mirroredAso.status, 'REPROVADO');
    assert.equal(
      mirroredAso.motivoReprovacao,
      'Falta assinatura e CRM do médico examinador no ASO.'
    );
    assert.equal(mirroredAso.analisadoPorNome, ADMIN_PROFILE.nome);
    assert.ok(mirroredAso.dataAnalise);

    // 8. Bloqueio de aprovação final enquanto existe documento obrigatório reprovado
    const blockedApprove1 = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/approve`,
      tokens.admin,
      {}
    );
    assert.equal(blockedApprove1.status, 422);
    assert.equal(blockedApprove1.data.code, 'MANDATORY_ITEMS_INCOMPLETE');

    // 9. Contratada Alpha reenvia ASO v2 preservando histórico da v1 reprovada (sem afetar PGR aprovado)
    const renewAso = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/items/${asoItem.id}/renew`,
      tokens.solA,
      {
        arquivoNome: 'aso-joao-v2-assinado.pdf',
        arquivoBase64: DATA_URL_V2,
        dataEmissao: '2026-06-14',
        dataValidade: '2027-06-14',
        conclusaoAso: 'apto',
      }
    );
    assert.equal(renewAso.status, 200);
    const renewedAso = renewAso.data.items.find((i: any) => i.id === asoItem.id);
    const preservedPgr = renewAso.data.items.find((i: any) => i.id === pgrItem.id);
    assert.equal(renewedAso.status, 'ENVIADO');
    assert.equal(renewedAso.versaoAtual, 2);
    assert.equal(renewedAso.versoes.length, 2, 'Histórico v1 + v2 deve ser preservado');
    assert.equal(renewedAso.versoes[0].status, 'REPROVADO');
    assert.equal(
      renewedAso.versoes[0].motivoReprovacao,
      'Falta assinatura e CRM do médico examinador no ASO.'
    );
    assert.equal(preservedPgr.status, 'APROVADO', 'Documento já aprovado deve permanecer preservado');

    // 10. Admin reavalia e aprova ASO v2; depois testa controle de validade (expirado bloqueia aprovação final!)
    const approveAsoV2 = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/items/${asoItem.id}/review`,
      tokens.admin,
      { decisao: 'APROVADO', dataValidade: '2027-06-14' }
    );
    assert.equal(approveAsoV2.status, 200);

    // Solicitante e Auditor NÃO podem alterar validade (403)
    const solUpdateValidity = await callJson(
      server,
      'PATCH',
      `/api/integrations/${integrationId}/items/${pgrItem.id}/validity`,
      tokens.solA,
      { dataValidade: '2027-12-31' }
    );
    assert.equal(solUpdateValidity.status, 403);

    const audUpdateValidity = await callJson(
      server,
      'PATCH',
      `/api/integrations/${integrationId}/items/${pgrItem.id}/validity`,
      tokens.auditor,
      { dataValidade: '2027-12-31' }
    );
    assert.equal(audUpdateValidity.status, 403);

    // Admin define validade vencida no PGR -> espelha para Contratada como VENCIDO e bloqueia aprovação final!
    const setExpired = await callJson(
      server,
      'PATCH',
      `/api/integrations/${integrationId}/items/${pgrItem.id}/validity`,
      tokens.admin,
      { dataValidade: '2026-05-01' }
    );
    assert.equal(setExpired.status, 200);

    const solSeesExpired = await callJson(server, 'GET', '/api/integrations/items', tokens.solA);
    const pgrExpiredItem = solSeesExpired.data.items.find((i: any) => i.id === pgrItem.id);
    assert.equal(pgrExpiredItem.dataValidade, '2026-05-01');
    assert.equal(
      resolveIntegrationItemStandardizedStatus(pgrExpiredItem, pgrExpiredItem.protocoloStatus, FIXED_NOW.toISOString()),
      'VENCIDO'
    );

    const blockedByExpired = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/approve`,
      tokens.admin,
      {}
    );
    assert.equal(blockedByExpired.status, 422);
    assert.equal(blockedByExpired.data.code, 'MANDATORY_ITEM_EXPIRED');

    // Admin corrige validade para data próxima do vencimento (≤ 30 dias) e aprova integração final
    const setValidSoon = await callJson(
      server,
      'PATCH',
      `/api/integrations/${integrationId}/items/${pgrItem.id}/validity`,
      tokens.admin,
      { dataValidade: '2026-07-05' }
    );
    assert.equal(setValidSoon.status, 200);

    const finalApprove = await callJson(
      server,
      'POST',
      `/api/integrations/${integrationId}/approve`,
      tokens.admin,
      { justificativa: 'Documentação 100% conferida e aprovada.' }
    );
    assert.equal(finalApprove.status, 200);
    assert.equal(finalApprove.data.integration.status, 'APROVADA');

    // Contratada Alpha vê imediatamente o protocolo APROVADA e o status PROXIMO_VENCIMENTO do PGR
    const solFinalItems = await callJson(server, 'GET', '/api/integrations/items', tokens.solA);
    const finalPgr = solFinalItems.data.items.find((i: any) => i.id === pgrItem.id);
    const finalAso = solFinalItems.data.items.find((i: any) => i.id === asoItem.id);
    assert.equal(finalPgr.protocoloStatus, 'APROVADA');
    assert.equal(
      resolveIntegrationItemStandardizedStatus(finalPgr, finalPgr.protocoloStatus, FIXED_NOW.toISOString()),
      'PROXIMO_VENCIMENTO'
    );
    assert.equal(
      resolveIntegrationItemStandardizedStatus(finalAso, finalAso.protocoloStatus, FIXED_NOW.toISOString()),
      'APROVADO'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
