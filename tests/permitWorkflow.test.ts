import http from 'http';
import {
  createInMemoryPermitRepository,
  PermitOfficialDataset,
  PermitWorkflowActor,
  PermitWorkflowError,
  PermitWorkflowService,
} from '../backend/permitWorkflowService';
import { createApiApp } from '../backend/app';
import {
  buildActivityProfilePayloadFromTemplate,
  buildRequirementsPayloadFromTemplate,
  INITIAL_ACTIVITY_TEMPLATES,
} from '../src/utils/activityTemplates';
import type {
  ActivityComplianceItemResult,
  ActivityComplianceResult,
  ActivityDocumentRequirement,
  ActivityProfile,
  Company,
  DocumentSST,
  Employee,
  EPIDelivery,
  OccupationalExam,
  SafetyPermit,
  SmartDocRecord,
  Training,
} from '../src/types/sst';

// ============================================================================
// RUNNER MINIMALISTA (ASYNC-SAFE, SEM DEPENDÊNCIAS EXTERNAS)
// ============================================================================

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message}\n  Esperado: ${JSON.stringify(expected)}\n  Obtido:   ${JSON.stringify(actual)}`
    );
  }
}

function getAllComplianceItems(compliance: ActivityComplianceResult): ActivityComplianceItemResult[] {
  return [
    ...compliance.itensEmpresa,
    ...compliance.itensAtividade,
    ...compliance.colaboradores.flatMap((c) => c.itens),
  ];
}

async function assertRejectsWithError(
  fn: () => Promise<unknown>,
  expectedStatus: number,
  expectedCode?: string,
  message?: string
): Promise<PermitWorkflowError> {
  try {
    await fn();
  } catch (err) {
    assert(
      err instanceof PermitWorkflowError,
      `${message || 'Esperava PermitWorkflowError'}, mas recebeu: ${String(err)}`
    );
    const wfErr = err as PermitWorkflowError;
    assertEqual(
      wfErr.statusCode,
      expectedStatus,
      `${message || 'HTTP status divergente'} (code=${wfErr.code}, msg=${wfErr.message})`
    );
    if (expectedCode) {
      assertEqual(
        wfErr.code,
        expectedCode,
        `${message || 'Error code divergente'} (msg=${wfErr.message})`
      );
    }
    return wfErr;
  }
  throw new Error(
    `Assertion failed: ${message || 'Era esperado erro'} — operação foi concluída com sucesso indevidamente.`
  );
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// ATORES E FIXTURES BASE (EXCLUSIVAMENTE EMPRESAS CONTRATADAS E TERCEIRIZADOS)
// ============================================================================

const REF_DATE = new Date('2026-11-23T12:00:00.000Z');
const ACT_ALTURA_ID = 'act_trabalho_altura';

const ADMIN_ACTOR: PermitWorkflowActor = {
  id: 'user-admin-ehs',
  nome: 'Coordenador EHS Admin',
  email: 'admin.ehs@empresa.com',
  role: 'admin',
};

const SOLICITANTE_A: PermitWorkflowActor = {
  id: 'user-sol-a',
  nome: 'Supervisor Contratada Alfa',
  email: 'supervisor@alfa.com',
  role: 'solicitante',
  empresaId: 'comp_alfa',
};

const SOLICITANTE_B: PermitWorkflowActor = {
  id: 'user-sol-b',
  nome: 'Supervisor Contratada Beta',
  email: 'supervisor@beta.com',
  role: 'solicitante',
  empresaId: 'comp_beta',
};

const AUDITOR_ACTOR: PermitWorkflowActor = {
  id: 'user-auditor',
  nome: 'Auditor Corporativo EHS',
  email: 'auditor@empresa.com',
  role: 'auditor',
};

function buildBaseDataset(): PermitOfficialDataset {
  const activityProfiles: ActivityProfile[] = [];
  const activityDocumentRequirements: ActivityDocumentRequirement[] = [];

  for (const tpl of INITIAL_ACTIVITY_TEMPLATES) {
    const actId = `act_${tpl.codigo.toLowerCase()}`;
    activityProfiles.push({
      id: actId,
      ...buildActivityProfilePayloadFromTemplate(
        tpl,
        { id: ADMIN_ACTOR.id, nome: ADMIN_ACTOR.nome },
        '2026-10-01T10:00:00.000Z'
      ),
    });
    const reqs = buildRequirementsPayloadFromTemplate(
      tpl,
      actId,
      { id: ADMIN_ACTOR.id, nome: ADMIN_ACTOR.nome },
      '2026-10-01T10:00:00.000Z'
    );
    reqs.forEach((r, idx) => {
      activityDocumentRequirements.push({
        id: `req_${tpl.codigo.toLowerCase()}_${idx + 1}`,
        ...r,
      });
    });
  }

  // Atividade inativa para testar bloqueio
  activityProfiles.push({
    id: 'act_inativa',
    codigo: 'INATIVA_TESTE',
    nome: 'Atividade Desativada',
    descricao: 'Desativada pelo Admin EHS',
    nivelRisco: 'critico',
    riscosAssociados: ['Risco legado'],
    normasAplicaveis: ['NR-01'],
    exigeAPR: true,
    exigePT: true,
    exigeLOTO: false,
    exigePET: false,
    ativo: false,
    criadoPorId: ADMIN_ACTOR.id,
    criadoPorNome: ADMIN_ACTOR.nome,
    createdAt: '2026-10-01T10:00:00.000Z',
  });

  // Requisito restrito a cargo específico (Eletricista) em Trabalho em Altura para testar filtro por função
  activityDocumentRequirements.push({
    id: 'req_role_eletricista_sep',
    activityId: ACT_ALTURA_ID,
    documentoCodigoCanonico: 'NR10_SEP',
    nomeExibicao: 'Treinamento NR-10 SEP (Restrito a Eletricista)',
    escopo: 'colaborador',
    origemColecao: 'trainings',
    obrigatorioParaLiberacao: true,
    exigeAptoASO: false,
    funcoesAplicaveis: ['eletricista'],
    palavrasChaveMatch: ['nr-10 sep', 'nr10 sep', 'sistema eletrico de potencia'],
    baseLegal: 'NR-10',
    ativo: true,
    criadoPorId: ADMIN_ACTOR.id,
    criadoPorNome: ADMIN_ACTOR.nome,
    createdAt: '2026-10-01T10:00:00.000Z',
  });

  const companies: Company[] = [
    {
      id: 'comp_alfa',
      razaoSocial: 'Alfa Engenharia Industrial Ltda',
      nomeFantasia: 'Alfa Engenharia',
      cnpj: '11.222.333/0001-44',
      responsavelLegal: 'João Gestor',
      responsavelSST: 'Eng. Segurança Alfa',
      email: 'contato@alfa.com',
      telefone: '(11) 99999-1111',
      endereco: 'Av. Industrial, 100',
      unidadeAtendimento: 'Planta SP',
      atividadeContratada: 'Manutenção Industrial e Altura',
      dataInicioContrato: '2026-01-01',
      dataTerminoContrato: '2027-12-31',
      situacao: 'ativa',
      atividadesAutorizadasIds: [ACT_ALTURA_ID, 'act_servicos_eletricos'],
    },
    {
      id: 'comp_beta',
      razaoSocial: 'Beta Montagens Especiais S/A',
      nomeFantasia: 'Beta Montagens',
      cnpj: '22.333.444/0001-55',
      responsavelLegal: 'Maria Gestora',
      responsavelSST: 'Téc. Segurança Beta',
      email: 'contato@beta.com',
      telefone: '(11) 98888-2222',
      endereco: 'Rua das Indústrias, 200',
      unidadeAtendimento: 'Planta SP',
      atividadeContratada: 'Montagem Mecânica',
      dataInicioContrato: '2026-01-01',
      dataTerminoContrato: '2027-12-31',
      situacao: 'ativa',
      atividadesAutorizadasIds: [ACT_ALTURA_ID],
    },
    {
      id: 'comp_inativa',
      razaoSocial: 'Gama Serviços Inativos Ltda',
      nomeFantasia: 'Gama Serviços',
      cnpj: '33.444.555/0001-66',
      responsavelLegal: 'Pedro',
      responsavelSST: 'Pedro SST',
      email: 'contato@gama.com',
      telefone: '(11) 97777-3333',
      endereco: 'Rua Antiga, 300',
      unidadeAtendimento: 'Planta SP',
      atividadeContratada: 'Serviços Gerais',
      dataInicioContrato: '2025-01-01',
      dataTerminoContrato: '2026-01-01',
      situacao: 'inativa',
    },
  ];

  const employees: Employee[] = [
    {
      id: 'emp_montador',
      nomeCompleto: 'Carlos Montador Terceiro',
      cpf: '111.222.333-44',
      cargo: 'Montador de Andaime',
      setor: 'Manutenção',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataAdmissao: '2025-03-10',
      situacaoCadastral: 'ativo',
      atividadesHabilitadasIds: [ACT_ALTURA_ID],
    },
    {
      id: 'emp_eletricista',
      nomeCompleto: 'Roberto Eletricista Terceiro',
      cpf: '222.333.444-55',
      cargo: 'Eletricista Industrial',
      setor: 'Elétrica',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataAdmissao: '2025-04-15',
      situacaoCadastral: 'ativo',
      atividadesHabilitadasIds: [ACT_ALTURA_ID, 'act_servicos_eletricos'],
    },
    {
      id: 'emp_demitido',
      nomeCompleto: 'Marcos Desligado',
      cpf: '333.444.555-66',
      cargo: 'Montador',
      setor: 'Manutenção',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataAdmissao: '2024-02-01',
      situacaoCadastral: 'demitido',
    },
    {
      id: 'emp_beta',
      nomeCompleto: 'Lucas Terceiro Beta',
      cpf: '444.555.666-77',
      cargo: 'Montador',
      setor: 'Montagem',
      empresaId: 'comp_beta',
      empresaNome: 'Beta Montagens Especiais S/A',
      dataAdmissao: '2025-05-01',
      situacaoCadastral: 'ativo',
    },
  ];

  // Documentos 100% conformes para comp_alfa em Trabalho em Altura (NR-35)
  const documents: DocumentSST[] = [
    {
      id: 'doc_pgr',
      nomeDocumento: 'PGR - Programa de Gerenciamento de Riscos',
      tipoDocumentoCanonico: 'PGR',
      categoria: 'Documento Empresarial',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataEmissao: '2026-01-10',
      dataValidade: '2027-06-30',
      responsavelEnvio: 'Supervisor Alfa',
      arquivoUrl: 'https://files.example.com/pgr.pdf',
      arquivoNome: 'pgr.pdf',
      versao: 1,
      situacao: 'aprovado',
    },
    {
      id: 'doc_pcmso',
      nomeDocumento: 'PCMSO - Programa de Controle Médico de Saúde Ocupacional',
      tipoDocumentoCanonico: 'PCMSO',
      categoria: 'Documento Empresarial',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataEmissao: '2026-01-10',
      dataValidade: '2027-06-30',
      responsavelEnvio: 'Supervisor Alfa',
      arquivoUrl: 'https://files.example.com/pcmso.pdf',
      arquivoNome: 'pcmso.pdf',
      versao: 1,
      situacao: 'aprovado',
    },
    {
      id: 'doc_resgate_altura',
      nomeDocumento: 'Plano de Emergência e Resgate em Altura',
      tipoDocumentoCanonico: 'PLANO_RESGATE_ALTURA',
      categoria: 'Documento Empresarial',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataEmissao: '2026-06-01',
      dataValidade: '2027-06-30',
      responsavelEnvio: 'Supervisor Alfa',
      arquivoUrl: 'https://files.example.com/resgate.pdf',
      arquivoNome: 'resgate.pdf',
      versao: 1,
      situacao: 'aprovado',
    },
  ];

  const trainings: Training[] = [
    {
      id: 'trn_nr35_montador',
      nomeTreinamento: 'NR-35 Trabalho em Altura',
      tipoDocumentoCanonico: 'NR-35',
      colaboradorId: 'emp_montador',
      colaboradorNome: 'Carlos Montador Terceiro',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataRealizacao: '2026-02-01',
      dataValidade: '2028-02-01',
      situacao: 'aprovado',
    },
    {
      id: 'trn_int_montador',
      nomeTreinamento: 'Integração de Segurança EHS',
      tipoDocumentoCanonico: 'INTEGRACAO_EHS',
      colaboradorId: 'emp_montador',
      colaboradorNome: 'Carlos Montador Terceiro',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataRealizacao: '2026-02-01',
      dataValidade: '2027-08-01',
      situacao: 'aprovado',
    },
    {
      id: 'trn_nr35_eletricista',
      nomeTreinamento: 'NR-35 Trabalho em Altura',
      tipoDocumentoCanonico: 'NR-35',
      colaboradorId: 'emp_eletricista',
      colaboradorNome: 'Roberto Eletricista Terceiro',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataRealizacao: '2026-02-01',
      dataValidade: '2028-02-01',
      situacao: 'aprovado',
    },
    {
      id: 'trn_int_eletricista',
      nomeTreinamento: 'Integração de Segurança EHS',
      tipoDocumentoCanonico: 'INTEGRACAO_EHS',
      colaboradorId: 'emp_eletricista',
      colaboradorNome: 'Roberto Eletricista Terceiro',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      dataRealizacao: '2026-02-01',
      dataValidade: '2027-08-01',
      situacao: 'aprovado',
    },
  ];

  const exams: OccupationalExam[] = [
    {
      id: 'exam_aso_montador',
      colaboradorId: 'emp_montador',
      colaboradorNome: 'Carlos Montador Terceiro',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      tipoExame: 'ASO Periódico',
      tipoDocumentoCanonico: 'ASO',
      dataRealizacao: '2026-05-01',
      dataValidade: '2027-05-01',
      conclusao: 'apto',
      situacao: 'aprovado',
      aptidoesEspecificas: ['trabalho_altura'],
    },
    {
      id: 'exam_aso_eletricista',
      colaboradorId: 'emp_eletricista',
      colaboradorNome: 'Roberto Eletricista Terceiro',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      tipoExame: 'ASO Periódico',
      tipoDocumentoCanonico: 'ASO',
      dataRealizacao: '2026-05-01',
      dataValidade: '2027-05-01',
      conclusao: 'apto',
      situacao: 'aprovado',
      aptidoesEspecificas: ['trabalho_altura', 'eletricidade'],
    },
  ];

  const epiDeliveries: EPIDelivery[] = [
    {
      id: 'epi_montador_1',
      colaboradorId: 'emp_montador',
      colaboradorNome: 'Carlos Montador Terceiro',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      nomeEpi: 'Cinto Paraquedista + Talabarte Duplo + Capacete c/ Jugular',
      caNumero: '12345',
      dataEntrega: '2026-06-01',
      quantidade: 1,
      responsavelEntrega: 'Almoxarife Alfa',
    },
    {
      id: 'epi_eletricista_1',
      colaboradorId: 'emp_eletricista',
      colaboradorNome: 'Roberto Eletricista Terceiro',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      nomeEpi: 'Cinto Paraquedista + Luva Isolante',
      caNumero: '54321',
      dataEntrega: '2026-06-01',
      quantidade: 1,
      responsavelEntrega: 'Almoxarife Alfa',
    },
  ];

  // APR e PT oficiais aprovadas para satisfazer os requisitos de escopo atividade_pt de NR-35
  const safetyPermits: SafetyPermit[] = [
    {
      id: 'permit_apr_ativa_alfa',
      tipo: 'APR',
      titulo: 'APR Oficial Trabalho em Altura - Galpão B',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      localTrabalho: 'Galpão B',
      dataInicio: '2026-11-01',
      dataFim: '2027-06-30',
      responsavelEmissao: 'Engenheiro EHS',
      riscosIdentificados: 'Queda em altura',
      medidasPreventivas: 'Linha de vida',
      status: 'aprovado',
    },
    {
      id: 'permit_pt_ativa_alfa',
      tipo: 'PT',
      titulo: 'PT Oficial Trabalho em Altura - Galpão B',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      localTrabalho: 'Galpão B',
      dataInicio: '2026-11-01',
      dataFim: '2027-06-30',
      responsavelEmissao: 'Engenheiro EHS',
      riscosIdentificados: 'Queda em altura',
      medidasPreventivas: 'Linha de vida',
      status: 'aprovado',
    },
    {
      id: 'permit_legado_1',
      tipo: 'APR',
      titulo: 'APR Legada Telhado Galpão 1',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      localTrabalho: 'Galpão 1',
      dataInicio: '2026-10-01',
      dataFim: '2026-10-15',
      responsavelEmissao: 'Engenheiro Legado',
      riscosIdentificados: 'Queda em altura',
      medidasPreventivas: 'Linha de vida',
      status: 'em_execucao',
    },
  ];

  const smartDocs: SmartDocRecord[] = [];

  return {
    companies,
    employees,
    activityProfiles,
    activityDocumentRequirements,
    documents,
    trainings,
    exams,
    epiDeliveries,
    safetyPermits,
    smartDocs,
  };
}

function baseDraftPayload(overrides: Record<string, unknown> = {}) {
  return {
    tipo: 'PT' as const,
    titulo: 'Montagem de Andaime no Galpão B',
    descricaoServico: 'Montagem de andaime tubular a 6m de altura',
    empresaId: 'comp_alfa',
    localTrabalho: 'Galpão B - Ala Norte',
    dataInicio: '2026-11-24',
    dataFim: '2026-11-28',
    responsavelEmissao: 'Supervisor Contratada Alfa',
    responsavelAtividade: 'Carlos Montador Terceiro',
    riscosIdentificados: 'Queda de altura, queda de materiais',
    medidasPreventivas: 'Linha de vida, cinto paraquedista, isolamento de área',
    atividadeIds: [ACT_ALTURA_ID],
    colaboradorIds: ['emp_montador'],
    ...overrides,
  };
}

async function main() {
  console.log('\n=== TESTES DO WORKFLOW DE SOLICITAÇÃO E LIBERAÇÃO DE ATIVIDADES (ETAPA 4) ===\n');

  // 1. Solicitante cria rascunho para própria empresa ativa
  await runTest('1. Solicitante cria rascunho válido para própria empresa ativa (elaboracao, v1, auditLog)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);
    const res = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);

    assertEqual(res.permit.status, 'elaboracao', 'Status inicial deve ser elaboracao');
    assertEqual(res.permit.versaoConcorrencia, 1, 'Versão inicial deve ser 1');
    assertEqual(res.permit.validadoServerSide, true, 'Deve marcar validadoServerSide');
    assertEqual(res.permit.controlesOperacionais?.exigeAPR, true, 'NR-35 exige APR');
    assertEqual(res.permit.controlesOperacionais?.exigePT, true, 'NR-35 exige PT');
    assertEqual(
      res.compliance.podeLiberar,
      true,
      `Documentação base deveria estar 100% conforme. Bloqueios: ${res.compliance.motivosBloqueio.join('; ')}`
    );
    assert(repo.auditLogs.length >= 1, 'Deve gravar auditLog na criação');
    assertEqual(res.permit.historicoWorkflow?.length, 1, 'Deve registrar 1 entrada no historicoWorkflow');
  });

  // 2. Solicitante não pode criar, listar ou editar solicitação de outra empresa
  await runTest('2. Solicitante bloqueado para criar/visualizar/editar solicitação de outra contratada (403)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    await assertRejectsWithError(
      () =>
        svc.createPermitDraft(
          SOLICITANTE_A,
          baseDraftPayload({ empresaId: 'comp_beta', colaboradorIds: ['emp_beta'] }),
          REF_DATE
        ),
      403,
      'COMPANY_SCOPE_FORBIDDEN',
      'Solicitante A não pode criar para comp_beta'
    );

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);

    await assertRejectsWithError(
      () => svc.evaluatePermit(SOLICITANTE_B, created.permit.id, REF_DATE),
      403,
      'COMPANY_SCOPE_FORBIDDEN',
      'Solicitante B não pode avaliar permit da Alfa'
    );
    await assertRejectsWithError(
      () => svc.updatePermitDraft(SOLICITANTE_B, created.permit.id, { titulo: 'Invasão' }, REF_DATE),
      403,
      'COMPANY_SCOPE_FORBIDDEN',
      'Solicitante B não pode editar permit da Alfa'
    );

    const listB = await svc.listPermits(SOLICITANTE_B);
    assert(
      !listB.some((p) => p.id === created.permit.id),
      'Listagem do Solicitante B não deve expor solicitações da Alfa'
    );
  });

  // 3. Auditor possui acesso estritamente somente leitura
  await runTest('3. Auditor lê e avalia qualquer solicitação, mas é bloqueado em qualquer mutação (403)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    await assertRejectsWithError(
      () => svc.createPermitDraft(AUDITOR_ACTOR, baseDraftPayload(), REF_DATE),
      403,
      'EDITOR_ONLY_ACTION',
      'Auditor não pode criar solicitação'
    );

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    const listAud = await svc.listPermits(AUDITOR_ACTOR);
    assert(listAud.some((p) => p.id === created.permit.id), 'Auditor deve listar todas as solicitações');

    const evalAud = await svc.evaluatePermit(AUDITOR_ACTOR, created.permit.id, REF_DATE);
    assertEqual(evalAud.permit.id, created.permit.id, 'Auditor pode consultar checklist oficial');

    await assertRejectsWithError(
      () => svc.submitPermit(AUDITOR_ACTOR, created.permit.id, { referenceDate: REF_DATE }),
      403,
      'EDITOR_ONLY_ACTION',
      'Auditor não pode submeter'
    );
    await assertRejectsWithError(
      () => svc.approvePermit(AUDITOR_ACTOR, created.permit.id, { referenceDate: REF_DATE }),
      403,
      'ADMIN_ONLY_ACTION',
      'Auditor não pode aprovar'
    );
    await assertRejectsWithError(
      () => svc.cancelPermit(AUDITOR_ACTOR, created.permit.id, { justificativa: 'Teste auditor' }),
      403,
      'EDITOR_ONLY_ACTION',
      'Auditor não pode cancelar'
    );
  });

  // 4. Empresa inativa é barrada estruturalmente
  await runTest('4. Empresa contratada inativa é impedida de criar/aprovar solicitação (422)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    await assertRejectsWithError(
      () =>
        svc.createPermitDraft(
          ADMIN_ACTOR,
          baseDraftPayload({ empresaId: 'comp_inativa', colaboradorIds: [] }),
          REF_DATE
        ),
      422,
      'STRUCTURAL_VALIDATION_FAILED',
      'Empresa inativa deve ser rejeitada'
    );
  });

  // 5. Atividade inativa é barrada estruturalmente
  await runTest('5. Atividade desativada na matriz é impedida de ser vinculada (422)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    await assertRejectsWithError(
      () =>
        svc.createPermitDraft(
          SOLICITANTE_A,
          baseDraftPayload({ atividadeIds: ['act_inativa'] }),
          REF_DATE
        ),
      422,
      'STRUCTURAL_VALIDATION_FAILED',
      'Atividade inativa deve ser rejeitada'
    );
  });

  // 6. Colaborador de outra empresa é barrado estruturalmente
  await runTest('6. Colaborador terceirizado de outra empresa é rejeitado (422)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    await assertRejectsWithError(
      () =>
        svc.createPermitDraft(
          SOLICITANTE_A,
          baseDraftPayload({ colaboradorIds: ['emp_beta'] }),
          REF_DATE
        ),
      422,
      'STRUCTURAL_VALIDATION_FAILED',
      'Colaborador de outra contratada deve ser rejeitado'
    );
  });

  // 7. Colaborador demitido/inativo é barrado estruturalmente
  await runTest('7. Colaborador terceirizado demitido/inativo é rejeitado (422)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    await assertRejectsWithError(
      () =>
        svc.createPermitDraft(
          SOLICITANTE_A,
          baseDraftPayload({ colaboradorIds: ['emp_demitido'] }),
          REF_DATE
        ),
      422,
      'STRUCTURAL_VALIDATION_FAILED',
      'Colaborador demitido deve ser rejeitado'
    );
  });

  // 8. Anti-tampering na criação (status liberado/aprovado ou campos protegidos)
  await runTest('8. Anti-tampering na criação bloqueia status direto ou campos protegidos (403)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    await assertRejectsWithError(
      () => svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload({ status: 'liberado' }), REF_DATE),
      403,
      'TAMPERING_DIRECT_STATUS',
      'Não pode criar diretamente como liberado'
    );

    await assertRejectsWithError(
      () => svc.createPermitDraft(ADMIN_ACTOR, baseDraftPayload({ status: 'aprovado' }), REF_DATE),
      403,
      'TAMPERING_DIRECT_STATUS',
      'Nem Admin pode pular workflow enviando status aprovado na criação'
    );

    await assertRejectsWithError(
      () =>
        svc.createPermitDraft(
          SOLICITANTE_A,
          baseDraftPayload({ statusConformidade: 'conforme' }),
          REF_DATE
        ),
      403,
      'TAMPERING_FORBIDDEN_FIELDS',
      'Não pode forjar statusConformidade'
    );

    await assertRejectsWithError(
      () =>
        svc.createPermitDraft(
          SOLICITANTE_A,
          baseDraftPayload({ liberadoPorId: 'fake-admin' }),
          REF_DATE
        ),
      403,
      'TAMPERING_FORBIDDEN_FIELDS',
      'Não pode forjar liberadoPorId'
    );
  });

  // 9. Anti-tampering na edição de rascunho
  await runTest('9. Anti-tampering na edição bloqueia alteração direta de status ou validadoServerSide (403)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);
    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);

    await assertRejectsWithError(
      () =>
        svc.updatePermitDraft(
          SOLICITANTE_A,
          created.permit.id,
          { status: 'aprovado' },
          REF_DATE
        ),
      403,
      'TAMPERING_DIRECT_STATUS',
      'Edição não pode alterar status diretamente'
    );

    await assertRejectsWithError(
      () =>
        svc.updatePermitDraft(
          ADMIN_ACTOR,
          created.permit.id,
          { validadoServerSide: true },
          REF_DATE
        ),
      403,
      'TAMPERING_FORBIDDEN_FIELDS',
      'Edição não pode sobrescrever campos protegidos'
    );
  });

  // 10. Bloqueio de aprovação por documento obrigatório AUSENTE (PGR)
  await runTest('10. Aprovação bloqueada no servidor quando documento obrigatório (PGR) está AUSENTE (422)', async () => {
    const ds = buildBaseDataset();
    ds.documents = ds.documents.filter((d) => d.tipoDocumentoCanonico !== 'PGR');
    const repo = createInMemoryPermitRepository(ds);
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    const err = await assertRejectsWithError(
      () => svc.approvePermit(ADMIN_ACTOR, created.permit.id, { referenceDate: REF_DATE }),
      422,
      'COMPLIANCE_BLOCKED',
      'PGR ausente deve bloquear aprovação'
    );
    assert(
      Array.isArray(err.details?.motivosBloqueio) && (err.details?.motivosBloqueio as string[]).length > 0,
      'Deve retornar motivosBloqueio detalhados'
    );
  });

  // 11. Bloqueio de aprovação por documento VENCIDO
  await runTest('11. Aprovação bloqueada quando documento obrigatório está VENCIDO (422)', async () => {
    const ds = buildBaseDataset();
    ds.documents = ds.documents.map((d) =>
      d.id === 'doc_pcmso' ? { ...d, dataValidade: '2026-11-01' } : d
    );
    const repo = createInMemoryPermitRepository(ds);
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    await assertRejectsWithError(
      () => svc.approvePermit(ADMIN_ACTOR, created.permit.id, { referenceDate: REF_DATE }),
      422,
      'COMPLIANCE_BLOCKED',
      'PCMSO vencido deve bloquear aprovação'
    );
  });

  // 12. Bloqueio de aprovação por documento REPROVADO
  await runTest('12. Aprovação bloqueada quando treinamento/documento obrigatório está REPROVADO (422)', async () => {
    const ds = buildBaseDataset();
    ds.trainings = ds.trainings.map((t) =>
      t.id === 'trn_nr35_montador' ? { ...t, situacao: 'reprovado' } : t
    );
    const repo = createInMemoryPermitRepository(ds);
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    await assertRejectsWithError(
      () => svc.approvePermit(ADMIN_ACTOR, created.permit.id, { referenceDate: REF_DATE }),
      422,
      'COMPLIANCE_BLOCKED',
      'NR-35 reprovada deve bloquear aprovação'
    );
  });

  // 13. Bloqueio de aprovação por documento PENDENTE_APROVACAO no módulo oficial
  await runTest('13. Aprovação bloqueada quando documento está pendente de aprovação humana no módulo oficial (422)', async () => {
    const ds = buildBaseDataset();
    ds.documents = ds.documents.map((d) =>
      d.id === 'doc_pgr' ? { ...d, situacao: 'pendente' } : d
    );
    const repo = createInMemoryPermitRepository(ds);
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    const ev = await svc.evaluatePermit(ADMIN_ACTOR, created.permit.id, REF_DATE);
    assert(
      getAllComplianceItems(ev.compliance).some(
        (i) => i.documentoCodigoCanonico === 'PGR' && i.status === 'PENDENTE_APROVACAO'
      ),
      'PGR deve constar como PENDENTE_APROVACAO'
    );

    await assertRejectsWithError(
      () => svc.approvePermit(ADMIN_ACTOR, created.permit.id, { referenceDate: REF_DATE }),
      422,
      'COMPLIANCE_BLOCKED',
      'Documento pendente de aprovação não pode satisfazer requisito'
    );
  });

  // 14. Bloqueio de aprovação quando documento existe apenas no SmartDocs (não aprovado oficialmente)
  await runTest('14. Documento pendente no SmartDocs (sem aprovação oficial) classifica PENDENTE_APROVACAO e bloqueia (422)', async () => {
    const ds = buildBaseDataset();
    ds.documents = ds.documents.filter((d) => d.tipoDocumentoCanonico !== 'PGR');
    ds.smartDocs.push({
      id: 'sd_pgr_1',
      arquivoNome: 'pgr_alfa_2026.pdf',
      arquivoMimeType: 'application/pdf',
      arquivoTamanhoBytes: 120000,
      arquivoHashSha256: 'abc123',
      categoriaGrupo: 'documentos_empresariais',
      tipoDocumento: 'PGR',
      classificacaoManual: false,
      classificacaoConfianca: 0.95,
      status: 'PENDENTE_APROVACAO',
      statusValidade: 'PENDENTE_APROVACAO',
      empresaId: 'comp_alfa',
      empresaNome: 'Alfa Engenharia Industrial Ltda',
      isSensitiveMedical: false,
      enviadoPorId: SOLICITANTE_A.id,
      enviadoPorNome: SOLICITANTE_A.nome,
      enviadoPorEmail: SOLICITANTE_A.email,
      dataEnvio: '2026-11-22T10:00:00.000Z',
      dadosExtraidos: {
        nomeDocumento: 'PGR - Programa de Gerenciamento de Riscos',
        dataEmissao: '2026-11-01',
        dataValidade: '2027-11-01',
      },
      inconsistencias: [],
      camposNaoIdentificados: [],
      historico: [],
      createdAt: '2026-11-22T10:00:00.000Z',
      updatedAt: '2026-11-22T10:00:00.000Z',
    });

    const repo = createInMemoryPermitRepository(ds);
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    const ev = await svc.evaluatePermit(ADMIN_ACTOR, created.permit.id, REF_DATE);
    assert(
      getAllComplianceItems(ev.compliance).some(
        (i) => i.documentoCodigoCanonico === 'PGR' && i.status === 'PENDENTE_APROVACAO'
      ),
      'SmartDoc pendente deve aparecer como PENDENTE_APROVACAO'
    );

    await assertRejectsWithError(
      () => svc.approvePermit(ADMIN_ACTOR, created.permit.id, { referenceDate: REF_DATE }),
      422,
      'COMPLIANCE_BLOCKED',
      'SmartDoc não aprovado não pode liberar atividade'
    );
  });

  // 15. Bloqueio de aprovação por ASO INAPTO ou sem aptidão específica para altura
  await runTest('15. ASO inapto ou sem aptidão específica (trabalho_altura) resulta em ASO_INAPTO e bloqueia (422)', async () => {
    const ds = buildBaseDataset();
    ds.exams = ds.exams.map((ex) =>
      ex.id === 'exam_aso_montador' ? { ...ex, aptidoesEspecificas: ['eletricidade'] } : ex
    );
    const repo = createInMemoryPermitRepository(ds);
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    const ev = await svc.evaluatePermit(ADMIN_ACTOR, created.permit.id, REF_DATE);
    assert(
      getAllComplianceItems(ev.compliance).some(
        (i) => i.documentoCodigoCanonico === 'ASO' && i.status === 'ASO_INAPTO'
      ),
      'Falta da aptidão trabalho_altura deve retornar ASO_INAPTO'
    );

    await assertRejectsWithError(
      () => svc.approvePermit(ADMIN_ACTOR, created.permit.id, { referenceDate: REF_DATE }),
      422,
      'COMPLIANCE_BLOCKED',
      'ASO sem aptidão trabalho_altura deve bloquear'
    );
  });

  // 16. Filtro por cargo/função: requisito restrito a Eletricista não bloqueia Montador, mas bloqueia Eletricista
  await runTest('16. Filtro por cargo/função aplica NR10_SEP apenas para Eletricista e não para Montador', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    const draftMontador = await svc.createPermitDraft(
      SOLICITANTE_A,
      baseDraftPayload({ colaboradorIds: ['emp_montador'] }),
      REF_DATE
    );
    assertEqual(draftMontador.compliance.podeLiberar, true, 'Montador não exige NR10_SEP');

    const draftElet = await svc.createPermitDraft(
      SOLICITANTE_A,
      baseDraftPayload({ colaboradorIds: ['emp_eletricista'] }),
      REF_DATE
    );
    assertEqual(draftElet.compliance.podeLiberar, false, 'Eletricista sem NR10_SEP deve bloquear');
    assert(
      getAllComplianceItems(draftElet.compliance).some(
        (i) => i.documentoCodigoCanonico === 'NR10_SEP' && i.status === 'AUSENTE' && i.bloqueante
      ),
      'NR10_SEP deve constar como AUSENTE e bloqueante para Eletricista'
    );
  });

  // 17. Documento A_VENCER (<= 30 dias) permite aprovação e liberação com alerta (statusConformidade = atencao)
  await runTest('17. Documento aprovado A_VENCER (<= 30 dias) permite aprovação e liberação com status atencao', async () => {
    const ds = buildBaseDataset();
    ds.documents = ds.documents.map((d) =>
      d.id === 'doc_pgr' ? { ...d, dataValidade: '2026-12-10' } : d
    );
    const repo = createInMemoryPermitRepository(ds);
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    assertEqual(created.compliance.statusGeral, 'atencao', 'Status geral deve ser atencao');
    assertEqual(created.compliance.podeLiberar, true, 'A_VENCER não deve bloquear liberação');

    const submitted = await svc.submitPermit(SOLICITANTE_A, created.permit.id, {
      referenceDate: REF_DATE,
    });
    const approved = await svc.approvePermit(ADMIN_ACTOR, submitted.permit.id, {
      expectedVersion: submitted.permit.versaoConcorrencia,
      referenceDate: REF_DATE,
    });
    assertEqual(approved.permit.status, 'aprovado', 'Deve aprovar com A_VENCER');

    const released = await svc.releasePermit(ADMIN_ACTOR, approved.permit.id, {
      expectedVersion: approved.permit.versaoConcorrencia,
      expectedComplianceFingerprint: approved.permit.complianceFingerprint,
      referenceDate: REF_DATE,
    });
    assertEqual(released.permit.status, 'liberado', 'Deve liberar com A_VENCER');
    assertEqual(released.permit.statusConformidade, 'atencao', 'Deve registrar statusConformidade = atencao');
  });

  // 18. Solicitante não pode autoaprovar, iniciar análise, solicitar docs/correção, reprovar, liberar ou encerrar
  await runTest('18. Anti-autoaprovação: Solicitante é barrado em todas as ações exclusivas do Admin EHS (403)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    await assertRejectsWithError(
      () => svc.startReview(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE }),
      403,
      'ADMIN_ONLY_ACTION'
    );
    await assertRejectsWithError(
      () => svc.requestDocumentation(SOLICITANTE_A, created.permit.id, { justificativa: 'Teste' }),
      403,
      'ADMIN_ONLY_ACTION'
    );
    await assertRejectsWithError(
      () => svc.requestCorrection(SOLICITANTE_A, created.permit.id, { justificativa: 'Teste' }),
      403,
      'ADMIN_ONLY_ACTION'
    );
    await assertRejectsWithError(
      () => svc.approvePermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE }),
      403,
      'ADMIN_ONLY_ACTION'
    );
    await assertRejectsWithError(
      () => svc.releasePermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE }),
      403,
      'ADMIN_ONLY_ACTION'
    );
    await assertRejectsWithError(
      () => svc.rejectPermit(SOLICITANTE_A, created.permit.id, { justificativa: 'Teste' }),
      403,
      'ADMIN_ONLY_ACTION'
    );
    await assertRejectsWithError(
      () => svc.closePermit(SOLICITANTE_A, created.permit.id),
      403,
      'ADMIN_ONLY_ACTION'
    );
  });

  // 19. Separação estrita em 2 etapas: aprovado -> liberado (proibido liberar direto)
  await runTest('19. Fluxo estrito em 2 etapas: bloqueia release direto de pendente/em_analise (409) e aprova → libera', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    const sub = await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });
    const rev = await svc.startReview(ADMIN_ACTOR, sub.permit.id, { referenceDate: REF_DATE });
    assertEqual(rev.permit.status, 'em_analise', 'Status deve avançar para em_analise');

    await assertRejectsWithError(
      () => svc.releasePermit(ADMIN_ACTOR, rev.permit.id, { referenceDate: REF_DATE }),
      409,
      'APPROVAL_REQUIRED_BEFORE_RELEASE',
      'Não pode liberar sem aprovação prévia'
    );

    const approved = await svc.approvePermit(ADMIN_ACTOR, rev.permit.id, {
      expectedVersion: rev.permit.versaoConcorrencia,
      referenceDate: REF_DATE,
    });
    assertEqual(approved.permit.status, 'aprovado', 'Etapa 1: aprovado');
    assertEqual(approved.permit.aprovadoPorId, ADMIN_ACTOR.id, 'Deve registrar aprovadoPorId');
    assert(!approved.permit.liberadoPorId, 'Aprovação não deve preencher liberadoPorId');

    const released = await svc.releasePermit(ADMIN_ACTOR, approved.permit.id, {
      expectedVersion: approved.permit.versaoConcorrencia,
      expectedComplianceFingerprint: approved.permit.complianceFingerprint,
      referenceDate: REF_DATE,
    });
    assertEqual(released.permit.status, 'liberado', 'Etapa 2: liberado');
    assertEqual(released.permit.liberadoPorId, ADMIN_ACTOR.id, 'Deve registrar liberadoPorId');
    assert(Boolean(released.permit.dataLiberacao), 'Deve registrar dataLiberacao');
  });

  // 20. Proteção de concorrência otimista: versaoConcorrencia obsoleta + alteração concorrente de documento/ASO entre aprovação e liberação
  await runTest('20. Concorrência otimista bloqueia versão obsoleta (409) e mudança de ASO/doc entre aprovação e liberação (409)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    const sub = await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    await assertRejectsWithError(
      () =>
        svc.approvePermit(ADMIN_ACTOR, sub.permit.id, {
          expectedVersion: 1,
          referenceDate: REF_DATE,
        }),
      409,
      'CONCURRENCY_VERSION_MISMATCH',
      'Versão obsoleta deve retornar 409'
    );

    const approved = await svc.approvePermit(ADMIN_ACTOR, sub.permit.id, {
      expectedVersion: sub.permit.versaoConcorrencia,
      referenceDate: REF_DATE,
    });

    // Mutação concorrente na base oficial entre aprovação e liberação: ASO passa a inapto!
    repo.dataset.exams = repo.dataset.exams.map((ex) =>
      ex.id === 'exam_aso_montador' ? { ...ex, conclusao: 'inapto' } : ex
    );

    const err = await assertRejectsWithError(
      () =>
        svc.releasePermit(ADMIN_ACTOR, approved.permit.id, {
          expectedVersion: approved.permit.versaoConcorrencia,
          expectedComplianceFingerprint: approved.permit.complianceFingerprint,
          referenceDate: REF_DATE,
        }),
      409,
      'COMPLIANCE_CONCURRENCY_CONFLICT',
      'Mudança concorrente no ASO após aprovação deve bloquear liberação com 409'
    );
    assertEqual(err.details?.blockedByCompliance, true, 'Deve sinalizar bloqueio de conformidade');
  });

  // 21. Justificativa obrigatória em request-docs, request-correction, reject e cancel + reenvio + encerramento
  await runTest('21. Justificativa obrigatória, ciclo de devolução/reenvio, reprovação, cancelamento e encerramento', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    const created = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    await svc.submitPermit(SOLICITANTE_A, created.permit.id, { referenceDate: REF_DATE });

    await assertRejectsWithError(
      () => svc.requestDocumentation(ADMIN_ACTOR, created.permit.id, { justificativa: '   ' }),
      400,
      'JUSTIFICATION_REQUIRED'
    );
    await assertRejectsWithError(
      () => svc.requestCorrection(ADMIN_ACTOR, created.permit.id, { justificativa: '' }),
      400,
      'JUSTIFICATION_REQUIRED'
    );
    await assertRejectsWithError(
      () => svc.rejectPermit(ADMIN_ACTOR, created.permit.id, { justificativa: '' }),
      400,
      'JUSTIFICATION_REQUIRED'
    );
    await assertRejectsWithError(
      () => svc.cancelPermit(SOLICITANTE_A, created.permit.id, { justificativa: '' }),
      400,
      'JUSTIFICATION_REQUIRED'
    );

    const reqDocs = await svc.requestDocumentation(ADMIN_ACTOR, created.permit.id, {
      justificativa: 'Anexar APR assinada pelo supervisor de campo',
      referenceDate: REF_DATE,
    });
    assertEqual(reqDocs.permit.status, 'pendente_documentacao', 'Deve ir para pendente_documentacao');

    const edited = await svc.updatePermitDraft(
      SOLICITANTE_A,
      created.permit.id,
      { observacoes: 'APR assinada anexada conforme solicitado' },
      REF_DATE
    );
    assertEqual(
      edited.permit.observacoes,
      'APR assinada anexada conforme solicitado',
      'Edição permitida em pendente_documentacao'
    );

    const resubmitted = await svc.submitPermit(SOLICITANTE_A, created.permit.id, {
      referenceDate: REF_DATE,
    });
    assertEqual(resubmitted.permit.status, 'pendente_liberacao', 'Reenvio deve voltar para pendente_liberacao');

    const approved = await svc.approvePermit(ADMIN_ACTOR, created.permit.id, {
      referenceDate: REF_DATE,
    });
    const released = await svc.releasePermit(ADMIN_ACTOR, created.permit.id, {
      expectedComplianceFingerprint: approved.permit.complianceFingerprint,
      referenceDate: REF_DATE,
    });
    const closed = await svc.closePermit(ADMIN_ACTOR, released.permit.id, {
      justificativa: 'Serviço finalizado sem desvios de segurança',
    });
    assertEqual(closed.status, 'encerrado', 'Deve encerrar atividade liberada');

    const draft2 = await svc.createPermitDraft(SOLICITANTE_A, baseDraftPayload(), REF_DATE);
    const canceled = await svc.cancelPermit(SOLICITANTE_A, draft2.permit.id, {
      justificativa: 'Serviço reagendado pela manutenção',
    });
    assertEqual(canceled.status, 'cancelado', 'Solicitante pode cancelar rascunho com justificativa');
  });

  // 22. Retrocompatibilidade com SafetyPermit legado + Proteção real das rotas Express /api/permits/*
  await runTest('22. Retrocompatibilidade com SafetyPermit legado (em_execucao) + Rotas Express fail-closed (401)', async () => {
    const repo = createInMemoryPermitRepository(buildBaseDataset());
    const svc = new PermitWorkflowService(repo);

    const legacyEval = await svc.evaluatePermit(ADMIN_ACTOR, 'permit_legado_1', REF_DATE);
    assertEqual(legacyEval.permit.status, 'em_execucao', 'Deve ler permit legado');
    assertEqual(
      legacyEval.compliance.podeLiberar,
      false,
      'Permit legado sem atividades vinculadas não presume liberação'
    );

    const legacyClosed = await svc.closePermit(ADMIN_ACTOR, 'permit_legado_1', {
      justificativa: 'Encerramento de PT legada',
    });
    assertEqual(legacyClosed.status, 'encerrado', 'Deve encerrar permit legado com segurança');

    process.env.API_AUTH_SECRET =
      process.env.API_AUTH_SECRET || 'test-secret-ehs-more-permit-workflow-2026-secure';

    const app = createApiApp({ permitWorkflowService: svc });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const r1 = await fetch(`${baseUrl}/api/permits`);
      assertEqual(r1.status, 401, 'GET /api/permits sem Bearer token deve retornar 401');

      const r2 = await fetch(`${baseUrl}/api/permits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseDraftPayload()),
      });
      assertEqual(r2.status, 401, 'POST /api/permits sem Bearer token deve retornar 401');

      const r3 = await fetch(`${baseUrl}/api/permits/permit_legado_1/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid.jwt.token',
        },
        body: JSON.stringify({}),
      });
      assertEqual(r3.status, 401, 'POST /api/permits/:id/approve com token inválido deve retornar 401');

      const r4 = await fetch(`${baseUrl}/api/permits/permit_legado_1`, {
        method: 'DELETE',
      });
      assertEqual(r4.status, 401, 'DELETE /api/permits/:id sem auth deve retornar 401 (nunca 200)');

      const r5 = await fetch(`${baseUrl}/.netlify/functions/api/permits`);
      assertEqual(
        r5.status,
        401,
        'Rota normalizada Netlify /.netlify/functions/api/permits deve rotear para /api/permits (401, não 404)'
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  console.log(`\nResumo Permit Workflow: ${passed} aprovado(s), ${failed} falhou(ram).\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro fatal na execução da suíte permitWorkflow.test.ts:', err);
  process.exit(1);
});
