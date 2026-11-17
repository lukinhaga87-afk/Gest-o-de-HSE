import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Lock,
  ArrowRight,
  AlertCircle,
  ShieldAlert,
  CreditCard,
  KeyRound,
  CheckCircle2,
  ArrowLeft,
  MessageSquare,
  Smartphone,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { maskCPFInput } from '../../utils/trafficLight';

type LoginScreenMode = 'login' | 'recovery' | 'change_password';

export const LoginPage: React.FC = () => {
  const {
    loginWithCredentials,
    changePassword,
    getRecoveryChannelsStatus,
    requestRecoveryChannel,
    resetPasswordWithCode,
  } = useAuth();

  const [mode, setMode] = useState<LoginScreenMode>('login');
  const [loading, setLoading] = useState(false);
  const [channelLoading, setChannelLoading] = useState<'whatsapp' | 'sms' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [channelInfoMessage, setChannelInfoMessage] = useState<string | null>(null);

  // Login form states - CPF is the primary identifier
  const [loginCpf, setLoginCpf] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Recovery & Change password states
  const [recoveryCode, setRecoveryCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Channel integration status (WhatsApp / SMS - Opção B)
  const [channelsStatus, setChannelsStatus] = useState<{
    whatsappConfigured: boolean;
    smsConfigured: boolean;
  }>({ whatsappConfigured: false, smsConfigured: false });

  useEffect(() => {
    if (mode === 'recovery') {
      getRecoveryChannelsStatus().then(setChannelsStatus);
    }
  }, [mode, getRecoveryChannelsStatus]);

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const digitsOnly = rawValue.replace(/\D/g, '');
    if (digitsOnly.length > 0 && /^[0-9.\-\s]+$/.test(rawValue)) {
      setLoginCpf(maskCPFInput(rawValue));
    } else {
      setLoginCpf(rawValue);
    }
  };

  const handleRecoveryCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
    if (cleaned.length > 4) {
      setRecoveryCode(`${cleaned.slice(0, 4)}-${cleaned.slice(4)}`);
    } else {
      setRecoveryCode(cleaned);
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
      setSuccessMessage(null);
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

  const handleRequestChannel = async (canal: 'whatsapp' | 'sms') => {
    setErrorMessage(null);
    setChannelInfoMessage(null);

    const cpfDigits = loginCpf.replace(/\D/g, '');
    if (cpfDigits.length !== 11) {
      setErrorMessage('Informe seu CPF cadastrado com 11 dígitos antes de solicitar o envio.');
      return;
    }

    try {
      setChannelLoading(canal);
      const res = await requestRecoveryChannel(loginCpf, canal);
      if (!res.success) {
        setErrorMessage(res.message || 'Não foi possível concluir a recuperação.');
        return;
      }
      setChannelInfoMessage(res.message);
    } catch {
      setErrorMessage('Não foi possível concluir a recuperação.');
    } finally {
      setChannelLoading(null);
    }
  };

  const cleanCpfDigits = loginCpf.replace(/\D/g, '');
  const trimmedNewPassword = newPassword.trim();
  const hasMinLength = trimmedNewPassword.length >= 8;
  const hasLettersAndNumbers =
    /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(trimmedNewPassword) && /\d/.test(trimmedNewPassword);
  const differsFromCpf =
    cleanCpfDigits.length !== 11 || trimmedNewPassword.replace(/\D/g, '') !== cleanCpfDigits;
  const matchesConfirmation =
    trimmedNewPassword.length > 0 && trimmedNewPassword === confirmNewPassword.trim();

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setChannelInfoMessage(null);

    if (
      cleanCpfDigits.length !== 11 ||
      !recoveryCode.trim() ||
      !trimmedNewPassword ||
      !confirmNewPassword.trim()
    ) {
      setErrorMessage(
        'Preencha o CPF cadastrado, o código de recuperação e a confirmação da nova senha.'
      );
      return;
    }

    if (!hasMinLength || !hasLettersAndNumbers) {
      setErrorMessage(
        'A nova senha deve conter no mínimo 8 caracteres combinando letras e números.'
      );
      return;
    }

    if (!differsFromCpf) {
      setErrorMessage('A nova senha não pode ser igual ao número do CPF.');
      return;
    }

    if (!matchesConfirmation) {
      setErrorMessage('A confirmação da nova senha não confere.');
      return;
    }

    try {
      setLoading(true);
      const res = await resetPasswordWithCode({
        cpf: loginCpf,
        code: recoveryCode,
        newPassword: trimmedNewPassword,
        confirmPassword: confirmNewPassword.trim(),
      });

      if (!res.success) {
        setErrorMessage(res.message || 'Não foi possível concluir a recuperação.');
        return;
      }

      setSuccessMessage('Senha alterada com sucesso.');
      setRecoveryCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      setLoginPassword('');
      setMode('login');
    } catch (err) {
      console.error(err);
      setErrorMessage('Não foi possível concluir a recuperação.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!loginCpf.trim() || !currentPassword.trim() || !newPassword.trim() || !confirmNewPassword.trim()) {
      setErrorMessage('Preencha o CPF, a senha atual e a nova senha nos dois campos.');
      return;
    }

    if (newPassword.trim().length < 6) {
      setErrorMessage('A nova senha deve conter no mínimo 6 caracteres.');
      return;
    }

    if (newPassword.trim() !== confirmNewPassword.trim()) {
      setErrorMessage('A confirmação da nova senha não confere.');
      return;
    }

    if (currentPassword.trim() === newPassword.trim()) {
      setErrorMessage('A nova senha deve ser diferente da senha atual.');
      return;
    }

    try {
      setLoading(true);
      const res = await changePassword(loginCpf, currentPassword, newPassword);
      if (!res.success) {
        setErrorMessage(res.message);
        return;
      }

      setSuccessMessage('Senha alterada com sucesso.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setLoginPassword('');
      setMode('login');
    } catch (err) {
      console.error(err);
      setErrorMessage('Falha ao alterar a senha. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (nextMode: LoginScreenMode) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setChannelInfoMessage(null);
    setRecoveryCode('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setMode(nextMode);
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
        <div className="mb-5 p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs flex items-start gap-2.5">
          <ShieldAlert size={16} className="shrink-0 mt-0.5 text-blue-400" />
          <p className="leading-relaxed text-[11px] text-slate-300">
            {mode === 'login' ? (
              <>
                Acesso individual por <strong className="text-white">CPF</strong>. O cadastramento e edição de perfis é gerenciado exclusivamente pelo <strong className="text-white">Administrador de EHS</strong>.
              </>
            ) : mode === 'recovery' ? (
              <>
                <strong className="text-white">Recuperação e Redefinição de Senha:</strong> informe seu CPF cadastrado e utilize o <strong className="text-white">código temporário de uso único</strong> (validade de 10 minutos).
              </>
            ) : (
              <>
                Para alterar sua senha diretamente, informe seu <strong className="text-white">CPF</strong>, confirme a <strong className="text-white">senha atual</strong> e defina a nova senha individual.
              </>
            )}
          </p>
        </div>

        {/* Success message alert */}
        {successMessage && (
          <div className="mb-5 p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-start gap-2.5">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Info message alert */}
        {channelInfoMessage && (
          <div className="mb-5 p-3 rounded-xl bg-blue-950/60 border border-blue-500/40 text-blue-200 text-xs flex items-start gap-2.5">
            <ShieldCheck size={16} className="shrink-0 mt-0.5 text-blue-400" />
            <span>{channelInfoMessage}</span>
          </div>
        )}

        {/* Error message alert */}
        {errorMessage && (
          <div className="mb-5 p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-start gap-2.5">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {mode === 'login' && (
          /* LOGIN FORM */
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-300">Senha</label>
                <button
                  type="button"
                  onClick={() => switchMode('recovery')}
                  className="text-[11px] font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <KeyRound size={12} />
                  <span>Trocar senha</span>
                </button>
              </div>
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
        )}

        {mode === 'recovery' && (
          /* PASSWORD RECOVERY SCREEN (CODE + CPF) */
          <form onSubmit={handleRecoverySubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                CPF cadastrado
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
            </div>

            {/* Opções de obtenção do código sem e-mail */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
              <div className="flex items-start gap-2">
                <UserCog size={14} className="text-blue-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  <strong className="text-white">Opção A – Administrador:</strong> solicite ao Administrador de EHS a geração do código temporário no painel de usuários.
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                <p className="text-[11px] text-slate-400">
                  <strong className="text-slate-200">Opção B – WhatsApp ou SMS:</strong>{' '}
                  {channelsStatus.whatsappConfigured || channelsStatus.smsConfigured
                    ? 'envio automático disponível pelo servidor:'
                    : 'serviço externo não configurado no servidor (envio automático indisponível).'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!channelsStatus.whatsappConfigured || channelLoading !== null}
                    onClick={() => handleRequestChannel('whatsapp')}
                    className="py-1.5 px-2.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-medium text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <MessageSquare size={12} />
                    <span>
                      {channelLoading === 'whatsapp'
                        ? 'Enviando...'
                        : channelsStatus.whatsappConfigured
                        ? 'Enviar WhatsApp'
                        : 'WhatsApp (Inativo)'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!channelsStatus.smsConfigured || channelLoading !== null}
                    onClick={() => handleRequestChannel('sms')}
                    className="py-1.5 px-2.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-medium text-slate-200 hover:border-blue-500/60 hover:text-blue-300 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Smartphone size={12} />
                    <span>
                      {channelLoading === 'sms'
                        ? 'Enviando...'
                        : channelsStatus.smsConfigured
                        ? 'Enviar SMS'
                        : 'SMS (Inativo)'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Código de recuperação
              </label>
              <div className="relative">
                <ShieldCheck size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  required
                  autoComplete="one-time-code"
                  value={recoveryCode}
                  onChange={handleRecoveryCodeChange}
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors font-mono tracking-widest uppercase"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Código de uso único válido por 10 minutos
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Nova senha
              </label>
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres (letras e números)"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Confirmar nova senha
              </label>
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            {/* Security checklist */}
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 grid grid-cols-2 gap-1.5 text-[10px]">
              <span className={hasMinLength ? 'text-emerald-400' : 'text-slate-500'}>
                {hasMinLength ? '✓' : '•'} Mínimo 8 caracteres
              </span>
              <span className={hasLettersAndNumbers ? 'text-emerald-400' : 'text-slate-500'}>
                {hasLettersAndNumbers ? '✓' : '•'} Letras e números
              </span>
              <span className={differsFromCpf ? 'text-emerald-400' : 'text-red-400'}>
                {differsFromCpf ? '✓' : '✕'} Diferente do CPF
              </span>
              <span className={matchesConfirmation ? 'text-emerald-400' : 'text-slate-500'}>
                {matchesConfirmation ? '✓' : '•'} Confirmação igual
              </span>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <KeyRound size={15} />
                <span>{loading ? 'Validando código e salvando...' : 'Redefinir Senha'}</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => switchMode('login')}
                className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>Voltar para o login</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => switchMode('change_password')}
                className="w-full py-1 text-[11px] text-slate-400 hover:text-blue-400 transition-colors cursor-pointer text-center"
              >
                Sabe sua senha atual? Alterar informando a senha atual
              </button>
            </div>
          </form>
        )}

        {mode === 'change_password' && (
          /* SELF-SERVICE CHANGE PASSWORD WITH CURRENT PASSWORD */
          <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
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
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Senha Atual
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Informe sua senha atual"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Nova Senha
              </label>
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Confirmar Nova Senha
              </label>
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <KeyRound size={15} />
                <span>{loading ? 'Atualizando senha...' : 'Salvar Nova Senha'}</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => switchMode('recovery')}
                className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <ShieldCheck size={14} />
                <span>Esqueci a senha (usar código de recuperação)</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => switchMode('login')}
                className="w-full py-1.5 text-slate-400 hover:text-white text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                <ArrowLeft size={13} />
                <span>Voltar para o login</span>
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="mt-6 text-center text-xs text-slate-400">
        Gestão de EHS • Sistema de Meio Ambiente, Saúde e Segurança do Trabalho
      </div>
    </div>
  );
};
