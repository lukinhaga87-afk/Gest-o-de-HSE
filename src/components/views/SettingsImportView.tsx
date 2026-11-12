import React, { useState } from 'react';
import {
  Settings,
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Building2,
  Users,
  Database,
  Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useSST } from '../../context/SSTContext';
import { INITIAL_COMPANIES, INITIAL_EMPLOYEES } from '../../utils/initialData';
import { formatCPF, formatCNPJ } from '../../utils/trafficLight';

interface ParsedRow {
  tipo: 'empresa' | 'colaborador';
  razaoSocial?: string;
  cnpj?: string;
  nomeCompleto?: string;
  cpf?: string;
  cargo?: string;
  setor?: string;
  empresaVinculada?: string;
  isDuplicado: boolean;
  statusMsg: string;
}

export const SettingsImportView: React.FC = () => {
  const { companies, employees, seedInitialBenchmarkData, addCompany, addEmployee } = useSST();

  const [loadingSeed, setLoadingSeed] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState(false);

  // File Upload & Preview States
  const [fileData, setFileData] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // One-click Benchmark Seed
  const handleSeedBenchmark = async () => {
    try {
      setLoadingSeed(true);
      setSeedSuccess(false);
      await seedInitialBenchmarkData();
      setSeedSuccess(true);
      setTimeout(() => setSeedSuccess(false), 4000);
    } catch (e) {
      console.error(e);
      alert('Erro ao carregar dados de benchmark.');
    } finally {
      setLoadingSeed(false);
    }
  };

  // CSV / Excel File Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data: any[] = XLSX.utils.sheet_to_json(ws);

        // Parse and analyze for duplicates
        const parsed: ParsedRow[] = data.map((row) => {
          // Identify if employee or company row
          const cpf = row.CPF || row.cpf || row.Cpf;
          const cnpj = row.CNPJ || row.cnpj || row.Cnpj;
          const nome = row.Nome || row.nome || row.NomeCompleto || row['Nome Completo'];
          const razao = row.RazaoSocial || row.razao_social || row['Razão Social'] || row.Empresa;

          if (cpf) {
            const cleanCpf = String(cpf).replace(/\D/g, '');
            const exists = employees.some((e) => e.cpf.replace(/\D/g, '') === cleanCpf);
            return {
              tipo: 'colaborador',
              nomeCompleto: nome || 'Não informado',
              cpf: String(cpf),
              cargo: row.Cargo || row.cargo || 'Geral',
              setor: row.Setor || row.setor || 'Operacional',
              empresaVinculada: razao || row.Empresa || 'Empresa Padrão',
              isDuplicado: exists,
              statusMsg: exists ? 'Registro duplicado (CPF já existente)' : 'Pronto para importar',
            };
          } else {
            const cleanCnpj = cnpj ? String(cnpj).replace(/\D/g, '') : '';
            const exists = companies.some((c) => c.cnpj.replace(/\D/g, '') === cleanCnpj);
            return {
              tipo: 'empresa',
              razaoSocial: razao || nome || 'Empresa Nova',
              cnpj: cnpj ? String(cnpj) : 'Não informado',
              isDuplicado: exists,
              statusMsg: exists ? 'Registro duplicado (CNPJ já existente)' : 'Pronto para importar',
            };
          }
        });

        setFileData(parsed);
      } catch (err) {
        console.error('Erro ao ler arquivo:', err);
        alert('Não foi possível ler a planilha ou CSV. Verifique o formato.');
      }
    };
    reader.readAsBinaryString(file);
  };

  // Commit imported rows
  const handleConfirmImport = async () => {
    if (fileData.length === 0) return;
    try {
      setImporting(true);
      let compCount = 0;
      let empCount = 0;
      let dupCount = 0;

      for (const row of fileData) {
        if (row.isDuplicado) {
          dupCount++;
          continue;
        }

        if (row.tipo === 'empresa') {
          await addCompany({
            razaoSocial: row.razaoSocial || 'Empresa Importada',
            nomeFantasia: row.razaoSocial || 'Empresa Importada',
            cnpj: row.cnpj || '00.000.000/0001-00',
            responsavelLegal: 'Importado via planilha',
            responsavelSST: 'Importado via planilha',
            telefone: '(00) 0000-0000',
            email: 'contato@empresa.com.br',
            endereco: 'Não informado',
            unidadeAtendimento: 'Matriz',
            atividadeContratada: 'Serviços Terceirizados',
            dataInicioContrato: new Date().toISOString().split('T')[0],
            dataTerminoContrato: '',
            situacao: 'ativa',
          });
          compCount++;
        } else if (row.tipo === 'colaborador') {
          // Link or find existing company
          let comp = companies.find(
            (c) =>
              c.razaoSocial.toLowerCase() === (row.empresaVinculada || '').toLowerCase() ||
              c.nomeFantasia.toLowerCase() === (row.empresaVinculada || '').toLowerCase()
          );
          if (!comp) {
            comp = companies[0];
          }

          await addEmployee({
            nomeCompleto: row.nomeCompleto || 'Colaborador',
            cpf: row.cpf || '000.000.000-00',
            cargo: row.cargo || 'Operador',
            setor: row.setor || 'Operacional',
            empresaId: comp?.id || 'emp-default',
            empresaNome: comp?.razaoSocial || 'Empresa Padrão',
            situacaoCadastral: 'ativo',
            dataAdmissao: new Date().toISOString().split('T')[0],
            dataIntegracao: new Date().toISOString().split('T')[0],
          });
          empCount++;
        }
      }

      setImportResult(
        `Importação finalizada com sucesso! ${compCount} empresa(s) e ${empCount} colaborador(es) cadastrados. (${dupCount} registros duplicados ignorados sem sobreposição).`
      );
      setFileData([]);
    } catch (e) {
      console.error(e);
      alert('Erro durante o processamento da importação.');
    } finally {
      setImporting(false);
    }
  };

  // Download benchmark CSV template
  const handleDownloadTemplate = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      'Nome Completo,CPF,Cargo,Setor,Empresa\n' +
      'Carlos Eduardo da Silva,111.222.333-44,Soldador TIG,Manutenção Mecânica,Mecânica & Montagens Taurus Eireli\n' +
      'Mariana Souza Santos,222.333.444-55,Técnica de Segurança,SESMT,Construtora Alvorada Ltda\n' +
      'Roberto Antunes Lima,333.444.555-66,Eletricista,Elétrica,EletroWatts Serviços Elétricos Ltda\n';
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'Modelo_Importacao_SST.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="text-blue-500" />
          Configurações e Importação de Dados (Seção 15)
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Carga de dados de empresas e colaboradores por CSV/Excel, prevenção de duplicidades e validação prévia
        </p>
      </div>

      {/* Benchmark Seed Box (Section 15 Requirement) */}
      <div className="rounded-xl bg-slate-900 border border-blue-500/30 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-lg bg-blue-600/20 text-blue-400 shrink-0">
              <Database size={24} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                Base Inicial de Demonstração (6 Empresas e 9 Colaboradores)
              </h3>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                Conforme a Seção 15 do projeto, o sistema possui a base benchmark dos 9 colaboradores e suas respectivas 6 empresas contratadas (Alvorada, Taurus, Projeta, EletroWatts, HidroClean e LogiSafe), preservando todos os vínculos.
              </p>
            </div>
          </div>

          <button
            onClick={handleSeedBenchmark}
            disabled={loadingSeed}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all shrink-0"
          >
            <RefreshCw size={14} className={loadingSeed ? 'animate-spin' : ''} />
            {loadingSeed ? 'Verificando e Carregando...' : 'Carregar / Sincronizar Base Inicial'}
          </button>
        </div>

        {seedSuccess && (
          <div className="p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle size={16} />
            Base de dados benchmark verificada e sincronizada no Firebase Cloud Firestore!
          </div>
        )}
      </div>

      {/* CSV / Excel File Upload and Validation Section */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-emerald-400" />
              Importar Arquivo CSV ou Excel (.xlsx)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Identificação automática de colunas, prevenção de duplicidade por CPF/CNPJ e pré-visualização
            </p>
          </div>

          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-medium"
          >
            <Download size={13} />
            Baixar Modelo CSV
          </button>
        </div>

        {/* Upload dropzone */}
        <label className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-slate-950/40">
          <Upload size={36} className="text-blue-400 mb-2" />
          <span className="text-sm font-semibold text-white">
            {fileName ? `Arquivo selecionado: ${fileName}` : 'Clique para selecionar seu arquivo CSV ou Excel'}
          </span>
          <span className="text-xs text-slate-400 mt-1">
            Formatos suportados: .csv, .xlsx, .xls (Colunas: Nome Completo, CPF, Cargo, Setor, Empresa)
          </span>
          <input
            type="file"
            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        {importResult && (
          <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2.5">
            <CheckCircle size={18} className="shrink-0" />
            <span>{importResult}</span>
          </div>
        )}

        {/* Preview Table before Confirmation (Section 15 Requirement) */}
        {fileData.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">
                Pré-visualização da Importação ({fileData.length} registros identificados)
              </span>
              <button
                onClick={handleConfirmImport}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/30"
              >
                <CheckCircle size={14} />
                {importing ? 'Importando...' : 'Confirmar e Inserir no Banco de Dados'}
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/70">
              <div className="overflow-x-auto max-h-72 custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px] font-semibold sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Nome / Razão</th>
                      <th className="px-3 py-2">CPF / CNPJ</th>
                      <th className="px-3 py-2">Cargo / Atividade</th>
                      <th className="px-3 py-2">Empresa</th>
                      <th className="px-3 py-2">Validação / Duplicidade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {fileData.map((row, idx) => (
                      <tr
                        key={idx}
                        className={row.isDuplicado ? 'bg-amber-950/20' : 'hover:bg-slate-900/60'}
                      >
                        <td className="px-3 py-2 uppercase text-[10px] font-bold text-blue-400">
                          {row.tipo}
                        </td>
                        <td className="px-3 py-2 font-medium text-white">
                          {row.nomeCompleto || row.razaoSocial}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-300">
                          {row.cpf ? formatCPF(row.cpf) : row.cnpj ? formatCNPJ(row.cnpj) : '-'}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{row.cargo || '-'}</td>
                        <td className="px-3 py-2 text-slate-300">{row.empresaVinculada || '-'}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              row.isDuplicado
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {row.statusMsg}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
