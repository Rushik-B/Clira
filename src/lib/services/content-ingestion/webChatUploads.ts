import { createStoredContentReference, resolveStoredContentReference } from './referenceStore';
import { renderContentExtractionForLegacyText } from './service';
import type { ContentReference } from './types';

const MAX_WEB_CHAT_UPLOADS = 4;

export type WebChatUpload = {
  filename?: string | null;
  mediaType?: string | null;
  url: string;
};

type WebChatUploadMetadata = {
  filename: string | null;
  mediaType: string | null;
  contentRefId: string | null;
  status: 'ok' | 'degraded';
  error: string | null;
};

function decodeDataUrl(dataUrl: string): {
  ok: true;
  buffer: Buffer;
  mimeType: string | null;
} | {
  ok: false;
  message: string;
} {
  const match = /^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) {
    return {
      ok: false,
      message: 'The uploaded file payload was not a supported data URL.',
    };
  }

  const mimeType = match[1]?.trim() || null;
  const encoded = match[2] ?? '';

  try {
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.length === 0 && encoded.trim().length > 0) {
      return {
        ok: false,
        message: 'The uploaded file payload could not be decoded.',
      };
    }

    return {
      ok: true,
      buffer,
      mimeType,
    };
  } catch {
    return {
      ok: false,
      message: 'The uploaded file payload could not be decoded.',
    };
  }
}

function formatUploadSection(params: {
  filename?: string | null;
  mediaType?: string | null;
  body: string;
}): string {
  return [
    'User uploaded a file in web chat.',
    params.filename ? `Filename: ${params.filename}` : null,
    params.mediaType ? `MIME type: ${params.mediaType}` : null,
    'Readable content:',
    params.body,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function ingestWebChatUploads(params: {
  userId: string;
  conversationId: string;
  runId: string;
  uploads: WebChatUpload[];
}): Promise<{
  appendedText: string;
  contentRefs: ContentReference[];
  uploadMetadata: WebChatUploadMetadata[];
}> {
  const contentRefs: ContentReference[] = [];
  const uploadMetadata: WebChatUploadMetadata[] = [];
  const sections: string[] = [];

  for (const [index, upload] of params.uploads.slice(0, MAX_WEB_CHAT_UPLOADS).entries()) {
    const decoded = decodeDataUrl(upload.url);
    const filename = upload.filename?.trim() || `upload-${index + 1}`;
    const mediaType = upload.mediaType?.trim() || null;

    if (!decoded.ok) {
      sections.push(
        formatUploadSection({
          filename,
          mediaType,
          body: `[Content extraction degraded] ${decoded.message}`,
        }),
      );
      uploadMetadata.push({
        filename,
        mediaType,
        contentRefId: null,
        status: 'degraded',
        error: decoded.message,
      });
      continue;
    }

    const reference = createStoredContentReference({
      userId: params.userId,
      buffer: decoded.buffer,
      displayName: filename,
      mimeHint: mediaType ?? decoded.mimeType,
      trustClass: 'user_provided',
      provenance: {
        sourceLabel: 'Web chat upload',
        sourceKind: 'web_chat_upload',
        channel: 'web',
        conversationId: params.conversationId,
        runId: params.runId,
        attachmentId: `web-upload-${index + 1}`,
      },
    });

    contentRefs.push(reference);

    const resolved = await resolveStoredContentReference({
      userId: params.userId,
      reference,
      conversationId: params.conversationId,
      runId: params.runId,
    });

    if (!resolved.ok) {
      sections.push(
        formatUploadSection({
          filename,
          mediaType: mediaType ?? decoded.mimeType,
          body: `[Content extraction degraded] ${resolved.message}`,
        }),
      );
      uploadMetadata.push({
        filename,
        mediaType: mediaType ?? decoded.mimeType,
        contentRefId: reference.contentRefId,
        status: 'degraded',
        error: resolved.message,
      });
      continue;
    }

    sections.push(
      formatUploadSection({
        filename,
        mediaType: resolved.extraction.attribution.mimeType,
        body: renderContentExtractionForLegacyText(resolved.extraction),
      }),
    );
    uploadMetadata.push({
      filename,
      mediaType: resolved.extraction.attribution.mimeType,
      contentRefId: reference.contentRefId,
      status: resolved.extraction.status === 'ok' ? 'ok' : 'degraded',
      error:
        resolved.extraction.status === 'ok'
          ? null
          : resolved.extraction.degradationNotes[0]?.message ?? 'Upload extraction degraded.',
    });
  }

  if (params.uploads.length > MAX_WEB_CHAT_UPLOADS) {
    sections.push(
      `[Content extraction degraded] Only the first ${MAX_WEB_CHAT_UPLOADS} web chat uploads were processed in this turn.`,
    );
  }

  return {
    appendedText: sections.join('\n\n'),
    contentRefs,
    uploadMetadata,
  };
}
