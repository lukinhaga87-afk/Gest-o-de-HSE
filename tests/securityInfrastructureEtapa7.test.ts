import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApiApp } from '../backend/app';
import {
  signAuthToken,
  signFileAccessTicket,
  verifyFileAccessTicket,
} from '../backend/authMiddleware';
import {
  FirebaseAdminNotConfiguredError,
  getFirebaseAdminDiagnostics,
  resetFirebaseAdminCacheForTests,
} from '../backend/firebaseAdmin';
import { serverGetDoc } from '../backend/firestoreServer';
import {
  AzureBlobPrivateIntegrationFileStorage,
  CloudBucketIntegrationFileStorage,
  computeBufferSha256,
  createDefaultIntegrationFileStorage,
  InMemoryIntegrationFileStorage,
  IntegrationFileIntegrityError,
  IntegrationStorageUnavailableError,
  LocalPrivateIntegrationFileStorage,
} from '../backend/integrationFileStorage';
import {
  createInMemoryIntegrationRepository,
  IntegrationWorkflowActor,
  IntegrationWorkflowError,
  IntegrationWorkflowService,
} from '../backend/integrationWorkflowService';
import type {
  ActivityDocumentRequirement,
  ActivityProfile,
  Company,
  UserProfile,
} from '../src/types/sst';
import {
  buildProtectedDownloadUrl,
  classifyDocumentUrl,
  extractFileNameFromContentDisposition,
} from '../src/utils/protectedDocumentViewer';

const WORKSPACE_ROOT = process.cwd();
const VALID_PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');
const VALID_PDF_DATA_URL = `data:application/pdf;base64,${VALID_PDF_BYTES.toString('base64')}`;

const ADMIN_ACTOR: IntegrationWorkflowActor = {
  id: 'usr-admin-ehs',
  nome: 'Admin EHS Central',
  email: 'admin@ehs.local',
  role: 'admin',
};

const SOLICITANTE_A: IntegrationWorkflowActor = {
  id: 'usr-sol-a',
  nome: 'Solicitante Empresa Alpha',
  email: 'alpha@contratada.local',
  role: 'solicitante',
  empresaId: 'comp-alpha',
};

const SOLICITANTE_B: IntegrationWorkflowActor = {
  id: 'usr-sol-b',
  nome: 'Solicitante Empresa Beta',
  email: 'beta@contratada.local',
  role: 'solicitante',
  empresaId: 'comp-beta',
};

const AUDITOR_ACTOR: IntegrationWorkflowActor = {
  id: 'usr-auditor-1',
  nome: 'Auditor Interno SST',
  email: 'auditor@ehs.local',
  role: 'auditor',
};

function buildFixtureService() {
  const companies: Company[] = [
    {
      id: 'comp-alpha',
      razaoSocial: 'Alpha Engenharia Ltda',
      cnpj: '11.222.333/0001-81',
      situacao: 'ativa',
    } as Company,
    {
      id: 'comp-beta',
      razaoSocial: 'Beta Serviços Industriais Ltda',
      cnpj: '44.555.666/0001-99',
      situacao: 'ativa',
    } as Company,
  ];

  const activityProfiles: ActivityProfile[] = [
    {
      id: 'act-altura',
      codigo: 'NR35_ALTURA',
      nome: 'Trabalho em Altura',
      descricao: 'Atividades executadas acima de 2 metros com risco de queda',
      nivelRisco: 'alto',
      riscosAssociados: ['Queda de nível diferente'],
      normasAplicaveis: ['NR-35'],
      exigeAPR: true,
      exigePT: true,
      exigeLOTO: false,
      ativo: true,
      criadoPorId: ADMIN_ACTOR.id,
    },
  ];

  const activityDocumentRequirements: ActivityDocumentRequirement[] = [
    {
      id: 'req-aso',
      activityId: 'act-altura',
      nomeExibicao: 'ASO com Aptidão para Trabalho em Altura',
      documentoCodigoCanonico: 'ASO',
      palavrasChaveMatch: ['aso'],
      escopo: 'colaborador',
      origemColecao: 'exams',
      funcoesAplicaveis: [],
      exigeAptoASO: true,
      aptidaoEspecifica: 'trabalho_em_altura',
      obrigatorioParaLiberacao: true,
      ativo: true,
      criadoPorId: ADMIN_ACTOR.id,
    },
    {
      id: 'req-nr35',
      activityId: 'act-altura',
      nomeExibicao: 'Certificado NR-35',
      documentoCodigoCanonico: 'NR35',
      palavrasChaveMatch: ['nr35', 'altura'],
      escopo: 'colaborador',
      origemColecao: 'trainings',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      ativo: true,
      criadoPorId: ADMIN_ACTOR.id,
    },
    {
      id: 'req-epi',
      activityId: 'act-altura',
      nomeExibicao: 'Ficha de Entrega de EPI',
      documentoCodigoCanonico: 'FICHA_EPI',
      palavrasChaveMatch: ['epi'],
      escopo: 'colaborador',
      origemColecao: 'epiDeliveries',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      ativo: true,
      criadoPorId: ADMIN_ACTOR.id,
    },
    {
      id: 'req-pgr',
      activityId: 'act-altura',
      nomeExibicao: 'PGR da Empresa Contratada',
      documentoCodigoCanonico: 'PGR',
      palavrasChaveMatch: ['pgr'],
      escopo: 'empresa',
      origemColecao: 'documents',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      ativo: true,
      criadoPorId: ADMIN_ACTOR.id,
    },
  ];

  const repo = createInMemoryIntegrationRepository({
    companies,
    activityProfiles,
    activityDocumentRequirements,
  });
  const storage = new InMemoryIntegrationFileStorage();
  const service = new IntegrationWorkflowService({
    repo,
    fileStorage: storage,
    smartDocsSuggestionRunner: async () => null,
  });

  return { service, state: repo.state, storage };
}

async function startTestServer(app: ReturnType<typeof createApiApp>): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

// ============================================================================
// 1. REGRAS FIRESTORE, BLUEPRINT E REMOÇÃO DO LISTENER INSEGURO NO FRONTEND
// ============================================================================

test('1. firestore.rules bloqueia acesso direto client SDK em contractorIntegrations e contractorIntegrationItems, inclui PENDENTE_DOCUMENTACAO e preserva activityProfiles/activityDocumentRequirements', () => {
  const rulesText = fs.readFileSync(path.join(WORKSPACE_ROOT, 'firestore.rules'), 'utf8');
  const blueprintText = fs.readFileSync(
    path.join(WORKSPACE_ROOT, 'firebase-blueprint.json'),
    'utf8'
  );
  const blueprint = JSON.parse(blueprintText);

  // Extract collection blocks
  const integrationsBlock = rulesText.match(
    /match \/contractorIntegrations\/\{integrationId\}\s*\{[\s\S]*?\n\s*\}/
  )?.[0];
  const itemsBlock = rulesText.match(
    /match \/contractorIntegrationItems\/\{itemId\}\s*\{[\s\S]*?\n\s*\}/
  )?.[0];
  const activityProfilesBlock = rulesText.match(
    /match \/activityProfiles\/\{activityId\}\s*\{[\s\S]*?\n\s*\}/
  )?.[0];
  const activityReqsBlock = rulesText.match(
    /match \/activityDocumentRequirements\/\{requirementId\}\s*\{[\s\S]*?\n\s*\}/
  )?.[0];

  assert(integrationsBlock, 'Bloco contractorIntegrations deve existir em firestore.rules');
  assert(itemsBlock, 'Bloco contractorIntegrationItems deve existir em firestore.rules');
  assert(activityProfilesBlock, 'Bloco activityProfiles deve existir em firestore.rules');
  assert(activityReqsBlock, 'Bloco activityDocumentRequirements deve existir em firestore.rules');

  // Zero public reads / zero direct client writes on contractorIntegrations & contractorIntegrationItems
  assert.doesNotMatch(integrationsBlock, /allow read:\s*if true/);
  assert.match(integrationsBlock, /allow read:\s*if false;/);
  assert.match(integrationsBlock, /allow create:\s*if false/);
  assert.match(integrationsBlock, /allow update:\s*if false/);
  assert.match(integrationsBlock, /allow delete:\s*if false;/);

  assert.doesNotMatch(itemsBlock, /allow read:\s*if true/);
  assert.match(itemsBlock, /allow read:\s*if false;/);
  assert.match(itemsBlock, /allow create:\s*if false/);
  assert.match(itemsBlock, /allow update:\s*if false/);
  assert.match(itemsBlock, /allow delete:\s*if false;/);

  // PENDENTE_DOCUMENTACAO and Base64 rejection helper present in firestore.rules
  assert.match(rulesText, /function isValidIntegrationStatus\(status\)/);
  assert.match(rulesText, /'PENDENTE_DOCUMENTACAO'/);
  assert.match(rulesText, /!data\.arquivoUrl\.matches\('\^data:\.\*'\)/);

  // Activity matrix rules preserved (admin-only writes, no physical delete)
  assert.match(activityProfilesBlock, /isAdminProfileId\(request\.resource\.data\.criadoPorId\)/);
  assert.match(activityProfilesBlock, /allow delete:\s*if false;/);
  assert.match(activityReqsBlock, /isAdminProfileId\(request\.resource\.data\.criadoPorId\)/);
  assert.match(activityReqsBlock, /allow delete:\s*if false;/);

  // Blueprint includes PENDENTE_DOCUMENTACAO and private storage metadata
  assert(
    blueprint.entities.contractorIntegration.properties.status.enum.includes(
      'PENDENTE_DOCUMENTACAO'
    ),
    'firebase-blueprint.json deve incluir PENDENTE_DOCUMENTACAO'
  );
  assert(blueprint.entities.contractorIntegrationItem.properties.storageProvider);
  assert(blueprint.entities.contractorIntegrationItem.properties.arquivoHashSha256);

  // SSTContext must NOT have direct onSnapshot listener on contractorIntegrations or contractorIntegrationItems
  const sstContextText = fs.readFileSync(
    path.join(WORKSPACE_ROOT, 'src/context/SSTContext.tsx'),
    'utf8'
  );
  assert.doesNotMatch(
    sstContextText,
    /onSnapshot\s*\(\s*collection\s*\(\s*db\s*,\s*['"]contractorIntegrations['"]/
  );
  assert.doesNotMatch(
    sstContextText,
    /onSnapshot\s*\(\s*collection\s*\(\s*db\s*,\s*['"]contractorIntegrationItems['"]/
  );
});

// ============================================================================
// 2, 3, 4, 5. PENDENTE_DOCUMENTACAO, ISOLAMENTO, OCULTAÇÃO DE RASCUNHOS E AUDITOR READ-ONLY
// ============================================================================

test('2-5. Fluxo PENDENTE_DOCUMENTACAO, isolamento entre empresas, ocultação total de rascunhos para Admin (inclusive closeIntegration) e perfil Auditor somente leitura', async () => {
  const { service } = buildFixtureService();

  // Solicitante Alpha creates initial integration -> starts as RASCUNHO and transitions to PENDENTE_DOCUMENTACAO while docs are pending
  const created = await service.createIntegration(SOLICITANTE_A, {
    tipo: 'INTEGRACAO_INICIAL',
    empresaId: 'comp-alpha',
    atividadeIds: ['act-altura'],
    novosColaboradores: [
      {
        nomeCompleto: 'João da Silva',
        cpf: '123.456.789-01',
        cargo: 'Montador Industrial',
        atividadesHabilitadasIds: ['act-altura'],
      },
    ],
  });

  assert.equal(created.integration.status, 'RASCUNHO');
  assert(created.items.length >= 4);
  const mandatoryItems = created.items.filter((i) => i.obrigatorio);
  const firstMandatoryItem = mandatoryItems[0];
  assert(firstMandatoryItem);

  // 2. Upload 1 of 4 mandatory docs -> transitions and persists PENDENTE_DOCUMENTACAO, and submit remains blocked
  await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
    itemId: firstMandatoryItem.id,
    arquivoNome: `${firstMandatoryItem.documentoCodigoCanonico}.pdf`,
    arquivoBase64: VALID_PDF_DATA_URL,
    dataEmissao: '2026-01-10',
    dataValidade: '2027-01-10',
    conclusaoAso: firstMandatoryItem.origemColecao === 'exams' ? 'apto' : undefined,
    aptidoesEspecificas:
      firstMandatoryItem.origemColecao === 'exams' ? ['trabalho_em_altura'] : undefined,
  });

  const afterPartialUpload = await service.getIntegrationDetail(SOLICITANTE_A, created.integration.id);
  assert.equal(afterPartialUpload.integration.status, 'PENDENTE_DOCUMENTACAO');

  await assert.rejects(
    () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
    (err: any) =>
      err instanceof IntegrationWorkflowError &&
      err.statusCode === 422 &&
      /Submissão bloqueada/i.test(err.message)
  );

  // 3. Cross-company isolation: Solicitante Beta cannot list, view, upload, or read files from Alpha
  const betaList = await service.listIntegrations(SOLICITANTE_B);
  assert.equal(betaList.length, 0);

  await assert.rejects(
    () => service.getIntegrationDetail(SOLICITANTE_B, created.integration.id),
    (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403
  );

  await assert.rejects(
    () =>
      service.uploadSingleDocument(SOLICITANTE_B, created.integration.id, {
        itemId: firstMandatoryItem.id,
        arquivoNome: 'fake.pdf',
        arquivoBase64: VALID_PDF_DATA_URL,
      }),
    (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403
  );

  // 4. Draft hiding from Admin EHS: Admin cannot list, inspect, start review, approve, reject, or close PENDENTE_DOCUMENTACAO
  const adminListBeforeSubmit = await service.listIntegrations(ADMIN_ACTOR);
  assert.equal(adminListBeforeSubmit.length, 0);

  await assert.rejects(
    () => service.getIntegrationDetail(ADMIN_ACTOR, created.integration.id),
    (err: any) => err instanceof IntegrationWorkflowError && err.code === 'INTEGRATION_NOT_SUBMITTED'
  );

  await assert.rejects(
    () => service.closeIntegration(ADMIN_ACTOR, created.integration.id, { justificativa: 'Teste' }),
    (err: any) => err instanceof IntegrationWorkflowError && err.code === 'INTEGRATION_NOT_SUBMITTED'
  );

  // 5. Auditor is strictly read-only: cannot create, upload, or submit
  await assert.rejects(
    () =>
      service.createIntegration(AUDITOR_ACTOR, {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: 'comp-alpha',
        atividadeIds: ['act-altura'],
        novosColaboradores: [
          { nomeCompleto: 'Teste', cpf: '111.222.333-44', cargo: 'Auxiliar', atividadesHabilitadasIds: ['act-altura'] },
        ],
      }),
    (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403
  );

  await assert.rejects(
    () =>
      service.uploadSingleDocument(AUDITOR_ACTOR, created.integration.id, {
        itemId: firstMandatoryItem.id,
        arquivoNome: 'auditor.pdf',
        arquivoBase64: VALID_PDF_DATA_URL,
      }),
    (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403
  );

  // Upload all mandatory docs as Solicitante Alpha and submit
  for (const item of created.items.filter((i) => i.obrigatorio)) {
    await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
      itemId: item.id,
      arquivoNome: `${item.documentoCodigoCanonico}.pdf`,
      arquivoBase64: VALID_PDF_DATA_URL,
      dataEmissao: '2026-01-10',
      dataValidade: '2027-01-10',
      conclusaoAso: item.origemColecao === 'exams' ? 'apto' : undefined,
      aptidoesEspecificas:
        item.origemColecao === 'exams' ? ['trabalho_em_altura'] : undefined,
    });
  }

  const submitted = await service.submitIntegration(SOLICITANTE_A, created.integration.id);
  assert.equal(submitted.integration.status, 'AGUARDANDO_ANALISE');

  // Now Admin and Auditor can view the submitted integration, while Auditor still cannot mutate it
  const adminListAfterSubmit = await service.listIntegrations(ADMIN_ACTOR);
  assert.equal(adminListAfterSubmit.length, 1);

  const auditorDetail = await service.getIntegrationDetail(AUDITOR_ACTOR, created.integration.id);
  assert.equal(auditorDetail.integration.id, created.integration.id);

  await assert.rejects(
    () => service.approveIntegration(AUDITOR_ACTOR, created.integration.id),
    (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403
  );
  await assert.rejects(
    () => service.closeIntegration(AUDITOR_ACTOR, created.integration.id),
    (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403
  );
});

// ============================================================================
// 6 & 7. LEITURA AUTENTICADA DE DOCUMENTOS OFICIALIZADOS, EXPIRAÇÃO E REVOGAÇÃO
// ============================================================================

test('6-7. Leitura autenticada de documentos oficializados nas 6 telas, ticket temporário assinado, expiração e revogação imediata', async () => {
  const prevSecret = process.env.API_AUTH_SECRET;
  process.env.API_AUTH_SECRET = 'etapa7-test-secret-with-high-entropy-9f8e7d6c5b4a3210';

  try {
    const { service, state } = buildFixtureService();

    // Complete integration workflow through final approval -> officializes records in documents, exams, trainings, epiDeliveries
    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-alpha',
      atividadeIds: ['act-altura'],
      novosColaboradores: [
        {
          nomeCompleto: 'Maria Oliveira',
          cpf: '222.333.444-55',
          cargo: 'Técnica de Manutenção',
          atividadesHabilitadasIds: ['act-altura'],
        },
      ],
    });

    for (const item of created.items.filter((i) => i.obrigatorio)) {
      await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
        itemId: item.id,
        arquivoNome: `${item.documentoCodigoCanonico}.pdf`,
        arquivoBase64: VALID_PDF_DATA_URL,
        dataEmissao: '2026-02-01',
        dataValidade: '2027-02-01',
        conclusaoAso: item.origemColecao === 'exams' ? 'apto' : undefined,
        aptidoesEspecificas:
          item.origemColecao === 'exams' ? ['trabalho_em_altura'] : undefined,
      });
    }

    await service.submitIntegration(SOLICITANTE_A, created.integration.id);
    await service.startReview(ADMIN_ACTOR, created.integration.id);
    for (const item of created.items.filter((i) => i.obrigatorio)) {
      await service.reviewDocumentItem(ADMIN_ACTOR, created.integration.id, item.id, {
        decisao: 'APROVADO',
      });
    }
    const approved = await service.approveIntegration(ADMIN_ACTOR, created.integration.id);
    assert.equal(approved.integration.status, 'APROVADA');

    // Verify officialized SST records use protected /api/integrations/.../file URLs (ZERO Base64 in Firestore!)
    assert(state.documents.length > 0, 'Documentos oficiais devem ser criados');
    assert(state.exams.length > 0, 'Exames oficiais devem ser criados');
    assert(state.trainings.length > 0, 'Treinamentos oficiais devem ser criados');
    assert(state.epiDeliveries.length > 0, 'Entregas de EPI oficiais devem ser criadas');

    const officialDocUrl = state.documents[0].arquivoUrl || '';
    const officialExamUrl = state.exams[0].anexoUrl || '';
    const officialTrainingUrl = state.trainings[0].certificadoUrl || '';
    const officialEpiUrl = state.epiDeliveries[0].assinaturaUrl || '';

    for (const url of [officialDocUrl, officialExamUrl, officialTrainingUrl, officialEpiUrl]) {
      assert.match(url, /^\/api\/integrations\/[^/]+\/items\/[^/]+\/file/);
      assert(!url.startsWith('data:'), 'Nenhum registro oficial deve armazenar Base64');
      assert.equal(classifyDocumentUrl(url), 'protected_api');
    }

    // URL safety classification helpers
    assert.equal(classifyDocumentUrl('javascript:alert(1)'), 'invalid');
    assert.equal(classifyDocumentUrl('data:text/html,<script>alert(1)</script>'), 'invalid');
    assert.equal(
      buildProtectedDownloadUrl(officialDocUrl),
      `${officialDocUrl}${officialDocUrl.includes('?') ? '&' : '?'}download=1`
    );
    assert.equal(
      buildProtectedDownloadUrl('/api/integrations/int-1/items/item-1/file'),
      '/api/integrations/int-1/items/item-1/file?download=1'
    );
    assert.equal(
      extractFileNameFromContentDisposition('inline; filename="ASO.pdf"'),
      'ASO.pdf'
    );

    // Verify all 6 official SST views use ProtectedDocumentButton (zero raw <a href> on protected URLs)
    const sixViews = [
      'src/components/views/DocumentsView.tsx',
      'src/components/views/ExamsView.tsx',
      'src/components/views/TrainingsView.tsx',
      'src/components/views/EpiView.tsx',
      'src/components/views/CompaniesView.tsx',
      'src/components/views/EmployeeDossierModal.tsx',
    ];
    for (const relPath of sixViews) {
      const content = fs.readFileSync(path.join(WORKSPACE_ROOT, relPath), 'utf8');
      assert.match(
        content,
        /ProtectedDocumentButton/,
        `${relPath} deve utilizar ProtectedDocumentButton`
      );
      assert.doesNotMatch(
        content,
        /href=\{(?:docItem|doc|ex|t|tr|ep|epi)\.(?:arquivoUrl|anexoUrl|certificadoUrl|assinaturaUrl)\}/,
        `${relPath} não pode manter link <a> direto para URL protegida`
      );
    }

    // Spin up real local Express app with injectable authoritative user map to test HTTP Bearer, Tickets, Expiration, and Revocation
    const userMap = new Map<string, UserProfile>([
      [
        SOLICITANTE_A.id,
        {
          id: SOLICITANTE_A.id,
          cpf: '111.111.111-11',
          username: '111.111.111-11',
          email: SOLICITANTE_A.email,
          nome: SOLICITANTE_A.nome,
          role: 'solicitante',
          empresaId: 'comp-alpha',
          tokenVersion: 1,
        },
      ],
      [
        SOLICITANTE_B.id,
        {
          id: SOLICITANTE_B.id,
          cpf: '222.222.222-22',
          username: '222.222.222-22',
          email: SOLICITANTE_B.email,
          nome: SOLICITANTE_B.nome,
          role: 'solicitante',
          empresaId: 'comp-beta',
          tokenVersion: 1,
        },
      ],
      [
        ADMIN_ACTOR.id,
        {
          id: ADMIN_ACTOR.id,
          cpf: '333.333.333-33',
          username: '333.333.333-33',
          email: ADMIN_ACTOR.email,
          nome: ADMIN_ACTOR.nome,
          role: 'admin',
          tokenVersion: 1,
        },
      ],
      [
        AUDITOR_ACTOR.id,
        {
          id: AUDITOR_ACTOR.id,
          cpf: '444.444.444-44',
          username: '444.444.444-44',
          email: AUDITOR_ACTOR.email,
          nome: AUDITOR_ACTOR.nome,
          role: 'auditor',
          tokenVersion: 1,
        },
      ],
    ]);

    const app = createApiApp({
      integrationWorkflowService: service,
      authoritativeUserLookup: async (userId) => {
        const u = userMap.get(userId);
        return u ? { id: u.id, data: u } : null;
      },
    });
    const { baseUrl, close } = await startTestServer(app);

    try {
      const uAlpha = userMap.get(SOLICITANTE_A.id)!;
      const uBeta = userMap.get(SOLICITANTE_B.id)!;
      const uAuditor = userMap.get(AUDITOR_ACTOR.id)!;
      const tokenAlpha = signAuthToken({
        id: uAlpha.id,
        cpf: uAlpha.cpf || '',
        email: uAlpha.email,
        nome: uAlpha.nome,
        role: uAlpha.role,
        tokenVersion: uAlpha.tokenVersion,
      }).token;
      const tokenBeta = signAuthToken({
        id: uBeta.id,
        cpf: uBeta.cpf || '',
        email: uBeta.email,
        nome: uBeta.nome,
        role: uBeta.role,
        tokenVersion: uBeta.tokenVersion,
      }).token;
      const tokenAuditor = signAuthToken({
        id: uAuditor.id,
        cpf: uAuditor.cpf || '',
        email: uAuditor.email,
        nome: uAuditor.nome,
        role: uAuditor.role,
        tokenVersion: uAuditor.tokenVersion,
      }).token;

      // Unauthenticated request to officialized document URL MUST fail with 401
      const anonRes = await fetch(`${baseUrl}${officialExamUrl}`);
      assert.equal(anonRes.status, 401);

      // Cross-company authenticated request MUST fail with 403
      const betaRes = await fetch(`${baseUrl}${officialExamUrl}`, {
        headers: { Authorization: `Bearer ${tokenBeta}` },
      });
      assert.equal(betaRes.status, 403);

      // Authorized Solicitante Alpha Bearer request MUST succeed with exact PDF + private cache headers + SHA-256
      const alphaRes = await fetch(`${baseUrl}${officialExamUrl}`, {
        headers: { Authorization: `Bearer ${tokenAlpha}` },
      });
      assert.equal(alphaRes.status, 200);
      assert.equal(alphaRes.headers.get('cache-control'), 'private, no-store, max-age=0');
      assert.equal(alphaRes.headers.get('x-file-sha256'), computeBufferSha256(VALID_PDF_BYTES));
      const alphaBuf = Buffer.from(await alphaRes.arrayBuffer());
      assert.deepEqual(alphaBuf, VALID_PDF_BYTES);

      // Auditor read-only access to officialized document MUST succeed
      const auditorRes = await fetch(`${baseUrl}${officialTrainingUrl}`, {
        headers: { Authorization: `Bearer ${tokenAuditor}` },
      });
      assert.equal(auditorRes.status, 200);

      // Issue short-lived signed access ticket for Solicitante Alpha
      const targetItem = approved.items[0];
      const ticketRes = await fetch(
        `${baseUrl}/api/integrations/${approved.integration.id}/items/${targetItem.id}/file-token`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenAlpha}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      assert.equal(ticketRes.status, 200);
      const ticketData = (await ticketRes.json()) as {
        ticket: string;
        signedUrl: string;
        ttlSeconds: number;
      };
      assert(ticketData.ticket);
      assert(ticketData.ttlSeconds >= 10 && ticketData.ttlSeconds <= 300);

      // Ticket works for its scoped document while session is active
      const viaTicketRes = await fetch(`${baseUrl}${ticketData.signedUrl}`);
      assert.equal(viaTicketRes.status, 200);
      assert.deepEqual(Buffer.from(await viaTicketRes.arrayBuffer()), VALID_PDF_BYTES);

      // Ticket fails if replayed against a DIFFERENT item (scope binding)
      const otherItem = approved.items[1];
      const wrongScopeRes = await fetch(
        `${baseUrl}/api/integrations/${approved.integration.id}/items/${otherItem.id}/file?ticket=${encodeURIComponent(ticketData.ticket)}`
      );
      assert.equal(wrongScopeRes.status, 401);

      // Expired ticket fails deterministically
      const pastIssued = signFileAccessTicket({
        userId: SOLICITANTE_A.id,
        role: 'solicitante',
        tokenVersion: 1,
        integrationId: approved.integration.id,
        itemId: targetItem.id,
        ttlSeconds: 15,
        nowMs: Date.now() - 120_000,
      });
      assert.equal(
        verifyFileAccessTicket(pastIssued.ticket, {
          integrationId: approved.integration.id,
          itemId: targetItem.id,
        }),
        null
      );
      const expiredRes = await fetch(
        `${baseUrl}/api/integrations/${approved.integration.id}/items/${targetItem.id}/file?ticket=${encodeURIComponent(pastIssued.ticket)}`
      );
      assert.equal(expiredRes.status, 401);

      // Revocation: increment user's tokenVersion (e.g., password change / forced logout) -> existing ticket MUST be rejected immediately!
      const alphaProfile = userMap.get(SOLICITANTE_A.id)!;
      userMap.set(SOLICITANTE_A.id, { ...alphaProfile, tokenVersion: 2 });

      const revokedRes = await fetch(`${baseUrl}${ticketData.signedUrl}`);
      assert.equal(revokedRes.status, 401);
      const revokedJson = (await revokedRes.json()) as { code?: string };
      assert.equal(revokedJson.code, 'FILE_TICKET_REVOKED');
    } finally {
      await close();
    }
  } finally {
    if (prevSecret === undefined) {
      delete process.env.API_AUTH_SECRET;
    } else {
      process.env.API_AUTH_SECRET = prevSecret;
    }
  }
});

// ============================================================================
// 8 & 9. STORAGE PRIVADO (GCS/FIREBASE STORAGE, AZURE BLOB, LOCAL) + INTEGRIDADE SHA-256
// ============================================================================

test('8-9. Upload/download em storage privado (Firebase Storage/GCS e Azure Blob) com verificação de integridade SHA-256 em upload e download', async () => {
  // 8a. CloudBucketIntegrationFileStorage (Firebase Storage / GCS) with mock private bucket
  const bucketStore = new Map<string, { buf: Buffer; options: Record<string, any> }>();
  const mockBucket = {
    name: 'ehs-private-bucket-test',
    file(key: string) {
      return {
        async save(data: Buffer, options?: Record<string, any>) {
          bucketStore.set(key, { buf: Buffer.from(data), options: options || {} });
        },
        async exists(): Promise<[boolean]> {
          return [bucketStore.has(key)];
        },
        async download(): Promise<[Buffer]> {
          const entry = bucketStore.get(key);
          if (!entry) throw new Error('Not found');
          return [Buffer.from(entry.buf)];
        },
        async delete() {
          bucketStore.delete(key);
        },
      };
    },
  };

  const gcsStorage = new CloudBucketIntegrationFileStorage({
    providerName: 'firebase_storage',
    bucketName: 'ehs-private-bucket-test',
    bucket: mockBucket,
  });

  const gcsKey = 'integrations/comp-alpha/int-1/item-1/v1_doc.pdf';
  const expectedPdfHash = computeBufferSha256(VALID_PDF_BYTES);
  const putGcs = await gcsStorage.putObject({
    storageKey: gcsKey,
    buffer: VALID_PDF_BYTES,
    mimeType: 'application/pdf',
    sha256: expectedPdfHash,
  });
  assert.equal(putGcs.storageProvider, 'firebase_storage');
  assert.equal(putGcs.sha256, expectedPdfHash);

  // Verify stored privately (public: false, no public ACL, private no-store cache control)
  const rawBucketEntry = bucketStore.get(gcsKey);
  assert(rawBucketEntry);
  assert.equal(rawBucketEntry.options.public, false);
  assert.equal(rawBucketEntry.options.resumable, false);
  assert.equal(rawBucketEntry.options.metadata?.cacheControl, 'private, no-store, max-age=0');

  const gotGcs = await gcsStorage.getObject(gcsKey, { expectedSha256: putGcs.sha256 });
  assert(gotGcs);
  assert.deepEqual(gotGcs.buffer, VALID_PDF_BYTES);

  // 9a. Tamper with stored bytes -> SHA-256 verification MUST fail on download!
  rawBucketEntry.buf[0] = rawBucketEntry.buf[0] ^ 0xff;
  await assert.rejects(
    () => gcsStorage.getObject(gcsKey, { expectedSha256: putGcs.sha256 }),
    (err: any) =>
      err instanceof IntegrationFileIntegrityError && err.code === 'FILE_INTEGRITY_MISMATCH'
  );

  // 8b. AzureBlobPrivateIntegrationFileStorage with mock fetch asserting SharedKey auth & private blob
  const azureStore = new Map<string, Buffer>();
  const capturedAuthHeaders: string[] = [];
  const mockAzureFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const headers = (init?.headers || {}) as Record<string, string>;
    if (headers.Authorization) {
      capturedAuthHeaders.push(headers.Authorization);
    }

    if (method === 'PUT') {
      assert.equal(headers['x-ms-blob-type'], 'BlockBlob');
      assert.match(headers.Authorization || '', /^SharedKey ehsaccount:/);
      const bodyBuf = Buffer.isBuffer(init?.body)
        ? init.body
        : Buffer.from(init?.body as Uint8Array);
      azureStore.set(url, Buffer.from(bodyBuf));
      return new Response(null, { status: 201 });
    }
    if (method === 'GET') {
      const data = azureStore.get(url);
      if (!data) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(data), { status: 200 });
    }
    if (method === 'DELETE') {
      azureStore.delete(url);
      return new Response(null, { status: 202 });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;

  const azureStorage = new AzureBlobPrivateIntegrationFileStorage({
    config: {
      accountName: 'ehsaccount',
      accountKey: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
      containerName: 'ehs-private-docs',
    },
    fetchImpl: mockAzureFetch,
  });

  const azKey = 'integrations/comp-alpha/int-2/item-2/v1_aso.pdf';
  const putAz = await azureStorage.putObject({
    storageKey: azKey,
    buffer: VALID_PDF_BYTES,
    mimeType: 'application/pdf',
    sha256: expectedPdfHash,
  });
  assert.equal(putAz.storageProvider, 'azure_blob');
  assert.equal(putAz.sha256, expectedPdfHash);
  assert(capturedAuthHeaders.length === 1);

  const gotAz = await azureStorage.getObject(azKey, { expectedSha256: putAz.sha256 });
  assert(gotAz);
  assert.deepEqual(gotAz.buffer, VALID_PDF_BYTES);

  // 9b. Tamper with Azure stored buffer -> SHA-256 mismatch error
  for (const [k, v] of azureStore.entries()) {
    const mutated = Buffer.from(v);
    mutated[mutated.length - 1] = mutated[mutated.length - 1] ^ 0xaa;
    azureStore.set(k, mutated);
  }
  await assert.rejects(
    () => azureStorage.getObject(azKey, { expectedSha256: putAz.sha256 }),
    (err: any) =>
      err instanceof IntegrationFileIntegrityError && err.code === 'FILE_INTEGRITY_MISMATCH'
  );

  // 9c. End-to-end SHA-256 verification inside IntegrationWorkflowService.getDocumentFile
  const { service, state, storage } = buildFixtureService();
  const created = await service.createIntegration(SOLICITANTE_A, {
    tipo: 'INTEGRACAO_INICIAL',
    empresaId: 'comp-alpha',
    atividadeIds: ['act-altura'],
    novosColaboradores: [
      { nomeCompleto: 'Carlos Lima', cpf: '555.666.777-88', cargo: 'Soldador', atividadesHabilitadasIds: ['act-altura'] },
    ],
  });
  const docItem = created.items[0];
  await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
    itemId: docItem.id,
    arquivoNome: 'integridade.pdf',
    arquivoBase64: VALID_PDF_DATA_URL,
  });
  const persistedItem = state.items.find((i) => i.id === docItem.id);
  const storageKey = persistedItem?.storageKey;
  assert(storageKey);

  // Corrupt stored object inside InMemoryIntegrationFileStorage
  const corruptedBuf = Buffer.from('%PDF-1.4\nCORRUPTED_BYTES\n%%EOF\n', 'utf8');
  await storage.putObject({
    storageKey,
    buffer: corruptedBuf,
    mimeType: 'application/pdf',
    sha256: computeBufferSha256(corruptedBuf),
  });

  await assert.rejects(
    () => service.getDocumentFile(SOLICITANTE_A, created.integration.id, docItem.id),
    (err: any) =>
      err instanceof IntegrationWorkflowError &&
      err.statusCode === 500 &&
      err.code === 'FILE_INTEGRITY_MISMATCH'
  );
});

// ============================================================================
// 10. PERSISTÊNCIA EM AMBIENTE SERVERLESS E DIAGNÓSTICO HONESTO DO FIREBASE ADMIN SDK
// ============================================================================

test('10. Serverless falha fechado (HTTP 503) sem provedor de object storage configurado e Firebase Admin SDK reporta estado não configurado sem simular credenciais', async () => {
  const savedEnv = {
    NETLIFY: process.env.NETLIFY,
    INTEGRATION_STORAGE_PROVIDER: process.env.INTEGRATION_STORAGE_PROVIDER,
    FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET,
    GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME,
    AZURE_STORAGE_ACCOUNT_NAME: process.env.AZURE_STORAGE_ACCOUNT_NAME,
    AZURE_STORAGE_ACCOUNT_KEY: process.env.AZURE_STORAGE_ACCOUNT_KEY,
    AZURE_STORAGE_CONTAINER_NAME: process.env.AZURE_STORAGE_CONTAINER_NAME,
    FIREBASE_REQUIRE_ADMIN_SDK: process.env.FIREBASE_REQUIRE_ADMIN_SDK,
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    FIREBASE_ADMIN_PROJECT_ID: process.env.FIREBASE_ADMIN_PROJECT_ID,
    FIREBASE_ADMIN_CLIENT_EMAIL: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    FIREBASE_ADMIN_PRIVATE_KEY: process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };

  try {
    // Clear storage & admin env vars
    delete process.env.INTEGRATION_STORAGE_PROVIDER;
    delete process.env.FIREBASE_STORAGE_BUCKET;
    delete process.env.GCS_BUCKET_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_ADMIN_PROJECT_ID;
    delete process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    delete process.env.FIREBASE_ADMIN_PRIVATE_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    // 10a. Serverless without cloud storage -> MUST fail closed with 503 STORAGE_PROVIDER_NOT_CONFIGURED
    process.env.NETLIFY = 'true';
    const serverlessUnconfigured = createDefaultIntegrationFileStorage();
    await assert.rejects(
      () =>
        serverlessUnconfigured.putObject({
          storageKey: 'integrations/comp-a/int-1/item-1/v1_doc.pdf',
          buffer: VALID_PDF_BYTES,
          mimeType: 'application/pdf',
          sha256: computeBufferSha256(VALID_PDF_BYTES),
        }),
      (err: any) =>
        err instanceof IntegrationStorageUnavailableError &&
        err.status === 503 &&
        err.code === 'STORAGE_PROVIDER_NOT_CONFIGURED'
    );

    // 10b. Serverless WITH firebase_storage bucket configured -> selects CloudBucketIntegrationFileStorage
    process.env.INTEGRATION_STORAGE_PROVIDER = 'firebase_storage';
    process.env.FIREBASE_STORAGE_BUCKET = 'ehs-more-prod-private-bucket';
    const selectedGcs = createDefaultIntegrationFileStorage();
    assert.equal(selectedGcs.providerName, 'firebase_storage');

    // 10c. Serverless WITH azure_blob configured -> selects AzureBlobPrivateIntegrationFileStorage
    process.env.INTEGRATION_STORAGE_PROVIDER = 'azure_blob';
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'ehsmoreprod';
    process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.from('secret-key-32-bytes-for-testing!').toString(
      'base64'
    );
    process.env.AZURE_STORAGE_CONTAINER_NAME = 'integracoes-privadas';
    const selectedAzure = createDefaultIntegrationFileStorage();
    assert.equal(selectedAzure.providerName, 'azure_blob');

    // 10d. Local development without cloud storage -> uses LocalPrivateIntegrationFileStorage
    delete process.env.NETLIFY;
    delete process.env.INTEGRATION_STORAGE_PROVIDER;
    delete process.env.FIREBASE_STORAGE_BUCKET;
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
    const localDefault = createDefaultIntegrationFileStorage();
    assert(localDefault instanceof LocalPrivateIntegrationFileStorage);

    // 10e. Firebase Admin SDK honest unconfigured diagnostic & fail-closed when FIREBASE_REQUIRE_ADMIN_SDK=true
    resetFirebaseAdminCacheForTests();
    const diag = getFirebaseAdminDiagnostics();
    assert.equal(diag.configured, false);
    assert.equal(diag.credentialSource, 'unconfigured');

    process.env.FIREBASE_REQUIRE_ADMIN_SDK = 'true';
    await assert.rejects(
      () => serverGetDoc('contractorIntegrations', 'any-id'),
      (err: any) =>
        err instanceof FirebaseAdminNotConfiguredError &&
        err.statusCode === 503 &&
        err.code === 'FIREBASE_ADMIN_NOT_CONFIGURED'
    );
  } finally {
    resetFirebaseAdminCacheForTests();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ============================================================================
// 11. PRESERVAÇÃO DO FLUXO PT/APR
// ============================================================================

test('11. Fluxo PT/APR preservado sem regressões nas rotas e regras', () => {
  const rulesText = fs.readFileSync(path.join(WORKSPACE_ROOT, 'firestore.rules'), 'utf8');
  assert.match(rulesText, /match \/safetyPermits\/\{permitId\}/);
  assert.match(rulesText, /isValidSafetyPermitApproval/);

  const appText = fs.readFileSync(path.join(WORKSPACE_ROOT, 'backend/app.ts'), 'utf8');
  assert.match(appText, /app\.post\('\/api\/permits\/:id\/approve'/);
  assert.match(appText, /app\.post\('\/api\/permits\/:id\/release'/);
});
