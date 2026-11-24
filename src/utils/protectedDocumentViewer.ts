export type DocumentUrlKind =
  | 'protected_api'
  | 'legacy_data'
  | 'external_http'
  | 'invalid';

const ALLOWED_LEGACY_DATA_PREFIXES = [
  'data:application/pdf;',
  'data:image/jpeg;',
  'data:image/jpg;',
  'data:image/png;',
  'data:image/webp;',
];

/**
 * Classifies a stored document URL so the UI handles protected backend endpoints
 * exclusively via authenticated fetch + revocable Blob URL, while blocking dangerous schemes.
 */
export function classifyDocumentUrl(rawUrl?: string | null): DocumentUrlKind {
  if (typeof rawUrl !== 'string') return 'invalid';
  const trimmed = rawUrl.trim();
  if (!trimmed) return 'invalid';

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/html') ||
    lower.startsWith('data:image/svg+xml')
  ) {
    return 'invalid';
  }

  if (trimmed.startsWith('/api/') || trimmed.startsWith('/.netlify/functions/api/')) {
    return 'protected_api';
  }

  if (lower.startsWith('data:')) {
    return ALLOWED_LEGACY_DATA_PREFIXES.some((prefix) => lower.startsWith(prefix))
      ? 'legacy_data'
      : 'invalid';
  }

  if (lower.startsWith('https://') || lower.startsWith('http://')) {
    try {
      const parsed = new URL(trimmed);
      if (
        typeof window !== 'undefined' &&
        parsed.origin === window.location.origin &&
        (parsed.pathname.startsWith('/api/') ||
          parsed.pathname.startsWith('/.netlify/functions/api/'))
      ) {
        return 'protected_api';
      }
      return 'external_http';
    } catch {
      return 'invalid';
    }
  }

  return 'invalid';
}

export function isProtectedApiDocumentUrl(rawUrl?: string | null): boolean {
  return classifyDocumentUrl(rawUrl) === 'protected_api';
}

export function buildProtectedDownloadUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const separator = trimmed.includes('?') ? '&' : '?';
  if (/[?&]download=(1|true)(&|$)/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}${separator}download=1`;
}

export function extractFileNameFromContentDisposition(
  headerValue: string | null,
  fallbackName = 'documento.pdf'
): string {
  if (!headerValue) return fallbackName;
  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/[/\\]/g, '_');
    } catch {
      // Fallback below
    }
  }
  const quotedMatch = headerValue.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].replace(/[/\\]/g, '_');
  }
  const plainMatch = headerValue.match(/filename=([^;\s]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].replace(/["/\\]/g, '_');
  }
  return fallbackName;
}
