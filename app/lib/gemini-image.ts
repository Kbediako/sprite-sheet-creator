import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = Number.isFinite(
  Number.parseInt(process.env.GEMINI_IMAGE_TIMEOUT_MS || "", 10)
)
  ? Number.parseInt(process.env.GEMINI_IMAGE_TIMEOUT_MS || "", 10)
  : 120_000;
const EXTERNAL_FETCH_TIMEOUT_MS = 20_000;
const MAX_EXTERNAL_IMAGE_BYTES = Number.isFinite(
  Number.parseInt(process.env.GEMINI_MAX_EXTERNAL_IMAGE_BYTES || "", 10)
)
  ? Number.parseInt(process.env.GEMINI_MAX_EXTERNAL_IMAGE_BYTES || "", 10)
  : 10 * 1024 * 1024;
const SUPPORTED_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"];

export const BACKGROUND_REMOVAL_PROMPT = `Remove the background from this image.
Keep only the character/object fully intact.
Return a PNG with transparent background (alpha channel), no checkerboard, no solid background.`;

type GenerateImageOptions = {
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: string | "source";
  imageSize?: "1K" | "2K" | "4K";
  model?: string;
  timeoutMs?: number;
};

type GeneratedImage = {
  imageUrl: string;
  width: number;
  height: number;
  mimeType: string;
};

type InlineDataPart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

type ParsedDimensions = {
  width: number;
  height: number;
};

type InlineDataPartResult = {
  part: InlineDataPart;
  dimensions: ParsedDimensions | null;
};

type ParsedDataUrl = {
  mimeType: string;
  data: string;
};

function normalizeMimeType(mimeType: string | null): string {
  if (!mimeType) return "image/png";
  return mimeType.split(";")[0]?.trim() || "image/png";
}

function parseDataUrl(input: string): ParsedDataUrl | null {
  const match = input.match(/^data:(.+?);base64,(.+)$/i);
  if (!match) return null;

  return {
    mimeType: normalizeMimeType(match[1]),
    data: match[2]
  };
}

function parsePngDimensions(imageBuffer: Buffer): ParsedDimensions | null {
  if (imageBuffer.length < 24) return null;

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < pngSignature.length; index += 1) {
    if (imageBuffer[index] !== pngSignature[index]) {
      return null;
    }
  }

  const isIHDR = imageBuffer.toString("ascii", 12, 16) === "IHDR";
  if (!isIHDR) return null;

  return {
    width: imageBuffer.readUInt32BE(16),
    height: imageBuffer.readUInt32BE(20)
  };
}

function parseJpegDimensions(imageBuffer: Buffer): ParsedDimensions | null {
  if (imageBuffer.length < 4) return null;
  if (imageBuffer[0] !== 0xff || imageBuffer[1] !== 0xd8) return null;

  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf
  ]);

  let offset = 2;
  while (offset + 9 < imageBuffer.length) {
    if (imageBuffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = imageBuffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0x01) {
      continue;
    }

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > imageBuffer.length) {
      break;
    }

    const segmentLength = imageBuffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > imageBuffer.length) {
      break;
    }

    if (sofMarkers.has(marker)) {
      if (offset + 7 > imageBuffer.length) {
        break;
      }
      return {
        height: imageBuffer.readUInt16BE(offset + 3),
        width: imageBuffer.readUInt16BE(offset + 5)
      };
    }

    offset += segmentLength;
  }

  return null;
}

function parseImageDimensions(
  mimeType: string,
  imageBuffer: Buffer
): ParsedDimensions | null {
  if (mimeType === "image/png") {
    return parsePngDimensions(imageBuffer);
  }

  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return parseJpegDimensions(imageBuffer);
  }

  return null;
}

function parseAspectRatioValue(aspectRatio: string): number | null {
  const [width, height] = aspectRatio.split(":").map((value) => Number(value));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
}

function pickClosestAspectRatio(dimensions: ParsedDimensions): string {
  const targetRatio = dimensions.width / dimensions.height;
  let bestAspectRatio = SUPPORTED_ASPECT_RATIOS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const ratio of SUPPORTED_ASPECT_RATIOS) {
    const parsedRatio = parseAspectRatioValue(ratio);
    if (!parsedRatio) continue;
    const distance = Math.abs(targetRatio - parsedRatio);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAspectRatio = ratio;
    }
  }

  return bestAspectRatio;
}

function resolveAspectRatio(
  requestedAspectRatio: string | "source" | undefined,
  dimensions: ParsedDimensions | null
): string {
  if (requestedAspectRatio && requestedAspectRatio !== "source") {
    return requestedAspectRatio;
  }

  if (requestedAspectRatio === "source" && dimensions) {
    return pickClosestAspectRatio(dimensions);
  }

  return "1:1";
}

function fallbackDimensions(aspectRatio: string): ParsedDimensions {
  const parsedRatio = parseAspectRatioValue(aspectRatio);
  if (!parsedRatio) {
    return { width: 1024, height: 1024 };
  }

  const base = 1024;
  if (parsedRatio >= 1) {
    return {
      width: base,
      height: Math.max(256, Math.round(base / parsedRatio))
    };
  }

  return {
    width: Math.max(256, Math.round(base * parsedRatio)),
    height: base
  };
}

function extractImagePart(responseBody: unknown): {
  mimeType: string;
  data: string;
} {
  const candidates =
    responseBody && typeof responseBody === "object"
      ? (responseBody as { candidates?: Array<{ content?: { parts?: Array<unknown> } }> })
          .candidates || []
      : [];

  for (const candidate of candidates) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const inlineData = (part as { inlineData?: { mimeType?: string; data?: string } }).inlineData;
      if (inlineData?.data) {
        return {
          mimeType: normalizeMimeType(inlineData.mimeType || "image/png"),
          data: inlineData.data
        };
      }
    }
  }

  throw new Error("No image data returned by Gemini API");
}

function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split(".").map((value) => Number.parseInt(value, 10));
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  const mappedIPv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIPv4) {
    return isPrivateIPv4(mappedIPv4[1]);
  }

  return false;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIPv4(address);
  }
  if (version === 6) {
    return isPrivateIPv6(address);
  }
  return true;
}

async function assertAllowedExternalUrl(rawUrl: string): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Invalid image URL");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only https image URLs are allowed");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("Image URLs with credentials are not allowed");
  }

  const hostname = parsedUrl.hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost") {
    throw new Error("Localhost image URLs are not allowed");
  }

  if (isIP(hostname) && isPrivateAddress(hostname)) {
    throw new Error("Private network image URLs are not allowed");
  }

  let resolvedAddresses;
  try {
    resolvedAddresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Unable to resolve image host: ${hostname}`);
  }

  if (
    resolvedAddresses.length === 0 ||
    resolvedAddresses.some((entry) => isPrivateAddress(entry.address))
  ) {
    throw new Error("Private network image URLs are not allowed");
  }
}

function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  );
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateContentLength(
  contentLengthHeader: string | null,
  limitBytes: number
): void {
  if (!contentLengthHeader) return;
  const parsedContentLength = Number.parseInt(contentLengthHeader, 10);
  if (!Number.isFinite(parsedContentLength) || parsedContentLength < 0) return;
  if (parsedContentLength > limitBytes) {
    throw new Error(
      `Image exceeds maximum allowed size (${limitBytes} bytes)`
    );
  }
}

async function readResponseBytesWithLimit(
  response: Response,
  limitBytes: number
): Promise<Buffer> {
  validateContentLength(response.headers.get("content-length"), limitBytes);

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limitBytes) {
      throw new Error(
        `Image exceeds maximum allowed size (${limitBytes} bytes)`
      );
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > limitBytes) {
        await reader.cancel("Image exceeds maximum allowed size");
        throw new Error(
          `Image exceeds maximum allowed size (${limitBytes} bytes)`
        );
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

async function toInlineDataPart(url: string): Promise<InlineDataPartResult> {
  const fromDataUrl = parseDataUrl(url);
  if (fromDataUrl) {
    const bytes = Buffer.from(fromDataUrl.data, "base64");
    return {
      part: {
        inlineData: {
          mimeType: fromDataUrl.mimeType,
          data: fromDataUrl.data
        }
      },
      dimensions: parseImageDimensions(fromDataUrl.mimeType, bytes)
    };
  }

  await assertAllowedExternalUrl(url);
  const response = await fetchWithTimeout(url, {}, EXTERNAL_FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}): ${url}`);
  }

  const mimeType = normalizeMimeType(response.headers.get("content-type"));
  const bytes = await readResponseBytesWithLimit(
    response,
    MAX_EXTERNAL_IMAGE_BYTES
  );

  return {
    part: {
      inlineData: {
        mimeType,
        data: bytes.toString("base64")
      }
    },
    dimensions: parseImageDimensions(mimeType, bytes)
  };
}

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const model = options.model || GEMINI_IMAGE_MODEL;

  const parts: Array<{ text: string } | InlineDataPart> = [{ text: options.prompt }];
  let firstImageDimensions: ParsedDimensions | null = null;

  if (options.imageUrls && options.imageUrls.length > 0) {
    for (const imageUrl of options.imageUrls) {
      const inlinePart = await toInlineDataPart(imageUrl);
      parts.push(inlinePart.part);
      if (!firstImageDimensions && inlinePart.dimensions) {
        firstImageDimensions = inlinePart.dimensions;
      }
    }
  }

  const aspectRatio = resolveAspectRatio(options.aspectRatio, firstImageDimensions);
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${GEMINI_API_URL}/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts
            }
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio,
              imageSize: options.imageSize || "1K"
            }
          }
        })
      },
      timeoutMs
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Gemini API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  const responseText = await response.text();
  let responseBody: unknown = null;

  if (responseText) {
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      if (!response.ok) {
        throw new Error(`Gemini API request failed (${response.status}): ${responseText}`);
      }
      throw new Error("Gemini API returned invalid JSON response");
    }
  }

  if (!response.ok) {
    const errorPayload =
      responseBody && typeof responseBody === "object"
        ? JSON.stringify(responseBody)
        : responseText;
    throw new Error(`Gemini API request failed (${response.status}): ${errorPayload}`);
  }

  if (!responseBody || typeof responseBody !== "object") {
    throw new Error("Gemini API returned an empty response body");
  }

  const inlineImage = extractImagePart(responseBody);
  const imageBuffer = Buffer.from(inlineImage.data, "base64");
  const dimensions = parseImageDimensions(inlineImage.mimeType, imageBuffer);

  const fallback = fallbackDimensions(aspectRatio);

  return {
    imageUrl: `data:${inlineImage.mimeType};base64,${inlineImage.data}`,
    width: dimensions?.width ?? fallback.width,
    height: dimensions?.height ?? fallback.height,
    mimeType: inlineImage.mimeType
  };
}
