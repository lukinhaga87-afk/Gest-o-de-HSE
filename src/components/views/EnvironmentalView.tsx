import React, { useState } from 'react';
import { TreePine, Plus, Search, Calendar, FileText, X } from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { EnvironmentalDoc } from '../../types/sst';
import { formatDateBR } from '../../utils/trafficLight';

export const EnvironmentalView: React.FC = () => {
  const { environmentalDocs, addEnvironmentalDoc, updateEnvironmentalDoc } = useSST();
  const { canEdit } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState<Omit<EnvironmentalDoc, 'id'>>({
    nome: '',
    orgaoEmissor: '',
    numeroLicenca: '',
    dataEmissao: new Date().toISOString().split('T')[0],
    dataValidade: '',
    semValidade: false,
    situacao: 'valido',
    anexoUrl: '',
  });

  const filtered = environmentalDocs.filter((env) => {
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        env.nome.toLowerCase().includes(q) ||
        env.orgaoEmissor.toLowerCase().includes(q) ||
        env.numeroLicenca.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleOpenModal = () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 2);

    setFormData({
      nome: '',
      orgaoEmissor: 'Órgão Ambiental Estadual',
      numeroLicenca: '',
      dataEmissao: new Date().toISOString().split('T')[0],
      dataValidade: nextYear.toISOString().split('T')[0],
      semValidade: false,
      situacao: 'valido',
      anexoUrl: '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome.trim() || !formData.orgaoEmissor.trim()) {
      alert('Nome e órgão emissor são obrigatórios.');
      return;
    }
    try {
      await addEnvironmentalDoc(formData);
      setIsModalOpen(false);
    } catch (e) {
      console.error(e);
      alert('Erro ao registrar documento ambiental.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <TreePine className="text-emerald-500" />
            Gestão Ambiental e Licenciamento
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Controle de Licenças Ambientais (LP, LI, LO), CADRI, MTR, Outorgas e PGRS
          </p>
        </div>

        {canEdit && (
          <button
            onClick={handleOpenModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30"
          >
            <Plus size={16} />
            Cadastrar Licença Ambiental
          </button>
        )}
      </div>

      <div className="flex items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por Licença, Órgão ou Número..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-slate-900 rounded-xl border border-slate-800">
            <TreePine size={40} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-semibold text-slate-300">Nenhum documento ambiental cadastrado</p>
            <p className="text-xs text-slate-400 mt-1">Cadastre licenças de operação ou certificados de resíduos.</p>
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="rounded-xl bg-slate-900 border border-slate-800 p-4 hover:border-slate-700 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {item.orgaoEmissor}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.situacao === 'valido'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : item.situacao === 'em_renovacao'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {item.situacao.replace('_', ' ')}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-white mt-2.5">{item.nome}</h3>
                <p className="text-xs text-slate-300 font-mono mt-0.5">Nº: {item.numeroLicenca || '-'}</p>
                <div className="mt-3 p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1 text-xs">
                  <p className="text-slate-400">Emissão: {formatDateBR(item.dataEmissao)}</p>
                  <p className="text-slate-400">
                    Validade: {item.semValidade ? 'Sem Vencimento' : formatDateBR(item.dataValidade)}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Cadastrar Licença ou Documento Ambiental</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Nome do Documento / Licença <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="Ex: Licença de Operação (LO), CADRI Resíduos Classe I, MTR Coleta"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Órgão Emissor <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.orgaoEmissor}
                    onChange={(e) => setFormData({ ...formData, orgaoEmissor: e.target.value })}
                    placeholder="Ex: CETESB, IBAMA, INEA"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Número da Licença</label>
                  <input
                    type="text"
                    value={formData.numeroLicenca}
                    onChange={(e) => setFormData({ ...formData, numeroLicenca: e.target.value })}
                    placeholder="Ex: LO-2026/089"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Data Emissão</label>
                  <input
                    type="date"
                    required
                    value={formData.dataEmissao}
                    onChange={(e) => setFormData({ ...formData, dataEmissao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Data Validade</label>
                  <input
                    type="date"
                    value={formData.dataValidade}
                    onChange={(e) => setFormData({ ...formData, dataValidade: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded bg-slate-800 text-slate-300"
                >
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white font-semibold">
                  Salvar Licença
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
