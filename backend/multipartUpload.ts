import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

export const MAX_UPLOAD_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

export type AllowedBinaryMimeType = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface ParsedBinaryUpload {
  buffer: Buffer;
  originalName: string;
  declaredMimeType: string;
  sizeBytes: number;
}

export interface RequestWithBinaryUpload extends Request {
  uploadedBinaryFile?: ParsedBinaryUpload;
}

const memoryUploader = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_FILE_BYTES,
    files: 1,
    fields: 50,
    fieldSize: 256 * 1024, // 256 KB max per text metadata field
  },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'arquivo', maxCount: 1 },
]);

/**
 * Inspects actual binary magic bytes (never trusts client MIME or extension).
 * Returns canonical MIME type if and only if bytes match PDF, JPEG, or PNG.
 */
export function detectRealMimeFromBuffer(buffer: Buffer): AllowedBinaryMimeType | null {
  if (!buffer || buffer.length < 4) return null;

  // PDF: "%PDF-" (25 50 44 46 2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  return null;
}

export function normalizeDeclaredMime(raw?: string): AllowedBinaryMimeType | null {
  const lower = String(raw || '').trim().toLowerCase();
  if (lower === 'application/pdf') return 'application/pdf';
  if (lower === 'image/jpeg' || lower === 'image/jpg') return 'image/jpeg';
  if (lower === 'image/png') return 'image/png';
  return null;
}

export function parseMultipartBoolean(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toLowerCase();
    if (clean === 'true' || clean === '1') return true;
    if (clean === 'false' || clean === '0' || clean === '') return false;
  }
  return undefined;
}

export function parseMultipartStringArray(val: unknown): string[] | undefined {
  if (Array.isArray(val)) {
    return val.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v).trim()).filter(Boolean);
        }
      } catch {
        // fallback to CSV split
      }
    }
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

/**
 * Middleware that parses multipart/form-data binary uploads when Content-Type is multipart/form-data,
 * while remaining transparent for JSON payloads (backwards compatibility).
 */
export function parseOptionalMultipartFile(
  req: RequestWithBinaryUpload,
  res: Response,
  next: NextFunction
): void {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    next();
    return;
  }

  memoryUploader(req, res, (err: any) => {
    if (err) {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          success: false,
          code: 'FILE_TOO_LARGE',
          message: 'O arquivo excede o tamanho máximo permitido de 4 MB (PDF, JPG ou PNG).',
        });
        return;
      }
      res.status(400).json({
        success: false,
        code: 'MULTIPART_PARSE_ERROR',
        message: err?.message || 'Erro ao processar envio multipart do arquivo.',
      });
      return;
    }

    const filesMap = (req.files || {}) as Record<string, Express.Multer.File[]>;
    const file = filesMap.file?.[0] || filesMap.arquivo?.[0];
    if (file) {
      // Fix latin1-to-utf8 filename encoding quirk common in multipart headers
      let decodedName = file.originalname || 'documento.pdf';
      try {
        const candidate = Buffer.from(decodedName, 'latin1').toString('utf8');
        if (candidate && !candidate.includes('\ufffd') && candidate !== decodedName) {
          decodedName = candidate;
        }
      } catch {
        // keep originalname
      }

      req.uploadedBinaryFile = {
        buffer: file.buffer,
        originalName: decodedName,
        declaredMimeType: file.mimetype || '',
        sizeBytes: file.size ?? file.buffer.length,
      };
    }

    next();
  });
}
