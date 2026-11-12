import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  ArrowRight,
  AlertCircle,
  ShieldAlert,
  CreditCard,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { maskCPFInput } from '../../utils/trafficLight';

export const LoginPage: React.FC = () => {
  const { loginWithCredentials } = useAuth();

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Login form states - CPF is the primary identifier
  const [loginCpf, setLoginCpf] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    // If user is typing mostly digits, format as CPF mask automatically
    const digitsOnly = rawValue.replace(/\D/g, '');
    if (digitsOnly.length > 0 && /^[0-9.\-\s]+$/.test(rawValue)) {
      setLoginCpf(maskCPFInput(rawValue));
    } else {
      setLoginCpf(rawValue);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginCpf.trim() || !loginPassword.trim()) {
      setErrorMessage('Por favor, informe seu CPF e sua senha.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await loginWithCredentials(loginCpf, loginPassword);
      if (!res.success) {
        setErrorMessage(res.message || 'Credenciais inválidas. Verifique seu CPF e senha.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Falha ao autenticar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 selection:bg-blue-600 selection:text-white relative overflow-hidden">
      {/* Background Navy Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Login Card */}
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 relative z-10 backdrop-blur-sm">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-14 w-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-xl shadow-blue-600/30 mb-3 border border-blue-500/40">
            <ShieldCheck size={32} className="stroke-[2.5]" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
            Gestão de EHS
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
              PRO
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Sistema de Meio Ambiente, Saúde e Segurança do Trabalho
          </p>
        </div>

        {/* Access Notice Badge */}
        <div className="mb-6 p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs flex items-start gap-2.5">
          <ShieldAlert size={16} className="shrink-0 mt-0.5 text-blue-400" />
          <p className="leading-relaxed text-[11px] text-slate-300">
            Acesso individual por <strong className="text-white">CPF</strong>. O cadastramento e edição de perfis é gerenciado exclusivamente pelo <strong className="text-white">Administrador de EHS</strong>.
          </p>
        </div>

        {/* Error message alert */}
        {errorMessage && (
          <div className="mb-5 p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-start gap-2.5">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* LOGIN FORM */}
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Número do CPF
            </label>
            <div className="relative">
              <CreditCard size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                required
                autoComplete="username"
                value={loginCpf}
                onChange={handleCpfChange}
                placeholder="000.000.000-00"
                maxLength={14}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors font-mono"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Informe os 11 dígitos do seu CPF cadastrado
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Senha</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>{loading ? 'Validando CPF e credenciais...' : 'Acessar a Plataforma'}</span>
            <ArrowRight size={15} />
          </button>
        </form>
      </div>

      <div className="mt-6 text-center text-xs text-slate-400">
        Gestão de EHS • Sistema de Meio Ambiente, Saúde e Segurança do Trabalho
      </div>
    </div>
  );
};
