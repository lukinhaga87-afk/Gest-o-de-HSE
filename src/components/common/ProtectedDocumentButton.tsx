import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  buildProtectedDownloadUrl,
  classifyDocumentUrl,
  extractFileNameFromContentDisposition,
  resolveProtectedDocumentUrl,
} from '../../utils/protectedDocumentViewer';

interface ProtectedDocumentButtonProps {
  url?: string | null;
  fileName?: string;
  title?: string;
  label?: string;
  className?: string;
  icon?: React.ReactNode;
}

interface LoadedBlobPreview {
  objectUrl: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  sha256?: string;
}

export const ProtectedDocumentButton: React.FC<ProtectedDocumentButtonProps> = ({
  url,
  fileName,
  title = 'Visualizar documento',
  label,
  className = 'p-1.5 text-blue-400 hover:text-white rounded hover:bg-slate-800',
  icon,
}) => {
  const { authorizedFetch, isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LoadedBlobPreview | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const urlKind = classifyDocumentUrl(url);
  const resolvedUrl = resolveProtectedDocumentUrl(url, fileName);

  const revokeCurrentBlob = useCallback(() => {
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
  }, []);

  const closeModal = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    revokeCurrentBlob();
    setPreview(null);
    setError(null);
    setLoading(false);
    setIsOpen(false);
  }, [revokeCurrentBlob]);

  // Immediately revoke Blob URL and close modal on unmount or logout
  useEffect(() => {
    if (!isAuthenticated && isOpen) {
      closeModal();
    }
  }, [isAuthenticated, isOpen, closeModal]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      revokeCurrentBlob();
    };
  }, [revokeCurrentBlob]);

  const loadDocumentIntoModal = useCallback(async () => {
    if (!url || urlKind === 'invalid') {
      setError('Referência documental inválida ou bloqueada por política de segurança.');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    revokeCurrentBlob();
    setPreview(null);
    setError(null);
    setLoading(true);

    try {
      if (urlKind === 'protected_api') {
        const res = await authorizedFetch(resolvedUrl, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!res.ok) {
          let message = 'Não foi possível abrir o documento protegido.';
          try {
            const payload = await res.json();
            if (payload?.message) {
              message = payload.message;
            }
          } catch {
            if (res.status === 401) {
              message = 'Sessão expirada ou não autenticada. Faça login novamente para visualizar este documento.';
            } else if (res.status === 403) {
              message = 'Acesso negado: seu perfil ou empresa não tem permissão para visualizar este documento.';
            } else if (res.status === 404) {
              message = 'Arquivo documental não localizado no armazenamento privado.';
            } else if (res.status === 503) {
              message = 'Armazenamento privado ou autenticação indisponível no servidor no momento.';
            }
          }
          throw new Error(message);
        }

        const blob = await res.blob();
        const resolvedName = extractFileNameFromContentDisposition(
          res.headers.get('Content-Disposition'),
          fileName || 'documento.pdf'
        );
        const mimeType =
          res.headers.get('Content-Type') || blob.type || 'application/octet-stream';
        const sha256 = res.headers.get('X-File-Sha256') || undefined;
        const objectUrl = URL.createObjectURL(blob);
        activeObjectUrlRef.current = objectUrl;
        setPreview({
          objectUrl,
          mimeType,
          fileName: resolvedName,
          sizeBytes: blob.size,
          sha256,
        });
      } else if (urlKind === 'legacy_data') {
        const res = await fetch(url, { signal: controller.signal });
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        activeObjectUrlRef.current = objectUrl;
        setPreview({
          objectUrl,
          mimeType: blob.type || 'application/pdf',
          fileName: fileName || 'documento.pdf',
          sizeBytes: blob.size,
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err?.message || 'Erro ao carregar documento protegido.');
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch, fileName, resolvedUrl, revokeCurrentBlob, url, urlKind]);

  const handleOpen = () => {
    setIsOpen(true);
    if (urlKind === 'protected_api' || urlKind === 'legacy_data') {
      void loadDocumentIntoModal();
    }
  };

  const handleAuthenticatedDownload = async () => {
    if (!url) return;
    if (preview?.objectUrl) {
      const a = document.createElement('a');
      a.href = preview.objectUrl;
      a.download = preview.fileName || fileName || 'documento.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if (urlKind !== 'protected_api') return;
    setDownloading(true);
    setError(null);
    try {
      const downloadUrl = buildProtectedDownloadUrl(resolvedUrl || url, fileName);
      const res = await authorizedFetch(downloadUrl, { method: 'GET' });
      if (!res.ok) {
        let msg = 'Não foi possível baixar o documento protegido.';
        try {
          const payload = await res.json();
          if (payload?.message) msg = payload.message;
        } catch {
          // keep default message
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const resolvedName = extractFileNameFromContentDisposition(
        res.headers.get('Content-Disposition'),
        fileName || 'documento.pdf'
      );
      const tempUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = tempUrl;
      a.download = resolvedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(tempUrl), 1000);
    } catch (err: any) {
      setError(err?.message || 'Erro ao baixar arquivo protegido.');
    } finally {
      setDownloading(false);
    }
  };

  if (!url || urlKind === 'invalid') {
    return null;
  }

  const isPdf = preview?.mimeType?.toLowerCase().includes('pdf');
  const isImage = preview?.mimeType?.toLowerCase().startsWith('image/');

  const modalContent =
    isOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => {
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <div className="w-full max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              {/* Header */}
              <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-4">
                <div className="min-w-0 flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
                    {urlKind === 'protected_api' ? <Lock size={16} /> : <FileText size={16} />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">
                      {preview?.fileName || fileName || title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      {urlKind === 'protected_api' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <ShieldCheck size={12} /> Leitura autenticada via armazenamento privado (sessão temporária revogável)
                        </span>
                      ) : urlKind === 'legacy_data' ? (
                        <span>Documento legado em anexo</span>
                      ) : (
                        <span>Referência externa</span>
                      )}
                      {preview?.sizeBytes ? (
                        <span className="font-mono text-slate-500">
                          • {(preview.sizeBytes / 1024).toFixed(1)} KB
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {(preview?.objectUrl || urlKind === 'protected_api') && (
                    <button
                      type="button"
                      onClick={handleAuthenticatedDownload}
                      disabled={loading || downloading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                    >
                      {downloading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      Baixar
                    </button>
                  )}

                  {urlKind === 'external_http' && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                    >
                      <ExternalLink size={14} />
                      Abrir Link Externo
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={closeModal}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    aria-label="Fechar visualizador"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-h-[420px] bg-slate-950/90 flex items-center justify-center overflow-auto p-4">
                {loading && (
                  <div className="flex flex-col items-center gap-3 text-slate-300">
                    <Loader2 size={32} className="animate-spin text-blue-400" />
                    <p className="text-xs font-medium">
                      Validando permissão e carregando documento protegido...
                    </p>
                  </div>
                )}

                {!loading && error && (
                  <div className="max-w-md text-center space-y-3 p-6 rounded-xl bg-red-950/30 border border-red-500/30">
                    <AlertTriangle size={32} className="mx-auto text-red-400" />
                    <p className="text-sm font-semibold text-red-200">
                      Não foi possível exibir o documento
                    </p>
                    <p className="text-xs text-red-300/90">{error}</p>
                    <button
                      type="button"
                      onClick={() => void loadDocumentIntoModal()}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                {!loading && !error && urlKind === 'external_http' && (
                  <div className="max-w-md text-center space-y-3 p-6 rounded-xl bg-slate-900 border border-slate-800">
                    <ExternalLink size={32} className="mx-auto text-blue-400" />
                    <p className="text-sm font-semibold text-white">Documento em link externo</p>
                    <p className="text-xs text-slate-400 break-all">{url}</p>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                    >
                      <ExternalLink size={14} /> Abrir em nova aba
                    </a>
                  </div>
                )}

                {!loading && !error && preview && isPdf && (
                  <iframe
                    src={preview.objectUrl}
                    title={preview.fileName}
                    className="w-full h-[72vh] rounded-lg border border-slate-800 bg-white"
                  />
                )}

                {!loading && !error && preview && isImage && (
                  <img
                    src={preview.objectUrl}
                    alt={preview.fileName}
                    className="max-w-full max-h-[72vh] object-contain rounded-lg border border-slate-800"
                  />
                )}

                {!loading && !error && preview && !isPdf && !isImage && (
                  <div className="max-w-md text-center space-y-3 p-6 rounded-xl bg-slate-900 border border-slate-800">
                    <FileText size={32} className="mx-auto text-blue-400" />
                    <p className="text-sm font-semibold text-white">{preview.fileName}</p>
                    <p className="text-xs text-slate-400">
                      Pré-visualização inline indisponível para o formato ({preview.mimeType}). Utilize o botão Baixar acima para abrir o arquivo autenticado.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-2.5 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between text-[11px] text-slate-400">
                <span className="truncate">
                  {preview?.sha256
                    ? `Integridade SHA-256 verificada: ${preview.sha256.slice(0, 16)}...`
                    : 'Acesso monitorado e revogado automaticamente ao fechar ou encerrar sessão.'}
                </span>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={className}
        title={title}
        aria-label={label || title}
      >
        {icon ?? (!label ? <FileText size={15} /> : null)}
        {label ? <span>{label}</span> : null}
      </button>
      {modalContent}
    </>
  );
};
