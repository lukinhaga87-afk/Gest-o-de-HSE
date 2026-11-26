import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_ACTIVITY_TEMPLATES } from '../src/utils/activityTemplates';

const rootDir = process.cwd();
const readSource = (relPath: string) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

test('1. Matriz de EHS contém as 10 atividades iniciais de referência com requisitos obrigatórios e condicionais compatíveis com firestore.rules', () => {
  assert.equal(INITIAL_ACTIVITY_TEMPLATES.length, 10, 'Devem existir exatamente 10 atividades iniciais de referência');

  const expectedCodes = [
    'TRABALHO_ALTURA',
    'ESPACO_CONFINADO',
    'SERVICOS_ELETRICOS',
    'TRABALHO_QUENTE',
    'ESCAVACAO',
    'OPERACAO_EQUIPAMENTOS_MOVEIS',
    'ICAMENTO_MOVIMENTACAO_CARGAS',
    'PRODUTOS_QUIMICOS',
    'MONTAGEM_ANDAIMES',
    'OBRAS_CIVIS_REFORMAS',
  ];

  const actualCodes = INITIAL_ACTIVITY_TEMPLATES.map((t) => t.codigo);
  for (const code of expectedCodes) {
    assert.ok(actualCodes.includes(code), `Atividade obrigatória ausente na matriz inicial: ${code}`);
  }

  const allowedActivityKeys = new Set([
    'templateKey',
    'codigo',
    'nome',
    'descricao',
    'nivelRisco',
    'riscosAssociados',
    'normasAplicaveis',
    'exigeAPR',
    'exigePT',
    'exigeLOTO',
    'exigePET',
    'requisitosPadrao',
  ]);

  const allowedRequirementKeys = new Set([
    'templateKey',
    'nomeExibicao',
    'descricao',
    'documentoCodigoCanonico',
    'palavrasChaveMatch',
    'escopo',
    'origemColecao',
    'funcoesAplicaveis',
    'exigeAptoASO',
    'aptidaoEspecifica',
    'validadePadraoMeses',
    'obrigatorioParaLiberacao',
    'baseLegal',
    'ordemExibicao',
  ]);

  let totalConditional = 0;

  for (const tpl of INITIAL_ACTIVITY_TEMPLATES) {
    for (const key of Object.keys(tpl)) {
      assert.ok(
        allowedActivityKeys.has(key),
        `Campo não permitido em activityProfiles (${tpl.codigo}): ${key}`
      );
    }

    const mandatoryCount = tpl.requisitosPadrao.filter((r) => r.obrigatorioParaLiberacao).length;
    const conditionalCount = tpl.requisitosPadrao.filter((r) => !r.obrigatorioParaLiberacao).length;
    totalConditional += conditionalCount;

    assert.ok(
      mandatoryCount > 0,
      `Atividade ${tpl.codigo} deve possuir ao menos 1 requisito obrigatório`
    );

    for (const req of tpl.requisitosPadrao) {
      for (const key of Object.keys(req)) {
        assert.ok(
          allowedRequirementKeys.has(key),
          `Campo não permitido em activityDocumentRequirements (${tpl.codigo}/${req.documentoCodigoCanonico}): ${key}`
        );
      }
    }
  }

  assert.ok(
    totalConditional > 0,
    'A Matriz de EHS inicial deve conter requisitos condicionais/complementares (obrigatorioParaLiberacao = false)'
  );
});

test('2. Navegação e roteamento preservam Pendências e Vencimentos do Solicitante e expõem Matriz de EHS e Controle de Vencimentos do Admin', () => {
  const sidebarSrc = readSource('src/components/layout/Sidebar.tsx');
  const appSrc = readSource('src/App.tsx');

  // Admin navigation includes Matriz de EHS
  assert.match(sidebarSrc, /matriz_ehs/);
  assert.match(sidebarSrc, /Matriz de EHS/);

  // App routes Admin/Auditor controle_vencimentos to AdminExpirationsControlView
  assert.match(appSrc, /import \{ AdminExpirationsControlView \} from '\.\/components\/views\/AdminExpirationsControlView'/);
  assert.match(appSrc, /import \{ ActivityMatrixView \} from '\.\/components\/views\/ActivityMatrixView'/);
  assert.match(appSrc, /case 'controle_vencimentos':\s*return <AdminExpirationsControlView onNavigate=\{handleNavigate\} \/>/);
  assert.match(appSrc, /case 'matriz_ehs':\s*return <ActivityMatrixView \/>/);

  // Solicitante pendencias_vencimentos MUST remain routed to untouched ExpirationsControlView
  assert.match(appSrc, /case 'pendencias_vencimentos':\s*return <ExpirationsControlView onNavigate=\{handleNavigate\} \/>/);

  // Solicitante allowed tabs must NOT include matriz_ehs or usuarios
  const solTabsMatch = appSrc.match(/SOLICITANTE_ALLOWED_TABS:\s*NavItemKey\[\]\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(solTabsMatch, 'SOLICITANTE_ALLOWED_TABS deve existir em App.tsx');
  assert.doesNotMatch(solTabsMatch[1], /matriz_ehs/);
  assert.doesNotMatch(solTabsMatch[1], /usuarios/);
});

test('3. Fluxos de Solicitação de Alteração Cadastral, aprovação/recusa com justificativa obrigatória e RBAC Admin-only estão implementados', () => {
  const sstCtxSrc = readSource('src/context/SSTContext.tsx');
  const companiesSrc = readSource('src/components/views/CompaniesView.tsx');
  const employeeModalSrc = readSource('src/components/views/EmployeeDossierModal.tsx');
  const analysisSrc = readSource('src/components/views/DocumentAnalysisCenterView.tsx');
  const adminExpSrc = readSource('src/components/views/AdminExpirationsControlView.tsx');

  // SSTContext exposes company change request & exam review workflows with Admin RBAC
  assert.match(sstCtxSrc, /requestCompanyChange:/);
  assert.match(sstCtxSrc, /approveCompanyChange:/);
  assert.match(sstCtxSrc, /rejectCompanyChange:/);
  assert.match(sstCtxSrc, /approveExam:/);
  assert.match(sstCtxSrc, /rejectExam:/);

  // CompaniesView supports list view, direct company document upload, and Solicitar Alteração Cadastral
  assert.match(companiesSrc, /Solicitar Alteração Cadastral/);
  assert.match(companiesSrc, /Enviar Documento da Empresa/);
  assert.match(companiesSrc, /Justificativa Obrigatória da Recusa/);
  assert.match(companiesSrc, /<table className="w-full text-left border-collapse">/);

  // EmployeeDossierModal supports direct upload without minimum file count & Admin accept/reject
  assert.match(employeeModalSrc, /sem mínimo de documentos/i);
  assert.match(employeeModalSrc, /approveExam/);
  assert.match(employeeModalSrc, /rejectExam/);
  assert.match(employeeModalSrc, /Justificativa da Recusa/);

  // DocumentAnalysisCenterView groups by solicitation and handles direct + integration docs
  assert.match(analysisSrc, /solicitationGroups/);
  assert.match(analysisSrc, /direct_doc/);
  assert.match(analysisSrc, /direct_exam/);
  assert.match(analysisSrc, /direct_training/);

  // AdminExpirationsControlView supports add, delete, accept/reject, preview, and dossier deep links
  assert.match(adminExpSrc, /Incluir Novo Documento/);
  assert.match(adminExpSrc, /Confirmar Exclusão de Documento/);
  assert.match(adminExpSrc, /Dossiê Empresa/);
  assert.match(adminExpSrc, /Dossiê Colaborador/);
});

test('4. Matriz de EHS exibe aviso técnico de referência configurável e prévia dinâmica na Gestão de Integração', () => {
  const matrixSrc = readSource('src/components/views/ActivityMatrixView.tsx');
  const centralSrc = readSource('src/components/views/CentralIntegracaoView.tsx');

  assert.match(matrixSrc, /não substitui a avaliação técnica de SST/i);
  assert.match(matrixSrc, /Carregar 10 Atividades Iniciais \(NRs\)/);
  assert.match(matrixSrc, /handleToggleObrigatoriedade/);

  assert.match(centralSrc, /Prévia Dinâmica da Matriz de EHS/);
  assert.match(centralSrc, /Documentos Obrigatórios/);
  assert.match(centralSrc, /Documentos Condicionais \/ Complementares/);
});
