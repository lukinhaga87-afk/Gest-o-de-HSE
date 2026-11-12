import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  FileDown,
  FileSpreadsheet,
  Filter,
  Search,
  CheckCircle,
  Calendar,
  Building2,
  Users,
  Printer,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { exportToExcel, exportReportToPDF } from '../../utils/exportUtils';
import { formatDateBR, getTrafficLightStatus } from '../../utils/trafficLight';

export const ReportsView: React.FC = () => {
  const { companies, employees, documents, trainings, exams } = useSST();
  const { isSolicitante, activeEmpresaId } = useAuth();

  // Filters from Section 16
  const [empresaFilter, setEmpresaFilter] = useState<string>('todos');
  const [colaboradorFilter, setColaboradorFilter] = useState<string>('todos');
  const [setorFilter, setSetorFilter] = useState<string>('todos');
  const [cargoFilter, setCargoFilter] = useState<string>('todos');
  const [situacaoFilter, setSituacaoFilter] = useState<string>('todos');
  const [vencimentoFilter, setVencimentoFilter] = useState<string>('todos'); // 30d, vencidos, regulares
  const [tipoDadoFilter, setTipoDadoFilter] = useState<'todos' | 'documentos' | 'treinamentos' | 'exames'>('todos');

  // Available unique sectors & cargos
  const setores = useMemo(() => Array.from(new Set(employees.map((e) => e.setor))), [employees]);
  const cargos = useMemo(() => Array.from(new Set(employees.map((e) => e.cargo))), [employees]);

  // Consolidated records
  const unifiedData = useMemo(() => {
    let rows: {
      tipo: 'Documento' | 'Treinamento' | 'ASO';
      identificador: string;
      categoria: string;
      empresa: string;
      empresaId: string;
      colaborador: string;
      cargo: string;
      setor: string;
      emissao: string;
      validade: string;
      semValidade: boolean;
      situacao: string;
      farol: string;
      daysRemaining: number | null;
    }[] = [];

    // Documents
    documents.forEach((d) => {
      const colab = employees.find((e) => e.id === d.colaboradorId);
      const f = getTrafficLightStatus(d.dataValidade, d.semValidade, d.situacao);
      rows.push({
        tipo: 'Documento',
        identificador: d.nomeDocumento,
        categoria: d.categoria,
        empresa: d.empresaNome,
        empresaId: d.empresaId,
        colaborador: d.colaboradorNome || 'Geral da Empresa',
        cargo: colab?.cargo || '-',
        setor: colab?.setor || '-',
        emissao: d.dataEmissao || '',
        validade: d.dataValidade || '',
        semValidade: !!d.semValidade,
        situacao: d.situacao,
        farol: f.label,
        daysRemaining: f.daysRemaining,
      });
    });

    // Trainings
    trainings.forEach((t) => {
      const colab = employees.find((e) => e.id === t.colaboradorId);
      const f = getTrafficLightStatus(t.dataValidade, t.semValidade, t.situacao);
      rows.push({
        tipo: 'Treinamento',
        identificador: t.nomeTreinamento,
        categoria: 'Capacitação / Certificação',
        empresa: t.empresaNome,
        empresaId: t.empresaId,
        colaborador: t.colaboradorNome,
        cargo: colab?.cargo || '-',
        setor: colab?.setor || '-',
        emissao: t.dataRealizacao,
        validade: t.dataValidade || '',
        semValidade: !!t.semValidade,
        situacao: t.situacao,
        farol: f.label,
        daysRemaining: f.daysRemaining,
      });
    });

    // Exams
    exams.forEach((ex) => {
      const colab = employees.find((e) => e.id === ex.colaboradorId);
      const f = getTrafficLightStatus(ex.dataValidade, ex.semValidade, ex.situacao);
      rows.push({
        tipo: 'ASO',
        identificador: `${ex.tipoExame} (${ex.conclusao.toUpperCase()})`,
        categoria: 'Saúde Ocupacional',
        empresa: ex.empresaNome,
        empresaId: ex.empresaId,
        colaborador: ex.colaboradorNome,
        cargo: colab?.cargo || '-',
        setor: colab?.setor || '-',
        emissao: ex.dataRealizacao,
        validade: ex.dataValidade || '',
        semValidade: !!ex.semValidade,
        situacao: ex.situacao,
        farol: f.label,
        daysRemaining: f.daysRemaining,
      });
    });

    // Filter by Solicitante if applicable
    if (isSolicitante && activeEmpresaId) {
      rows = rows.filter((r) => r.empresaId === activeEmpresaId);
    }

    // Apply User Filters
    if (tipoDadoFilter === 'documentos') rows = rows.filter((r) => r.tipo === 'Documento');
    if (tipoDadoFilter === 'treinamentos') rows = rows.filter((r) => r.tipo === 'Treinamento');
    if (tipoDadoFilter === 'exames') rows = rows.filter((r) => r.tipo === 'ASO');

    if (empresaFilter !== 'todos') rows = rows.filter((r) => r.empresaId === empresaFilter);
    if (colaboradorFilter !== 'todos') rows = rows.filter((r) => r.colaborador.includes(colaboradorFilter));
    if (setorFilter !== 'todos') rows = rows.filter((r) => r.setor === setorFilter);
    if (cargoFilter !== 'todos') rows = rows.filter((r) => r.cargo === cargoFilter);
    if (situacaoFilter !== 'todos') rows = rows.filter((r) => r.situacao === situacaoFilter);

    if (vencimentoFilter === 'vencidos') {
      rows = rows.filter((r) => r.daysRemaining !== null && r.daysRemaining < 0);
    } else if (vencimentoFilter === 'proximos_30d') {
      rows = rows.filter((r) => r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining <= 30);
    } else if (vencimentoFilter === 'validos') {
      rows = rows.filter((r) => r.semValidade || (r.daysRemaining !== null && r.daysRemaining > 30));
    }

    return rows;
  }, [
    documents,
    trainings,
    exams,
    employees,
    isSolicitante,
    activeEmpresaId,
    tipoDadoFilter,
    empresaFilter,
    colaboradorFilter,
    setorFilter,
    cargoFilter,
    situacaoFilter,
    vencimentoFilter,
  ]);

  const handleExportExcel = () => {
    const exportData = unifiedData.map((r) => ({
      Tipo: r.tipo,
      Registro: r.identificador,
      Categoria: r.categoria,
      Empresa: r.empresa,
      Colaborador: r.colaborador,
      Cargo: r.cargo,
      Setor: r.setor,
      Data_Emissao: formatDateBR(r.emissao),
      Data_Validade: r.semValidade ? 'Sem Vencimento' : formatDateBR(r.validade),
      Situacao: r.situacao.toUpperCase(),
      Status_Farol: r.farol,
    }));
    exportToExcel(exportData, `Relatorio_SST_${new Date().toISOString().split('T')[0]}`);
  };

  const handleExportPDF = () => {
    const headers = ['Tipo', 'Registro', 'Empresa', 'Colaborador', 'Cargo', 'Validade', 'Situação'];
    const rows = unifiedData.map((r) => [
      r.tipo,
      r.identificador,
      r.empresa,
      r.colaborador,
      r.cargo,
      r.semValidade ? 'Sem Vencimento' : formatDateBR(r.validade),
      r.situacao.toUpperCase(),
    ]);
    exportReportToPDF(
      'Relatório Geral de Conformidade SST',
      headers,
      rows,
      `Relatorio_Geral_SST_${new Date().toISOString().split('T')[0]}`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="text-blue-500" />
            Central de Relatórios e Auditoria SST
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Filtros cruzados, controle de prazos e exportação oficial em formatos PDF e Excel (.xlsx)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-md shadow-red-600/30 transition-all"
            title="Exportar em PDF"
          >
            <FileDown size={15} />
            Exportar PDF
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/30 transition-all"
            title="Exportar em Excel (.xlsx)"
          >
            <FileSpreadsheet size={15} />
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Multi-Filters Grid (Section 16 Specification) */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            <Filter size={14} className="text-blue-400" /> Filtros Avançados de Pesquisa
          </span>
          <span className="text-xs text-slate-400">
            {unifiedData.length} registros correspondentes
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
          {/* Tipo de Dado */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Módulo / Tipo</label>
            <select
              value={tipoDadoFilter}
              onChange={(e: any) => setTipoDadoFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white"
            >
              <option value="todos">Todos os Tipos</option>
              <option value="documentos">Documentos</option>
              <option value="treinamentos">Treinamentos</option>
              <option value="exames">Exames e ASO</option>
            </select>
          </div>

          {/* Empresa */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Empresa Contratada</label>
            <select
              value={empresaFilter}
              onChange={(e) => setEmpresaFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white"
            >
              <option value="todos">Todas as Empresas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomeFantasia || c.razaoSocial}
                </option>
              ))}
            </select>
          </div>

          {/* Setor */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Setor / Área</label>
            <select
              value={setorFilter}
              onChange={(e) => setSetorFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white"
            >
              <option value="todos">Todos os Setores</option>
              {setores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Cargo */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Cargo / Função</label>
            <select
              value={cargoFilter}
              onChange={(e) => setCargoFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white"
            >
              <option value="todos">Todos os Cargos</option>
              {cargos.map((cg) => (
                <option key={cg} value={cg}>
                  {cg}
                </option>
              ))}
            </select>
          </div>

          {/* Situação */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Situação Documental</label>
            <select
              value={situacaoFilter}
              onChange={(e) => setSituacaoFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white"
            >
              <option value="todos">Todas</option>
              <option value="aprovado">Aprovado</option>
              <option value="pendente">Pendente</option>
              <option value="reprovado">Reprovado</option>
            </select>
          </div>

          {/* Período de Vencimento */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Vencimento</label>
            <select
              value={vencimentoFilter}
              onChange={(e) => setVencimentoFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-medium"
            >
              <option value="todos">Todos os Prazos</option>
              <option value="proximos_30d">Próximos 30 Dias (Amarelo)</option>
              <option value="vencidos">Vencidos (Vermelho)</option>
              <option value="validos">Válidos &gt; 30d (Verde)</option>
            </select>
          </div>

          {/* Limpar */}
          <div className="flex items-end">
            <button
              onClick={() => {
                setEmpresaFilter('todos');
                setColaboradorFilter('todos');
                setSetorFilter('todos');
                setCargoFilter('todos');
                setSituacaoFilter('todos');
                setVencimentoFilter('todos');
                setTipoDadoFilter('todos');
              }}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 text-[11px] transition-colors"
            >
              Limpar Filtros
            </button>
          </div>
        </div>
      </div>

      {/* Report Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Tipo & Registro</th>
                <th className="px-4 py-3">Empresa Contratada</th>
                <th className="px-4 py-3">Colaborador / Setor</th>
                <th className="px-4 py-3">Emissão & Validade</th>
                <th className="px-4 py-3">Farol SST</th>
                <th className="px-4 py-3">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {unifiedData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    Nenhum registro encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                unifiedData.slice(0, 100).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-850/50">
                    <td className="px-4 py-3">
                      <span className="text-[10px] uppercase font-bold text-blue-400 block">
                        {row.tipo}
                      </span>
                      <span className="font-semibold text-white">{row.identificador}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.empresa}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-200 font-medium">{row.colaborador}</div>
                      <div className="text-[11px] text-slate-400">
                        {row.cargo} • {row.setor}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-300">Emissão: {formatDateBR(row.emissao)}</div>
                      <div className="text-slate-400 text-[11px]">
                        Validade: {row.semValidade ? 'Sem Vencimento' : formatDateBR(row.validade)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
                          row.farol.includes('Válido')
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : row.farol.includes('Vence')
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            : row.farol.includes('Vencido')
                            ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {row.farol}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {row.situacao}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
