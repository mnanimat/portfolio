import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";

const MAX_FILE_BYTES = 90 * 1024 * 1024;
const ACCEPTED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/avi",
  "video/mpeg",
  "video/ogg",
];

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let payload: { source?: string } = {};

        if (clientPayload) {
          try {
            payload = JSON.parse(clientPayload) as { source?: string };
          } catch {
            throw new Error("Metadados do upload inválidos.");
          }
        }

        if (payload.source !== "portfolio-video-request") {
          throw new Error("Origem do upload não autorizada.");
        }

        return {
          allowedContentTypes: ACCEPTED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            source: "portfolio-video-request",
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.info("Upload concluído", {
          pathname: blob.pathname,
          size: blob.size,
          uploadedAt: new Date().toISOString(),
        });
      },
    });

    return Response.json(response);
  } catch (error) {
    console.error("Falha ao autorizar upload", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível autorizar o envio.",
      },
      { status: 400 },
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
