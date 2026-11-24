import {
  buildComplianceSnapshot,
  evaluateActivityCompliance,
} from '../src/utils/activityComplianceEngine.ts';
import {
  buildActivityProfilePayloadFromTemplate,
  buildRequirementsPayloadFromTemplate,
  INITIAL_ACTIVITY_TEMPLATES,
} from '../src/utils/activityTemplates.ts';
import type {
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
} from '../src/types/sst.ts';

// Runner minimalista sem dependências externas (100% compatível com tsc --noEmit e npx tsx)
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

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// FIXTURES BASE (EXCLUSIVAMENTE EMPRESAS CONTRATADAS E TERCEIRIZADOS)
// ============================================================================

const ADMIN_ACTOR = { id: 'user-452.066.308-37', nome: 'Admin EHS' };
const EFFECTIVE_DATE = '2026-11-23';

const activityProfiles: ActivityProfile[] = [];
const allRequirements: ActivityDocumentRequirement[] = [];

for (const tpl of INITIAL_ACTIVITY_TEMPLATES) {
  const actId = `act_${tpl.codigo.toLowerCase()}`;
  activityProfiles.push({
    id: actId,
    ...buildActivityProfilePayloadFromTemplate(tpl, ADMIN_ACTOR, '2026-11-01T10:00:00.000Z'),
  });
  const reqs = buildRequirementsPayloadFromTemplate(
    tpl,
    actId,
    ADMIN_ACTOR,
    '2026-11-01T10:00:00.000Z'
  );
  reqs.forEach((r, idx) => {
    allRequirements.push({
      id: `req_${tpl.codigo.toLowerCase()}_${idx + 1}`,
      ...r,
    });
  });
}

const ACT_ALTURA = 'act_trabalho_altura';
const ACT_CONFINADO = 'act_espaco_confinado';
const ACT_ELETRICA = 'act_servicos_eletricos';
const ACT_QUENTE = 'act_trabalho_quente';
const ACT_ESCAVACAO = 'act_escavacao';

const baseCompany: Company = {
  id: 'comp_1',
  razaoSocial: 'Montagens Industriais Alfa Ltda',
  nomeFantasia: 'Alfa Montagens',
  cnpj: '12.345.678/0001-90',
  responsavelLegal: 'Carlos Silva',
  responsavelSST: 'Ana Souza',
  telefone: '11999990000',
  email: 'sst@alfa.com.br',
  endereco: 'Av. Industrial, 100',
  unidadeAtendimento: 'Planta SP',
  atividadeContratada: 'Manutenção industrial terceirizada',
  dataInicioContrato: '2026-01-01',
  dataTerminoContrato: '2027-12-31',
  contrato_indeterminado: false,
  situacao: 'ativa',
};

const empMontador: Employee = {
  id: 'emp_1',
  empresaId: 'comp_1',
  empresaNome: baseCompany.razaoSocial,
  nomeCompleto: 'João Pereira',
  cpf: '111.222.333-44',
  cargo: 'Montador Industrial',
  setor: 'Manutenção',
  situacaoCadastral: 'ativo',
};

const empSupervisor: Employee = {
  id: 'emp_2',
  empresaId: 'comp_1',
  empresaNome: baseCompany.razaoSocial,
  nomeCompleto: 'Marcos Oliveira',
  cpf: '222.333.444-55',
  cargo: 'Supervisor de Entrada',
  setor: 'Operações Críticas',
  situacaoCadastral: 'ativo',
};

const empEletricistaComum: Employee = {
  id: 'emp_3',
  empresaId: 'comp_1',
  empresaNome: baseCompany.razaoSocial,
  nomeCompleto: 'Lucas Fernandes',
  cpf: '333.444.555-66',
  cargo: 'Eletricista de Manutenção',
  setor: 'Elétrica',
  situacaoCadastral: 'ativo',
};

const empEletricistaSep: Employee = {
  id: 'emp_4',
  empresaId: 'comp_1',
  empresaNome: baseCompany.razaoSocial,
  nomeCompleto: 'Rafael Costa',
  cpf: '444.555.666-77',
  cargo: 'Eletricista SEP Alta Tensão',
  setor: 'Subestação',
  situacaoCadastral: 'ativo',
};

const empSoldador: Employee = {
  id: 'emp_5',
  empresaId: 'comp_1',
  empresaNome: baseCompany.razaoSocial,
  nomeCompleto: 'Diego Santos',
  cpf: '555.666.777-88',
  cargo: 'Soldador',
  setor: 'Caldeiraria',
  situacaoCadastral: 'ativo',
};

const empAjudante: Employee = {
  id: 'emp_6',
  empresaId: 'comp_1',
  empresaNome: baseCompany.razaoSocial,
  nomeCompleto: 'Pedro Lima',
  cpf: '666.777.888-99',
  cargo: 'Ajudante Geral',
  setor: 'Apoio',
  situacaoCadastral: 'ativo',
};

const allEmployees = [
  empMontador,
  empSupervisor,
  empEletricistaComum,
  empEletricistaSep,
  empSoldador,
  empAjudante,
];

function makeCompanyDocs(extra: DocumentSST[] = []): DocumentSST[] {
  return [
    {
      id: 'doc_pgr',
      nomeDocumento: 'PGR 2026',
      tipoDocumentoCanonico: 'PGR',
      categoria: 'Documento Empresarial',
      empresaId: 'comp_1',
      empresaNome: baseCompany.razaoSocial,
      dataEmissao: '2026-01-10',
      dataValidade: '2027-06-30',
      responsavelEnvio: 'Ana Souza',
      arquivoUrl: 'data:application/pdf;base64,AAA',
      arquivoNome: 'pgr.pdf',
      situacao: 'aprovado',
      versao: 1,
    },
    {
      id: 'doc_pcmso',
      nomeDocumento: 'PCMSO 2026',
      tipoDocumentoCanonico: 'PCMSO',
      categoria: 'Documento Empresarial',
      empresaId: 'comp_1',
      empresaNome: baseCompany.razaoSocial,
      dataEmissao: '2026-01-10',
      dataValidade: '2027-06-30',
      responsavelEnvio: 'Ana Souza',
      arquivoUrl: 'data:application/pdf;base64,AAA',
      arquivoNome: 'pcmso.pdf',
      situacao: 'aprovado',
      versao: 1,
    },
    ...extra,
  ];
}

function makePermits(types: Array<'APR' | 'PT' | 'LOTO'>): SafetyPermit[] {
  return types.map((tipo, idx) => ({
    id: `perm_${tipo}_${idx}`,
    tipo,
    titulo: `${tipo} Atividade Terceirizada`,
    empresaId: 'comp_1',
    empresaNome: baseCompany.razaoSocial,
    localTrabalho: 'Galpão B',
    dataInicio: '2026-11-20',
    dataFim: '2026-11-30',
    responsavelEmissao: 'Admin EHS',
    riscosIdentificados: 'Riscos mapeados',
    medidasPreventivas: 'Controles aplicados',
    status: 'aprovado',
  }));
}

console.log('\nExecutando suíte de testes — Motor de Conformidade por Atividade (Etapa 2)\n');

// ============================================================================
// 1. TRABALHO EM ALTURA — NR-35
// ============================================================================
test('1. Trabalho em Altura (NR-35) — conformidade total libera execução', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [
      {
        id: 'trn_nr35',
        nomeTreinamento: 'NR-35 Trabalho em Altura',
        tipoDocumentoCanonico: 'NR-35',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-02-01',
        dataValidade: '2028-02-01',
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_1',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['trabalho_altura'],
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-05-01',
        dataValidade: '2027-05-01',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_1',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        nomeEpi: 'Cinto Paraquedista com Talabarte Duplo',
        caNumero: '38451',
        dataEntrega: '2026-10-01',
        quantidade: 1,
        responsavelEntrega: 'Almoxarifado',
      },
    ],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(result.podeLiberar, true, 'NR-35 completo deve permitir liberação');
  assertEqual(result.statusGeral, 'conforme', 'Status geral deve ser conforme');
  assertEqual(result.resumo.bloqueiosObrigatorios, 0, 'Zero bloqueios obrigatórios');
  assertEqual(result.colaboradores[0].aptoParaExecucao, true, 'Colaborador apto');

  const snapshot = buildComplianceSnapshot(result);
  assertEqual(snapshot.podeLiberar, true, 'Snapshot deve refletir liberação');
});

// ============================================================================
// 2. ESPAÇO CONFINADO — NR-33
// ============================================================================
test('2. Espaço Confinado (NR-33) — exige NR-33, PET, ASO espaço confinado e NR-33 Supervisor apenas para supervisor', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_CONFINADO],
    colaboradorIds: [empMontador.id, empSupervisor.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs([
      {
        id: 'doc_pet',
        nomeDocumento: 'PET Espaço Confinado Tanque 02',
        tipoDocumentoCanonico: 'PET',
        categoria: 'Outros',
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataEmissao: '2026-11-22',
        dataValidade: '2027-01-30',
        responsavelEnvio: 'Ana Souza',
        arquivoUrl: 'data:application/pdf;base64,AAA',
        arquivoNome: 'pet.pdf',
        situacao: 'aprovado',
        versao: 1,
      },
    ]),
    trainings: [
      {
        id: 'trn_nr33_1',
        nomeTreinamento: 'NR-33 Trabalhador Autorizado',
        tipoDocumentoCanonico: 'NR-33',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-06-01',
        dataValidade: '2027-06-01',
        situacao: 'aprovado',
      },
      {
        id: 'trn_nr33_2',
        nomeTreinamento: 'NR-33 Trabalhador Autorizado',
        tipoDocumentoCanonico: 'NR-33',
        colaboradorId: empSupervisor.id,
        colaboradorNome: empSupervisor.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-06-01',
        dataValidade: '2027-06-01',
        situacao: 'aprovado',
      },
      {
        id: 'trn_nr33_sup',
        nomeTreinamento: 'NR-33 Supervisor de Entrada 40h',
        tipoDocumentoCanonico: 'NR-33-SUPERVISOR',
        colaboradorId: empSupervisor.id,
        colaboradorNome: empSupervisor.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-06-01',
        dataValidade: '2027-06-01',
        situacao: 'aprovado',
      },
    ],
    exams: [empMontador, empSupervisor].map((emp) => ({
      id: `aso_ec_${emp.id}`,
      tipoExame: 'ASO Periódico',
      tipoDocumentoCanonico: 'ASO',
      aptidoesEspecificas: ['espaco_confinado'],
      colaboradorId: emp.id,
      colaboradorNome: emp.nomeCompleto,
      empresaId: 'comp_1',
      empresaNome: baseCompany.razaoSocial,
      dataRealizacao: '2026-06-01',
      dataValidade: '2027-06-01',
      conclusao: 'apto',
      situacao: 'aprovado',
    })),
    epiDeliveries: [],
    safetyPermits: makePermits(['APR']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(result.podeLiberar, true, 'Espaço Confinado completo deve liberar');
  const montadorSummary = result.colaboradores.find((c) => c.colaboradorId === empMontador.id)!;
  const supSummary = result.colaboradores.find((c) => c.colaboradorId === empSupervisor.id)!;
  assert(
    !montadorSummary.itens.some((i) => i.documentoCodigoCanonico === 'NR-33-SUPERVISOR'),
    'Montador não deve receber requisito de Supervisor de Entrada'
  );
  assert(
    supSummary.itens.some((i) => i.documentoCodigoCanonico === 'NR-33-SUPERVISOR' && i.status === 'CONFORME'),
    'Supervisor de Entrada deve ter NR-33-SUPERVISOR validado'
  );
});

// ============================================================================
// 3. SERVIÇOS ELÉTRICOS — NR-10
// ============================================================================
test('3. Serviços Elétricos (NR-10) — exige NR-10, LOTO, PT, ASO eletricidade e EPI dielétrico', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ELETRICA],
    colaboradorIds: [empEletricistaComum.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [
      {
        id: 'trn_nr10',
        nomeTreinamento: 'NR-10 Básico 40h',
        tipoDocumentoCanonico: 'NR-10',
        colaboradorId: empEletricistaComum.id,
        colaboradorNome: empEletricistaComum.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-03-01',
        dataValidade: '2028-03-01',
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_elet',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['eletricidade'],
        colaboradorId: empEletricistaComum.id,
        colaboradorNome: empEletricistaComum.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-04-01',
        dataValidade: '2027-04-01',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_elet',
        colaboradorId: empEletricistaComum.id,
        colaboradorNome: empEletricistaComum.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        nomeEpi: 'Luva Isolante Classe 0 + Vestimenta RF ATPV',
        caNumero: '44210',
        dataEntrega: '2026-09-10',
        quantidade: 1,
        responsavelEntrega: 'SESMT',
      },
    ],
    safetyPermits: makePermits(['PT', 'LOTO']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(result.podeLiberar, true, 'Serviços Elétricos NR-10 completo deve liberar');
  assertEqual(result.statusGeral, 'conforme', 'Status deve ser conforme');
});

// ============================================================================
// 4. TRABALHO A QUENTE
// ============================================================================
test('4. Trabalho a Quente — valida NR-23, capacitação solda para soldador, EPI raspa/máscara e PT', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_QUENTE],
    colaboradorIds: [empSoldador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [
      {
        id: 'trn_nr23',
        nomeTreinamento: 'NR-23 Prevenção e Combate a Incêndio',
        tipoDocumentoCanonico: 'NR-23',
        colaboradorId: empSoldador.id,
        colaboradorNome: empSoldador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-08-01',
        dataValidade: '2027-08-01',
        situacao: 'aprovado',
      },
      {
        id: 'trn_solda',
        nomeTreinamento: 'Capacitação em Operações de Soldagem e Corte a Quente',
        tipoDocumentoCanonico: 'TRABALHO_QUENTE_CAPACITACAO',
        colaboradorId: empSoldador.id,
        colaboradorNome: empSoldador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-08-01',
        dataValidade: '2028-08-01',
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_solda',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        colaboradorId: empSoldador.id,
        colaboradorNome: empSoldador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-08-01',
        dataValidade: '2027-08-01',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_solda',
        colaboradorId: empSoldador.id,
        colaboradorNome: empSoldador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        nomeEpi: 'Máscara de Solda Auto-escurecimento + Avental Raspa',
        caNumero: '29110',
        dataEntrega: '2026-10-15',
        quantidade: 1,
        responsavelEntrega: 'Almoxarifado',
      },
    ],
    safetyPermits: makePermits(['PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(result.podeLiberar, true, 'Trabalho a Quente completo deve liberar');
});

// ============================================================================
// 5. ESCAVAÇÃO
// ============================================================================
test('5. Escavação — exige NR-18, Mapa de Interferências Subterrâneas, ART de Escoramento, EPI e PT', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ESCAVACAO],
    colaboradorIds: [empAjudante.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs([
      {
        id: 'doc_sondagem',
        nomeDocumento: 'Mapa de Interferências Subterrâneas Área Sul',
        tipoDocumentoCanonico: 'SONDAGEM_INTERFERENCIAS',
        categoria: 'Documento Empresarial',
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataEmissao: '2026-11-15',
        semValidade: true,
        responsavelEnvio: 'Engenharia',
        arquivoUrl: 'data:application/pdf;base64,AAA',
        arquivoNome: 'sondagem.pdf',
        situacao: 'aprovado',
        versao: 1,
      },
      {
        id: 'doc_art',
        nomeDocumento: 'ART Escoramento Vala 2,5m CREA-SP',
        tipoDocumentoCanonico: 'ART_ESCORAMENTO',
        categoria: 'Documento Empresarial',
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataEmissao: '2026-11-15',
        dataValidade: '2027-05-15',
        responsavelEnvio: 'Eng. Civil',
        arquivoUrl: 'data:application/pdf;base64,AAA',
        arquivoNome: 'art.pdf',
        situacao: 'aprovado',
        versao: 1,
      },
    ]),
    trainings: [
      {
        id: 'trn_nr18',
        nomeTreinamento: 'NR-18 Segurança em Escavações',
        tipoDocumentoCanonico: 'NR-18',
        colaboradorId: empAjudante.id,
        colaboradorNome: empAjudante.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-04-10',
        dataValidade: '2028-04-10',
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_esc',
        tipoExame: 'ASO Admissional',
        tipoDocumentoCanonico: 'ASO',
        colaboradorId: empAjudante.id,
        colaboradorNome: empAjudante.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-04-10',
        dataValidade: '2027-04-10',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_esc',
        colaboradorId: empAjudante.id,
        colaboradorNome: empAjudante.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        nomeEpi: 'Capacete + Botina Biqueira + Colete Refletivo',
        caNumero: '31002',
        dataEntrega: '2026-10-01',
        quantidade: 1,
        responsavelEntrega: 'Almoxarifado',
      },
    ],
    safetyPermits: makePermits(['PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(result.podeLiberar, true, 'Escavação completa deve liberar');
});

// ============================================================================
// 6. COMBINAÇÃO DE ATIVIDADES SEM DUPLICIDADE
// ============================================================================
test('6. Combinação de atividades (Altura + Trabalho a Quente) — unifica PGR/PCMSO/PT/ASO sem duplicar', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA, ACT_QUENTE],
    colaboradorIds: [empSoldador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [],
    exams: [],
    epiDeliveries: [],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  // PGR e PCMSO devem aparecer apenas 1 vez cada nos itens da empresa
  const pgrItems = result.itensEmpresa.filter((i) => i.documentoCodigoCanonico === 'PGR');
  const pcmsoItems = result.itensEmpresa.filter((i) => i.documentoCodigoCanonico === 'PCMSO');
  const ptItems = result.itensAtividade.filter((i) => i.documentoCodigoCanonico === 'PT');

  assertEqual(pgrItems.length, 1, 'PGR não pode ser duplicado em atividades combinadas');
  assertEqual(pcmsoItems.length, 1, 'PCMSO não pode ser duplicado em atividades combinadas');
  assertEqual(ptItems.length, 1, 'PT não pode ser duplicada em atividades combinadas');

  // Para o soldador: ASO genérico do Trabalho a Quente deve ser absorvido pelo ASO com aptidão trabalho_altura
  const empItems = result.colaboradores[0].itens;
  const asoItems = empItems.filter((i) => i.documentoCodigoCanonico === 'ASO');
  assertEqual(asoItems.length, 1, 'ASO genérico deve ser absorvido pelo ASO mais restritivo (altura)');

  // Deve exigir tanto NR-35 quanto NR-23 e capacitação de solda
  assert(
    empItems.some((i) => i.documentoCodigoCanonico === 'NR-35'),
    'Deve exigir NR-35'
  );
  assert(
    empItems.some((i) => i.documentoCodigoCanonico === 'NR-23'),
    'Deve exigir NR-23'
  );
  assert(
    empItems.some((i) => i.documentoCodigoCanonico === 'TRABALHO_QUENTE_CAPACITACAO'),
    'Deve exigir capacitação de soldagem para Soldador'
  );
});

// ============================================================================
// 7. FILTRO POR FUNÇÃO / CARGO
// ============================================================================
test('7. Filtro por função — Eletricista SEP exige NR-10-SEP; Eletricista comum não exige', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ELETRICA],
    colaboradorIds: [empEletricistaComum.id, empEletricistaSep.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [empEletricistaComum, empEletricistaSep].map((emp) => ({
      id: `trn_nr10_${emp.id}`,
      nomeTreinamento: 'NR-10 Básico',
      tipoDocumentoCanonico: 'NR-10',
      colaboradorId: emp.id,
      colaboradorNome: emp.nomeCompleto,
      empresaId: 'comp_1',
      empresaNome: baseCompany.razaoSocial,
      dataRealizacao: '2026-03-01',
      dataValidade: '2028-03-01',
      situacao: 'aprovado',
    })),
    exams: [empEletricistaComum, empEletricistaSep].map((emp) => ({
      id: `aso_e_${emp.id}`,
      tipoExame: 'ASO Periódico',
      tipoDocumentoCanonico: 'ASO',
      aptidoesEspecificas: ['eletricidade'],
      colaboradorId: emp.id,
      colaboradorNome: emp.nomeCompleto,
      empresaId: 'comp_1',
      empresaNome: baseCompany.razaoSocial,
      dataRealizacao: '2026-04-01',
      dataValidade: '2027-04-01',
      conclusao: 'apto',
      situacao: 'aprovado',
    })),
    epiDeliveries: [empEletricistaComum, empEletricistaSep].map((emp) => ({
      id: `epi_e_${emp.id}`,
      colaboradorId: emp.id,
      colaboradorNome: emp.nomeCompleto,
      empresaId: 'comp_1',
      empresaNome: baseCompany.razaoSocial,
      nomeEpi: 'Luva Isolante Dielétrica',
      caNumero: '44210',
      dataEntrega: '2026-09-01',
      quantidade: 1,
      responsavelEntrega: 'SESMT',
    })),
    safetyPermits: makePermits(['PT', 'LOTO']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  const comum = result.colaboradores.find((c) => c.colaboradorId === empEletricistaComum.id)!;
  const sep = result.colaboradores.find((c) => c.colaboradorId === empEletricistaSep.id)!;

  assertEqual(comum.aptoParaExecucao, true, 'Eletricista comum não deve exigir NR-10-SEP');
  assertEqual(sep.aptoParaExecucao, false, 'Eletricista SEP sem NR-10-SEP deve ser bloqueado');
  assert(
    sep.itens.some((i) => i.documentoCodigoCanonico === 'NR-10-SEP' && i.status === 'AUSENTE'),
    'Deve acusar NR-10-SEP AUSENTE para Eletricista SEP'
  );
  assertEqual(result.podeLiberar, false, 'Equipe com 1 integrante bloqueado deve impedir liberação');
});

// ============================================================================
// 8. ASO INAPTO E INCOMPATIBILIDADE DE APTIDÃO ESPECÍFICA
// ============================================================================
test('8. ASO inapto (conclusão inapto e ASO sem aptidão específica para altura) — retorna ASO_INAPTO e bloqueia', () => {
  const resInapto = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [],
    exams: [
      {
        id: 'aso_inapto',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['trabalho_altura'],
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-09-01',
        dataValidade: '2027-09-01',
        conclusao: 'inapto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  const asoItem1 = resInapto.colaboradores[0].itens.find((i) => i.documentoCodigoCanonico === 'ASO')!;
  assertEqual(asoItem1.status, 'ASO_INAPTO', 'Conclusão inapto deve retornar ASO_INAPTO');
  assertEqual(asoItem1.bloqueante, true, 'ASO_INAPTO deve ser bloqueante');

  // Caso B: ASO concluído como APTO, porém SEM aptidão para trabalho em altura
  const resSemAptidao = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [],
    exams: [
      {
        id: 'aso_sem_altura',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['eletricidade'],
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-09-01',
        dataValidade: '2027-09-01',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  const asoItem2 = resSemAptidao.colaboradores[0].itens.find((i) => i.documentoCodigoCanonico === 'ASO')!;
  assertEqual(
    asoItem2.status,
    'ASO_INAPTO',
    'ASO sem aptidão específica exigida (trabalho_altura) não deve presumir conformidade'
  );
  assertEqual(resSemAptidao.podeLiberar, false, 'Deve bloquear liberação');
});

// ============================================================================
// 9. DOCUMENTO VENCIDO (CONSIDERANDO DATA EFETIVA DA ATIVIDADE)
// ============================================================================
test('9. Documento vencido na data efetiva futura da atividade — retorna VENCIDO e bloqueia', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [
      {
        id: 'trn_nr35_exp',
        nomeTreinamento: 'NR-35 Trabalho em Altura',
        tipoDocumentoCanonico: 'NR-35',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2024-12-01',
        dataValidade: '2026-12-01', // Válido em 2026-11-23, mas vencido na data da atividade 2026-12-10
        situacao: 'aprovado',
      },
    ],
    exams: [],
    epiDeliveries: [],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: '2026-12-10',
  });

  const nr35Item = result.colaboradores[0].itens.find((i) => i.documentoCodigoCanonico === 'NR-35')!;
  assertEqual(nr35Item.status, 'VENCIDO', 'NR-35 vencido na data efetiva da atividade deve ser VENCIDO');
  assertEqual(nr35Item.bloqueante, true, 'Documento vencido deve bloquear');
  assertEqual(result.podeLiberar, false, 'Liberação deve ser bloqueada');
});

// ============================================================================
// 10. DOCUMENTO AGUARDANDO APROVAÇÃO NO EHS SMARTDOCS
// ============================================================================
test('10. Documento pendente no EHS SmartDocs — retorna PENDENTE_APROVACAO e NÃO libera atividade', () => {
  const pendingSmartDoc: SmartDocRecord = {
    id: 'sd_nr35_pending',
    arquivoNome: 'Certificado_NR35_Joao.pdf',
    arquivoMimeType: 'application/pdf',
    arquivoTamanhoBytes: 120000,
    arquivoHashSha256: 'abc123',
    categoriaGrupo: 'treinamentos',
    tipoDocumento: 'NR-35',
    classificacaoManual: false,
    classificacaoConfianca: 0.96,
    status: 'PENDENTE_APROVACAO',
    statusValidade: 'PENDENTE_APROVACAO',
    empresaId: 'comp_1',
    empresaNome: baseCompany.razaoSocial,
    colaboradorId: empMontador.id,
    colaboradorNome: empMontador.nomeCompleto,
    dadosExtraidos: {
      nomeTreinamento: 'NR-35 Trabalho em Altura',
      nrCorrespondente: 'NR-35',
      dataRealizacao: '2026-11-10',
      dataValidade: '2028-11-10',
    },
    camposNaoIdentificados: [],
    inconsistencias: [],
    isSensitiveMedical: false,
    enviadoPorId: 'solicitante_1',
    enviadoPorNome: 'Responsável Alfa',
    enviadoPorEmail: 'sst@alfa.com.br',
    dataEnvio: '2026-11-22T12:00:00.000Z',
    historico: [],
    createdAt: '2026-11-22T12:00:00.000Z',
    updatedAt: '2026-11-22T12:00:00.000Z',
  };

  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [],
    exams: [
      {
        id: 'aso_ok',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['trabalho_altura'],
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-05-01',
        dataValidade: '2027-05-01',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_ok',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        nomeEpi: 'Cinto Paraquedista',
        caNumero: '38451',
        dataEntrega: '2026-10-01',
        quantidade: 1,
        responsavelEntrega: 'SESMT',
      },
    ],
    safetyPermits: makePermits(['APR', 'PT']),
    smartDocs: [pendingSmartDoc],
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  const nr35Item = result.colaboradores[0].itens.find((i) => i.documentoCodigoCanonico === 'NR-35')!;
  assertEqual(nr35Item.status, 'PENDENTE_APROVACAO', 'SmartDoc pendente deve retornar PENDENTE_APROVACAO');
  assertEqual(nr35Item.pendenteSmartDocId, 'sd_nr35_pending', 'Deve vincular ID do SmartDoc pendente');
  assertEqual(nr35Item.bloqueante, true, 'SmartDoc não aprovado deve bloquear liberação');
  assertEqual(result.podeLiberar, false, 'Nunca liberar atividade com documento pendente no SmartDocs');
});

// ============================================================================
// 11. DOCUMENTO AUSENTE
// ============================================================================
test('11. Documento ausente — retorna AUSENTE e bloqueia liberação', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: [], // PGR e PCMSO ausentes
    trainings: [],
    exams: [],
    epiDeliveries: [],
    safetyPermits: [],
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(result.podeLiberar, false, 'Ausência de documentos obrigatórios bloqueia liberação');
  assertEqual(result.statusGeral, 'bloqueado', 'Status geral deve ser bloqueado');
  assert(result.resumo.ausentes >= 6, 'Deve contabilizar os requisitos obrigatórios ausentes');
  assert(
    result.itensEmpresa.every((i) => i.status === 'AUSENTE' && i.bloqueante),
    'PGR e PCMSO devem constar como AUSENTE e bloqueantes'
  );
});

// ============================================================================
// 12. CONTRATO INDETERMINADO
// ============================================================================
test('12. Contrato indeterminado — considerado vigente mesmo sem dataTerminoContrato; contrato vencido bloqueia', () => {
  const indeterminateCompany: Company = {
    ...baseCompany,
    dataTerminoContrato: '',
    contrato_indeterminado: true,
  };

  const resIndeterminate = evaluateActivityCompliance({
    company: indeterminateCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [
      {
        id: 'trn_ok',
        nomeTreinamento: 'NR-35',
        tipoDocumentoCanonico: 'NR-35',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: indeterminateCompany.razaoSocial,
        dataRealizacao: '2026-01-01',
        dataValidade: '2028-01-01',
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_ok',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['trabalho_altura'],
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: indeterminateCompany.razaoSocial,
        dataRealizacao: '2026-05-01',
        dataValidade: '2027-05-01',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_ok',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: indeterminateCompany.razaoSocial,
        nomeEpi: 'Cinto Paraquedista',
        caNumero: '38451',
        dataEntrega: '2026-10-01',
        quantidade: 1,
        responsavelEntrega: 'SESMT',
      },
    ],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(resIndeterminate.contratoIndeterminado, true, 'Deve reconhecer contrato indeterminado');
  assertEqual(resIndeterminate.contratoVigente, true, 'Contrato indeterminado deve ser vigente');
  assertEqual(resIndeterminate.podeLiberar, true, 'Deve permitir liberação com contrato indeterminado');

  // Contrato comum vencido deve bloquear mesmo com documentos ok
  const expiredCompany: Company = {
    ...baseCompany,
    contrato_indeterminado: false,
    dataTerminoContrato: '2026-10-01',
  };
  const resExpired = evaluateActivityCompliance({
    company: expiredCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [
      {
        id: 'trn_ok',
        nomeTreinamento: 'NR-35',
        tipoDocumentoCanonico: 'NR-35',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: expiredCompany.razaoSocial,
        dataRealizacao: '2026-01-01',
        dataValidade: '2028-01-01',
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_ok',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['trabalho_altura'],
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: expiredCompany.razaoSocial,
        dataRealizacao: '2026-05-01',
        dataValidade: '2027-05-01',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_ok',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: expiredCompany.razaoSocial,
        nomeEpi: 'Cinto Paraquedista',
        caNumero: '38451',
        dataEntrega: '2026-10-01',
        quantidade: 1,
        responsavelEntrega: 'SESMT',
      },
    ],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(resExpired.contratoVigente, false, 'Contrato vencido não pode ser vigente');
  assertEqual(resExpired.podeLiberar, false, 'Contrato vencido deve bloquear liberação');
});

// ============================================================================
// 13. DOCUMENTO A VENCER (ATÉ 30 DIAS)
// ============================================================================
test('13. Documento a vencer (<= 30 dias) — retorna A_VENCER, statusGeral atencao, ainda libera', () => {
  const result = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [
      {
        id: 'trn_nr35_soon',
        nomeTreinamento: 'NR-35 Trabalho em Altura',
        tipoDocumentoCanonico: 'NR-35',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2024-12-10',
        dataValidade: '2026-12-10', // 17 dias após 2026-11-23
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_ok',
        tipoExame: 'ASO Periódico',
        tipoDocumentoCanonico: 'ASO',
        aptidoesEspecificas: ['trabalho_altura'],
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-05-01',
        dataValidade: '2027-05-01',
        conclusao: 'apto',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_ok',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        nomeEpi: 'Cinto Paraquedista',
        caNumero: '38451',
        dataEntrega: '2026-10-01',
        quantidade: 1,
        responsavelEntrega: 'SESMT',
      },
    ],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  const nr35Item = result.colaboradores[0].itens.find((i) => i.documentoCodigoCanonico === 'NR-35')!;
  assertEqual(nr35Item.status, 'A_VENCER', 'Vencimento em 17 dias deve retornar A_VENCER');
  assertEqual(nr35Item.bloqueante, false, 'Documento a vencer ainda é válido e não bloqueia');
  assertEqual(result.podeLiberar, true, 'Deve permitir liberação com alerta');
  assertEqual(result.statusGeral, 'atencao', 'Status geral deve ser atencao');
  assertEqual(result.resumo.alertasAVencer, 1, 'Deve registrar 1 alerta a vencer');
});

// ============================================================================
// 14. DOCUMENTOS ANTIGOS COM NOMES DIFERENTES + ANTI-AMBIGUIDADE
// ============================================================================
test('14. Documentos legados sem tipoDocumentoCanonico — reconhece variações legítimas e rejeita ambíguos', () => {
  // Parte A: Nomes livres antigos válidos (sem tipoDocumentoCanonico)
  const legacyResult = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: [
      {
        id: 'doc_legacy_pgr',
        nomeDocumento: 'Programa de Gerenciamento de Riscos - Revisão 2026',
        categoria: 'Documento Empresarial',
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataValidade: '2027-06-30',
        responsavelEnvio: 'Ana Souza',
        arquivoUrl: 'data:application/pdf;base64,AAA',
        arquivoNome: 'pgr_rev2026.pdf',
        situacao: 'aprovado',
        versao: 1,
      },
      {
        id: 'doc_legacy_pcmso',
        nomeDocumento: 'Programa de Controle Médico de Saúde Ocupacional 2026',
        categoria: 'Documento Empresarial',
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataValidade: '2027-06-30',
        responsavelEnvio: 'Ana Souza',
        arquivoUrl: 'data:application/pdf;base64,AAA',
        arquivoNome: 'pcmso_2026.pdf',
        situacao: 'aprovado',
        versao: 1,
      },
    ],
    trainings: [
      {
        id: 'trn_legacy_nr35',
        nomeTreinamento: 'Curso Capacitação Trabalho em Altura (NR 35) Reciclagem',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-01-15',
        dataValidade: '2028-01-15',
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_legacy',
        tipoExame: 'ASO Periódico',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-04-01',
        dataValidade: '2027-04-01',
        conclusao: 'apto',
        observacoes: 'Colaborador apto para trabalho em altura conforme NR-35.',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_legacy',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        nomeEpi: 'Cinturão Paraquedista 5 pontos',
        caNumero: '38451',
        dataEntrega: '2026-09-10',
        quantidade: 1,
        responsavelEntrega: 'Almoxarifado',
      },
    ],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  assertEqual(legacyResult.podeLiberar, true, 'Documentos legados inequívocos devem ser reconhecidos');

  // Parte B: Documentos ambíguos / incorretos NÃO podem satisfazer os requisitos
  const ambiguousResult = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: makeCompanyDocs(),
    trainings: [
      {
        id: 'trn_wrong_nr12',
        nomeTreinamento: 'NR-12 Segurança em Máquinas em Altura Operacional',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-01-15',
        dataValidade: '2028-01-15',
        situacao: 'aprovado',
      },
    ],
    exams: [
      {
        id: 'aso_demissional',
        tipoExame: 'ASO Demissional',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataRealizacao: '2026-04-01',
        dataValidade: '2027-04-01',
        conclusao: 'apto',
        observacoes: 'Trabalho em altura',
        situacao: 'aprovado',
      },
    ],
    epiDeliveries: [
      {
        id: 'epi_protetor_auricular',
        colaboradorId: empMontador.id,
        colaboradorNome: empMontador.nomeCompleto,
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        nomeEpi: 'Protetor Auricular Plug (EPI)',
        caNumero: '11223',
        dataEntrega: '2026-09-10',
        quantidade: 1,
        responsavelEntrega: 'Almoxarifado',
      },
    ],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: EFFECTIVE_DATE,
  });

  const empItems = ambiguousResult.colaboradores[0].itens;
  assertEqual(
    empItems.find((i) => i.documentoCodigoCanonico === 'NR-35')?.status,
    'AUSENTE',
    'NR-12 não pode satisfazer NR-35 por menção genérica à palavra altura'
  );
  assertEqual(
    empItems.find((i) => i.documentoCodigoCanonico === 'ASO')?.status,
    'AUSENTE',
    'ASO Demissional não pode satisfazer exigência de ASO ativo'
  );
  assertEqual(
    empItems.find((i) => i.documentoCodigoCanonico === 'EPI_ALTURA')?.status,
    'AUSENTE',
    'Protetor auricular com sigla EPI não pode satisfazer EPI de trabalho em altura'
  );
  assertEqual(ambiguousResult.podeLiberar, false, 'Correspondências ambíguas devem ser bloqueadas');
});

// ============================================================================
// 15. FAIL-CLOSED: REPROVADO, SEM VALIDADE DEFINIDA E DATA INVÁLIDA
// ============================================================================
test('15. Fail-closed — documento reprovado, sem validade definida ou data de atividade inválida nunca presumem conformidade', () => {
  const res = evaluateActivityCompliance({
    company: baseCompany,
    atividadeIds: [ACT_ALTURA],
    colaboradorIds: [empMontador.id],
    activityProfiles,
    requirements: allRequirements,
    employees: allEmployees,
    documents: [
      {
        id: 'doc_pgr_reprovado',
        nomeDocumento: 'PGR 2026',
        tipoDocumentoCanonico: 'PGR',
        categoria: 'Documento Empresarial',
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataValidade: '2027-12-31',
        responsavelEnvio: 'Ana',
        arquivoUrl: 'data:application/pdf;base64,AAA',
        arquivoNome: 'pgr.pdf',
        situacao: 'reprovado',
        motivoReprovacao: 'Sem assinatura do RT',
        versao: 1,
      },
      {
        id: 'doc_pcmso_sem_data',
        nomeDocumento: 'PCMSO 2026',
        tipoDocumentoCanonico: 'PCMSO',
        categoria: 'Documento Empresarial',
        empresaId: 'comp_1',
        empresaNome: baseCompany.razaoSocial,
        dataValidade: '',
        semValidade: false,
        responsavelEnvio: 'Ana',
        arquivoUrl: 'data:application/pdf;base64,AAA',
        arquivoNome: 'pcmso.pdf',
        situacao: 'aprovado',
        versao: 1,
      },
    ],
    trainings: [],
    exams: [],
    epiDeliveries: [],
    safetyPermits: makePermits(['APR', 'PT']),
    dataReferenciaAtividade: '2026-02-31', // Data inexistente
  });

  assertEqual(res.podeLiberar, false, 'Data inválida e documentos irregulares devem bloquear');
  assertEqual(
    res.itensEmpresa.find((i) => i.documentoCodigoCanonico === 'PGR')?.status,
    'REPROVADO',
    'Documento reprovado deve retornar REPROVADO'
  );
  assertEqual(
    res.itensEmpresa.find((i) => i.documentoCodigoCanonico === 'PCMSO')?.status,
    'PENDENTE_APROVACAO',
    'Documento aprovado sem validade e sem semValidade=true não deve presumir CONFORME'
  );
});

console.log(`\nResumo dos testes: ${passed} aprovado(s), ${failed} falha(s).\n`);
if (failed > 0) {
  throw new Error(`${failed} teste(s) falharam.`);
}
