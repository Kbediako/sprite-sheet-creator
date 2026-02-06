import { NextRequest, NextResponse } from "next/server";
import {
  BACKGROUND_REMOVAL_PROMPT,
  generateImage,
  getGeminiApiKey
} from "../../lib/gemini-image";

export async function POST(request: NextRequest) {
  try {
    if (!getGeminiApiKey()) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY" },
        { status: 500 }
      );
    }
    const { imageUrl } = await request.json();

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Image URL is required" },
        { status: 400 }
      );
    }

    const image = await generateImage({
      prompt: BACKGROUND_REMOVAL_PROMPT,
      imageUrls: [imageUrl],
      aspectRatio: "source",
      imageSize: "1K"
    });

    return NextResponse.json({
      imageUrl: image.imageUrl,
      width: image.width,
      height: image.height
    });
  } catch (error) {
    console.error("Error removing background:", error);
    return NextResponse.json(
      { error: "Failed to remove background" },
      { status: 500 }
    );
  }
}
