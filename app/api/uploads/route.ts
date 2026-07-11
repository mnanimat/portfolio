import { env } from "cloudflare:workers";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 90 * 1024 * 1024;
const MAX_TOTAL_BYTES = 90 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_TOTAL_BYTES + 1024 * 1024;
const FILE_FIELDS = new Set(["clip", "clips", "file", "files"]);

type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface ClipsBucket {
  put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: {
        contentDisposition?: string;
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

interface VideoType {
  extension: string;
  acceptedExtensions: readonly string[];
  hasValidSignature(bytes: Uint8Array): boolean;
}

interface ValidatedClip {
  file: File;
  id: string;
  key: string;
  mimeType: string;
  safeName: string;
  uploadedAt: string;
}

const VIDEO_TYPES: Readonly<Record<string, VideoType>> = {
  "video/mp4": {
    extension: "mp4",
    acceptedExtensions: ["mp4", "m4v", "mov"],
    hasValidSignature: isIsoBaseMedia,
  },
  "video/quicktime": {
    extension: "mov",
    acceptedExtensions: ["mov", "qt", "mp4", "m4v"],
    hasValidSignature: isIsoBaseMedia,
  },
  "video/webm": {
    extension: "webm",
    acceptedExtensions: ["webm"],
    hasValidSignature: isEbml,
  },
  "video/x-matroska": {
    extension: "mkv",
    acceptedExtensions: ["mkv"],
    hasValidSignature: isEbml,
  },
  "video/x-msvideo": {
    extension: "avi",
    acceptedExtensions: ["avi"],
    hasValidSignature: isAvi,
  },
  "video/avi": {
    extension: "avi",
    acceptedExtensions: ["avi"],
    hasValidSignature: isAvi,
  },
  "video/mpeg": {
    extension: "mpeg",
    acceptedExtensions: ["mpeg", "mpg", "mpe"],
    hasValidSignature: isMpeg,
  },
  "video/ogg": {
    extension: "ogv",
    acceptedExtensions: ["ogv", "ogg"],
    hasValidSignature: isOgg,
  },
};

function json(body: JsonValue, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, JsonValue>,
): Response {
  return json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status,
  );
}

function getClipsBucket(): ClipsBucket | null {
  const runtimeEnv = env as unknown as { CLIPS?: ClipsBucket };
  return runtimeEnv.CLIPS ?? null;
}

function bytesMatch(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function isIsoBaseMedia(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytesMatch(bytes, 4, [0x66, 0x74, 0x79, 0x70]);
}

function isEbml(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytesMatch(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]);
}

function isAvi(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytesMatch(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesMatch(bytes, 8, [0x41, 0x56, 0x49, 0x20])
  );
}

function isMpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytesMatch(bytes, 0, [0x00, 0x00, 0x01]) &&
    (bytes[3] === 0xba || bytes[3] === 0xb3)
  );
}

function isOgg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytesMatch(bytes, 0, [0x4f, 0x67, 0x67, 0x53]);
}

function normalizeMimeType(type: string): string {
  return type.split(";", 1)[0].trim().toLowerCase();
}

function extensionFromName(name: string): string | null {
  const baseName = name.replace(/^.*[\\/]/, "");
  const lastDot = baseName.lastIndexOf(".");

  if (lastDot <= 0 || lastDot === baseName.length - 1) {
    return null;
  }

  return baseName.slice(lastDot + 1).toLowerCase();
}

function safeStem(name: string): string {
  const baseName = name.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  const normalized = baseName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 56);

  return normalized || "clip";
}

function makeStorageKey(id: string, safeName: string, uploadedAt: string): string {
  const dayPath = uploadedAt.slice(0, 10).replaceAll("-", "/");
  return `clips/${dayPath}/${id}-${safeName}`;
}

async function validateClip(file: File): Promise<ValidatedClip | Response> {
  if (file.size === 0) {
    return errorResponse(400, "empty_file", `O arquivo "${file.name || "sem nome"}" está vazio.`);
  }

  if (file.size > MAX_FILE_BYTES) {
    return errorResponse(
      413,
      "file_too_large",
      `O arquivo "${file.name || "sem nome"}" ultrapassa o limite de 90 MiB.`,
      { maxFileBytes: MAX_FILE_BYTES },
    );
  }

  const mimeType = normalizeMimeType(file.type);
  const videoType = VIDEO_TYPES[mimeType];

  if (!videoType) {
    return errorResponse(
      415,
      "unsupported_media_type",
      `O tipo de arquivo de "${file.name || "sem nome"}" não é aceito.`,
      { acceptedMimeTypes: Object.keys(VIDEO_TYPES) },
    );
  }

  const suppliedExtension = extensionFromName(file.name);
  if (suppliedExtension && !videoType.acceptedExtensions.includes(suppliedExtension)) {
    return errorResponse(
      415,
      "extension_mismatch",
      `A extensão de "${file.name}" não corresponde ao tipo de vídeo informado.`,
    );
  }

  const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  if (!videoType.hasValidSignature(header)) {
    return errorResponse(
      415,
      "invalid_file_signature",
      `O conteúdo de "${file.name || "sem nome"}" não corresponde a um vídeo válido do tipo informado.`,
    );
  }

  const id = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();
  const safeName = `${safeStem(file.name)}.${videoType.extension}`;

  return {
    file,
    id,
    key: makeStorageKey(id, safeName, uploadedAt),
    mimeType,
    safeName,
    uploadedAt,
  };
}

export async function POST(request: Request): Promise<Response> {
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
    return errorResponse(403, "origin_not_allowed", "Uploads só podem ser enviados pelo próprio site.");
  }

  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return errorResponse(415, "multipart_required", "Envie os clipes como multipart/form-data.");
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return errorResponse(
      413,
      "request_too_large",
      "O envio ultrapassa o limite total de 90 MiB.",
      { maxTotalBytes: MAX_TOTAL_BYTES },
    );
  }

  const bucket = getClipsBucket();
  if (!bucket) {
    return errorResponse(
      503,
      "storage_unavailable",
      "O armazenamento de clipes não está configurado neste ambiente. O upload não foi salvo; configure o binding R2 `CLIPS`.",
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, "invalid_multipart", "Não foi possível ler os arquivos enviados.");
  }

  const files = [...formData.entries()]
    .filter(([field, value]) => FILE_FIELDS.has(field) && value instanceof File)
    .map(([, value]) => value as File);

  if (files.length === 0) {
    return errorResponse(
      400,
      "clips_required",
      "Anexe pelo menos um clipe nos campos `clips`, `clip`, `files` ou `file`.",
    );
  }

  if (files.length > MAX_FILES) {
    return errorResponse(400, "too_many_files", `Envie no máximo ${MAX_FILES} clipes por solicitação.`, {
      maxFiles: MAX_FILES,
    });
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return errorResponse(
      413,
      "total_too_large",
      "A soma dos clipes ultrapassa o limite total de 90 MiB.",
      { maxTotalBytes: MAX_TOTAL_BYTES },
    );
  }

  const validatedClips: ValidatedClip[] = [];
  for (const file of files) {
    const result = await validateClip(file);
    if (result instanceof Response) {
      return result;
    }
    validatedClips.push(result);
  }

  const storedKeys: string[] = [];
  try {
    for (const clip of validatedClips) {
      await bucket.put(clip.key, clip.file.stream(), {
        httpMetadata: {
          contentDisposition: `attachment; filename="${clip.safeName}"`,
          contentType: clip.mimeType,
        },
        customMetadata: {
          originalName: clip.safeName,
          uploadedAt: clip.uploadedAt,
          source: "portfolio-video-request",
        },
      });
      storedKeys.push(clip.key);
    }
  } catch (error) {
    await Promise.allSettled(storedKeys.map((key) => bucket.delete(key)));
    console.error("R2 clip upload failed", error);

    return errorResponse(
      502,
      "storage_write_failed",
      "Não foi possível salvar os clipes agora. Nenhum upload concluído foi mantido; tente novamente.",
    );
  }

  return json(
    {
      success: true,
      uploads: validatedClips.map((clip) => ({
        id: clip.id,
        key: clip.key,
        name: clip.safeName,
        type: clip.mimeType,
        size: clip.file.size,
        uploadedAt: clip.uploadedAt,
      })),
    },
    201,
  );
}
