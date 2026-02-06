const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "nano-banana-pro-preview";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

type GenerateImageOptions = {
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
  model?: string;
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

function normalizeMimeType(mimeType: string | null): string {
  if (!mimeType) return "image/png";
  return mimeType.split(";")[0]?.trim() || "image/png";
}

function parseDataUrl(input: string): InlineDataPart | null {
  const match = input.match(/^data:(.+?);base64,(.+)$/i);
  if (!match) return null;

  return {
    inlineData: {
      mimeType: normalizeMimeType(match[1]),
      data: match[2]
    }
  };
}

async function toInlineDataPart(url: string): Promise<InlineDataPart> {
  const fromDataUrl = parseDataUrl(url);
  if (fromDataUrl) {
    return fromDataUrl;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}): ${url}`);
  }

  const mimeType = normalizeMimeType(response.headers.get("content-type"));
  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    inlineData: {
      mimeType,
      data: bytes.toString("base64")
    }
  };
}

function parsePngDimensions(imageBuffer: Buffer): { width: number; height: number } | null {
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

function fallbackDimensions(aspectRatio: string): { width: number; height: number } {
  if (aspectRatio === "21:9") return { width: 1536, height: 672 };
  if (aspectRatio === "16:9") return { width: 1365, height: 768 };
  if (aspectRatio === "4:3") return { width: 1180, height: 885 };
  return { width: 1024, height: 1024 };
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

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const aspectRatio = options.aspectRatio || "1:1";
  const model = options.model || GEMINI_IMAGE_MODEL;

  const parts: Array<{ text: string } | InlineDataPart> = [{ text: options.prompt }];
  if (options.imageUrls && options.imageUrls.length > 0) {
    for (const imageUrl of options.imageUrls) {
      parts.push(await toInlineDataPart(imageUrl));
    }
  }

  const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent`, {
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
  });

  const responseBody = await response.json();
  if (!response.ok) {
    const errorPayload =
      responseBody && typeof responseBody === "object"
        ? JSON.stringify(responseBody)
        : String(responseBody);
    throw new Error(`Gemini API request failed (${response.status}): ${errorPayload}`);
  }

  const inlineImage = extractImagePart(responseBody);
  const imageBuffer = Buffer.from(inlineImage.data, "base64");
  const dimensions =
    inlineImage.mimeType === "image/png"
      ? parsePngDimensions(imageBuffer)
      : null;

  const fallback = fallbackDimensions(aspectRatio);

  return {
    imageUrl: `data:${inlineImage.mimeType};base64,${inlineImage.data}`,
    width: dimensions?.width || fallback.width,
    height: dimensions?.height || fallback.height,
    mimeType: inlineImage.mimeType
  };
}
