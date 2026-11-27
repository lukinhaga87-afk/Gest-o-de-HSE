import type {
  ContractorIntegrationItem,
  IntegrationDocumentGroupId,
  IntegrationOfficialCollection,
} from '../types/sst';

export interface IntegrationDocumentCategoryDefinition {
  id: IntegrationDocumentGroupId;
  ordem: number;
  codigoEtiqueta: string;
  titulo: string;
  descricao: string;
}

export interface IntegrationDocumentTypeCatalogEntry {
  ordem: number;
  categoriaId: IntegrationDocumentGroupId;
  codigoCanonico: string;
  nomeExibicao: string;
  descricaoCurta: string;
  origemColecao: IntegrationOfficialCollection;
  semValidadePadrao?: boolean;
  palavrasChaveArquivo: string[];
}

export const MANDATORY_DOCUMENT_CATEGORIES: readonly IntegrationDocumentCategoryDefinition[] = [
  {
    id: 'pessoais_legais',
    ordem: 1,
    codigoEtiqueta: 'CATEGORIA 1',
    titulo: 'DOCUMENTOS PESSOAIS E LEGAIS',
    descricao: 'Identificação pessoal e documentação legal complementar exigida pela empresa ou atividade.',
  },
  {
    id: 'saude_ocupacional',
    ordem: 2,
    codigoEtiqueta: 'CATEGORIA 2',
    titulo: 'SAÚDE OCUPACIONAL',
    descricao: 'Atestado de Saúde Ocupacional (ASO) e aptidões específicas para atividades críticas.',
  },
  {
    id: 'seguranca_trabalho',
    ordem: 3,
    codigoEtiqueta: 'CATEGORIA 3',
    titulo: 'SEGURANÇA DO TRABALHO',
    descricao: 'Ficha de EPI, Ordem de Serviço de Segurança e certificados de treinamentos obrigatórios.',
  },
  {
    id: 'vinculo_empregaticio',
    ordem: 4,
    codigoEtiqueta: 'CATEGORIA 4',
    titulo: 'VÍNCULO EMPREGATÍCIO',
    descricao: 'Registro de empregado, contrato de trabalho e comprovação formal de vínculo.',
  },
] as const;

export const EMPLOYEE_DOCUMENT_CATALOG: readonly IntegrationDocumentTypeCatalogEntry[] = [
  // CATEGORIA 1 — DOCUMENTOS PESSOAIS E LEGAIS
  {
    ordem: 1,
    categoriaId: 'pessoais_legais',
    codigoCanonico: 'RG_CNH',
    nomeExibicao: 'RG ou CNH',
    descricaoCurta: 'Documento oficial de identificação com foto',
    origemColecao: 'documents',
    semValidadePadrao: true,
    palavrasChaveArquivo: ['rg', 'cnh', 'identidade', 'habilitacao', 'habilitação'],
  },
  {
    ordem: 2,
    categoriaId: 'pessoais_legais',
    codigoCanonico: 'CPF',
    nomeExibicao: 'CPF (quando exigido separadamente)',
    descricaoCurta: 'Comprovante de inscrição no CPF',
    origemColecao: 'documents',
    semValidadePadrao: true,
    palavrasChaveArquivo: ['cpf', 'receita'],
  },
  {
    ordem: 3,
    categoriaId: 'pessoais_legais',
    codigoCanonico: 'OUTROS_DOC_LEGAIS',
    nomeExibicao: 'Outros documentos legais exigidos pela empresa ou atividade',
    descricaoCurta: 'Documentação legal adicional exigida para o escopo',
    origemColecao: 'documents',
    semValidadePadrao: false,
    palavrasChaveArquivo: ['legal', 'crea', 'art', 'antecedente', 'residencia', 'residência', 'comprovante'],
  },

  // CATEGORIA 2 — SAÚDE OCUPACIONAL
  {
    ordem: 4,
    categoriaId: 'saude_ocupacional',
    codigoCanonico: 'ASO',
    nomeExibicao: 'ASO — Atestado de Saúde Ocupacional',
    descricaoCurta: 'Exame ocupacional admissional, periódico ou mudança de função',
    origemColecao: 'exams',
    semValidadePadrao: false,
    palavrasChaveArquivo: ['aso', 'exame', 'saude', 'saúde', 'ocupacional', 'admissional', 'periodico', 'periódico'],
  },
  {
    ordem: 5,
    categoriaId: 'saude_ocupacional',
    codigoCanonico: 'APTIDAO_ATIVIDADE_CRITICA',
    nomeExibicao: 'Aptidões específicas para atividades críticas (quando aplicável)',
    descricaoCurta: 'Exames complementares e liberação clínica para atividades críticas',
    origemColecao: 'exams',
    semValidadePadrao: false,
    palavrasChaveArquivo: ['aptidao', 'aptidão', 'eletro', 'ecg', 'eeg', 'audiometria', 'acuidade', 'glicemia', 'espirometria'],
  },

  // CATEGORIA 3 — SEGURANÇA DO TRABALHO
  {
    ordem: 6,
    categoriaId: 'seguranca_trabalho',
    codigoCanonico: 'FICHA_EPI',
    nomeExibicao: 'Ficha de Entrega de EPI',
    descricaoCurta: 'Comprovante assinado de fornecimento e CA dos EPIs',
    origemColecao: 'epiDeliveries',
    semValidadePadrao: true,
    palavrasChaveArquivo: ['epi', 'ficha_epi', 'ficha-epi', 'equipamento', 'protecao', 'proteção'],
  },
  {
    ordem: 7,
    categoriaId: 'seguranca_trabalho',
    codigoCanonico: 'ORDEM_SERVICO',
    nomeExibicao: 'Ordem de Serviço de Segurança',
    descricaoCurta: 'Ordem de Serviço (NR-01) assinada pelo colaborador',
    origemColecao: 'documents',
    semValidadePadrao: true,
    palavrasChaveArquivo: ['ordem_servico', 'ordem-servico', 'ordem de servico', 'os_', 'os-', 'nr-01', 'nr01'],
  },
  {
    ordem: 8,
    categoriaId: 'seguranca_trabalho',
    codigoCanonico: 'TREINAMENTO_OBRIGATORIO',
    nomeExibicao: 'Certificados e comprovantes de treinamentos obrigatórios',
    descricaoCurta: 'Certificados de NRs e capacitações (NR-35, NR-33, NR-10, NR-18, NR-23, etc.)',
    origemColecao: 'trainings',
    semValidadePadrao: false,
    palavrasChaveArquivo: [
      'nr35',
      'nr-35',
      'nr_35',
      'nr33',
      'nr-33',
      'nr_33',
      'nr10',
      'nr-10',
      'nr_10',
      'nr18',
      'nr-18',
      'nr23',
      'nr-23',
      'nr12',
      'nr-12',
      'nr11',
      'nr-11',
      'treinamento',
      'certificado',
      'capacitacao',
      'capacitação',
      'integracao',
      'integração',
      'altura',
      'confinado',
      'eletric',
      'quente',
      'escavacao',
      'escavação',
    ],
  },

  // CATEGORIA 4 — VÍNCULO EMPREGATÍCIO
  {
    ordem: 9,
    categoriaId: 'vinculo_empregaticio',
    codigoCanonico: 'REGISTRO_EMPREGADO',
    nomeExibicao: 'Registro de empregado ou ficha de registro',
    descricaoCurta: 'FRE / Ficha de Registro de Empregado ou eSocial S-2200',
    origemColecao: 'documents',
    semValidadePadrao: true,
    palavrasChaveArquivo: ['fre', 'ficha_registro', 'ficha-registro', 'registro', 'esocial', 's-2200', 's2200'],
  },
  {
    ordem: 10,
    categoriaId: 'vinculo_empregaticio',
    codigoCanonico: 'CONTRATO_TRABALHO',
    nomeExibicao: 'Contrato de trabalho ou documento equivalente',
    descricaoCurta: 'Contrato de trabalho, CTPS digital ou contrato de prestação',
    origemColecao: 'documents',
    semValidadePadrao: true,
    palavrasChaveArquivo: ['contrato', 'ctps', 'carteira', 'trabalho'],
  },
  {
    ordem: 11,
    categoriaId: 'vinculo_empregaticio',
    codigoCanonico: 'COMPROVANTE_VINCULO',
    nomeExibicao: 'Comprovante de vínculo empregatício',
    descricaoCurta: 'CAGED, FGTS/SEFIP, GFIP, holerite ou declaração de vínculo',
    origemColecao: 'documents',
    semValidadePadrao: false,
    palavrasChaveArquivo: ['vinculo', 'vínculo', 'fgts', 'sefip', 'gfip', 'caged', 'inss', 'holerite', 'guia'],
  },
] as const;

export const SIMPLE_ACTIVITY_DOCUMENT_CATEGORY: IntegrationDocumentCategoryDefinition = {
  id: 'atividade_simples',
  ordem: 5,
  codigoEtiqueta: 'ATIVIDADE SIMPLES',
  titulo: 'DOCUMENTOS DE ATIVIDADE SIMPLES',
  descricao: 'Documentos específicos vinculados às Atividades Simples cadastradas pelo Solicitante.',
};

export const CATEGORY_BY_ID: Record<IntegrationDocumentGroupId, IntegrationDocumentCategoryDefinition> =
  [...MANDATORY_DOCUMENT_CATEGORIES, SIMPLE_ACTIVITY_DOCUMENT_CATEGORY].reduce(
    (acc, cat) => {
      acc[cat.id] = cat;
      return acc;
    },
    {} as Record<IntegrationDocumentGroupId, IntegrationDocumentCategoryDefinition>
  );

function normalizeForMatch(value?: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function classifyIntegrationDocumentGroup(input: {
  categoriaOrganizacional?: IntegrationDocumentGroupId;
  documentoCodigoCanonico?: string;
  nomeExibicao?: string;
  origemColecao?: IntegrationOfficialCollection;
}): IntegrationDocumentGroupId {
  if (input.categoriaOrganizacional && CATEGORY_BY_ID[input.categoriaOrganizacional]) {
    return input.categoriaOrganizacional;
  }

  const code = normalizeForMatch(input.documentoCodigoCanonico);
  const title = normalizeForMatch(input.nomeExibicao);
  const combined = `${code} ${title}`;

  // Categoria 2 — Saúde Ocupacional
  if (
    input.origemColecao === 'exams' ||
    code === 'aso' ||
    code.includes('aptidao') ||
    combined.includes('aso') ||
    combined.includes('saude ocupacional') ||
    combined.includes('exame ocupacional') ||
    combined.includes('aptidao')
  ) {
    return 'saude_ocupacional';
  }

  // Categoria 3 — Segurança do Trabalho
  if (
    input.origemColecao === 'epiDeliveries' ||
    input.origemColecao === 'trainings' ||
    code.startsWith('nr') ||
    code.includes('epi') ||
    code.includes('ordem_servico') ||
    code.includes('treinamento') ||
    combined.includes('ficha de epi') ||
    combined.includes('entrega de epi') ||
    combined.includes('ordem de servico') ||
    combined.includes('treinamento') ||
    combined.includes('certificado') ||
    /\bnr[-\s]?\d{1,2}\b/.test(combined)
  ) {
    return 'seguranca_trabalho';
  }

  // Categoria 4 — Vínculo Empregatício
  if (
    code.includes('registro_empregado') ||
    code.includes('contrato_trabalho') ||
    code.includes('comprovante_vinculo') ||
    code === 'fre' ||
    code === 'ctps' ||
    combined.includes('registro de empregado') ||
    combined.includes('ficha de registro') ||
    combined.includes('contrato de trabalho') ||
    combined.includes('vinculo empregaticio') ||
    combined.includes('ctps') ||
    combined.includes('esocial') ||
    combined.includes('fgts') ||
    combined.includes('sefip') ||
    combined.includes('caged')
  ) {
    return 'vinculo_empregaticio';
  }

  // Categoria 1 — Documentos Pessoais e Legais (default for RG, CNH, CPF, and other legal docs)
  return 'pessoais_legais';
}

export function getDocumentSortOrder(item: {
  categoriaOrganizacional?: IntegrationDocumentGroupId;
  documentoCodigoCanonico?: string;
  nomeExibicao?: string;
  origemColecao?: IntegrationOfficialCollection;
}): number {
  const code = normalizeForMatch(item.documentoCodigoCanonico);
  const title = normalizeForMatch(item.nomeExibicao);
  const combined = `${code} ${title}`;

  if (code === 'rg_cnh' || combined.includes('rg') || combined.includes('cnh')) return 1;
  if (code === 'cpf' || combined.includes('cpf')) return 2;
  if (code === 'aso' || (item.origemColecao === 'exams' && !combined.includes('aptidao'))) return 4;
  if (code.includes('aptidao') || combined.includes('aptidao')) return 5;
  if (item.origemColecao === 'epiDeliveries' || code.includes('epi') || combined.includes('epi')) return 6;
  if (code.includes('ordem_servico') || combined.includes('ordem de servico')) return 7;
  if (item.origemColecao === 'trainings' || /\bnr[-\s]?\d{1,2}\b/.test(combined) || combined.includes('treinamento')) {
    return 8;
  }
  if (code.includes('registro_empregado') || combined.includes('ficha de registro') || combined.includes('registro de empregado')) {
    return 9;
  }
  if (code.includes('contrato_trabalho') || combined.includes('contrato de trabalho') || combined.includes('ctps')) {
    return 10;
  }
  if (code.includes('comprovante_vinculo') || combined.includes('vinculo')) return 11;

  const group = classifyIntegrationDocumentGroup(item);
  if (group === 'pessoais_legais') return 3;
  if (group === 'saude_ocupacional') return 5;
  if (group === 'seguranca_trabalho') return 8;
  return 11;
}

export function groupItemsByMandatoryCategories(
  items: ContractorIntegrationItem[]
): Array<{
  category: IntegrationDocumentCategoryDefinition;
  items: ContractorIntegrationItem[];
}> {
  const buckets = new Map<IntegrationDocumentGroupId, ContractorIntegrationItem[]>(
    [...MANDATORY_DOCUMENT_CATEGORIES, SIMPLE_ACTIVITY_DOCUMENT_CATEGORY].map((c) => [c.id, []])
  );

  for (const item of items) {
    const groupId = classifyIntegrationDocumentGroup(item);
    const bucket = buckets.get(groupId) || buckets.get('pessoais_legais')!;
    bucket.push(item);
  }

  const orderedCategories: IntegrationDocumentCategoryDefinition[] = [
    ...MANDATORY_DOCUMENT_CATEGORIES,
    ...((buckets.get('atividade_simples') || []).length > 0
      ? [SIMPLE_ACTIVITY_DOCUMENT_CATEGORY]
      : []),
  ];

  return orderedCategories.map((category) => {
    const list = buckets.get(category.id) || [];
    list.sort((a, b) => {
      const orderDiff = getDocumentSortOrder(a) - getDocumentSortOrder(b);
      if (orderDiff !== 0) return orderDiff;
      return a.nomeExibicao.localeCompare(b.nomeExibicao, 'pt-BR');
    });
    return {
      category,
      items: list,
    };
  });
}

export function suggestDocumentCatalogForFilename(
  fileName: string,
  employeeChecklistItems: ContractorIntegrationItem[]
): {
  matchedItemId?: string;
  categoriaId: IntegrationDocumentGroupId;
  codigoCanonico: string;
  nomeExibicao: string;
  origemColecao: IntegrationOfficialCollection;
  semValidade: boolean;
} {
  const norm = normalizeForMatch(fileName);

  // 1. Try matching specific NR training requirement already in the employee checklist first
  const nrMatch = norm.match(/nr[-_\s]?(\d{1,2})/);
  if (nrMatch) {
    const nrNum = nrMatch[1];
    const matchingItem = employeeChecklistItems.find((item) => {
      const itemCode = normalizeForMatch(item.documentoCodigoCanonico);
      const itemName = normalizeForMatch(item.nomeExibicao);
      return (
        itemCode.includes(`nr-${nrNum}`) ||
        itemCode.includes(`nr${nrNum}`) ||
        itemName.includes(`nr-${nrNum}`) ||
        itemName.includes(`nr ${nrNum}`)
      );
    });
    if (matchingItem) {
      return {
        matchedItemId: matchingItem.id,
        categoriaId: classifyIntegrationDocumentGroup(matchingItem),
        codigoCanonico: matchingItem.documentoCodigoCanonico,
        nomeExibicao: matchingItem.nomeExibicao,
        origemColecao: matchingItem.origemColecao,
        semValidade: Boolean(matchingItem.semValidade),
      };
    }
  }

  // 2. Try matching against the 11 standard catalog entries
  for (const entry of EMPLOYEE_DOCUMENT_CATALOG) {
    const hit = entry.palavrasChaveArquivo.some((kw) => norm.includes(normalizeForMatch(kw)));
    if (hit) {
      // Check if an existing checklist item corresponds to this canonical code / collection
      const existingItem = employeeChecklistItems.find((item) => {
        const itemCode = normalizeForMatch(item.documentoCodigoCanonico);
        if (itemCode === normalizeForMatch(entry.codigoCanonico)) return true;
        if (entry.codigoCanonico === 'ASO' && item.origemColecao === 'exams') return true;
        if (entry.codigoCanonico === 'FICHA_EPI' && item.origemColecao === 'epiDeliveries') return true;
        if (entry.codigoCanonico === 'ORDEM_SERVICO' && itemCode.includes('ordem_servico')) return true;
        return false;
      });
      if (existingItem) {
        return {
          matchedItemId: existingItem.id,
          categoriaId: classifyIntegrationDocumentGroup(existingItem),
          codigoCanonico: existingItem.documentoCodigoCanonico,
          nomeExibicao: existingItem.nomeExibicao,
          origemColecao: existingItem.origemColecao,
          semValidade: Boolean(existingItem.semValidade ?? entry.semValidadePadrao),
        };
      }
      return {
        categoriaId: entry.categoriaId,
        codigoCanonico: entry.codigoCanonico,
        nomeExibicao: entry.nomeExibicao,
        origemColecao: entry.origemColecao,
        semValidade: Boolean(entry.semValidadePadrao),
      };
    }
  }

  // 3. Fallback to "Outros documentos legais exigidos pela empresa ou atividade"
  const fallback = EMPLOYEE_DOCUMENT_CATALOG[2];
  return {
    categoriaId: fallback.categoriaId,
    codigoCanonico: fallback.codigoCanonico,
    nomeExibicao: fallback.nomeExibicao,
    origemColecao: fallback.origemColecao,
    semValidade: Boolean(fallback.semValidadePadrao),
  };
}
