import { NextRequest, NextResponse } from "next/server";
import { generateImage, getGeminiApiKey } from "../../lib/gemini-image";

const BACKGROUND_REMOVAL_PROMPT = `Remove the background from this image.
Keep only the character/object fully intact.
Return a PNG with transparent background (alpha channel), no checkerboard, no solid background.`;

export async function POST(request: NextRequest) {
  try {
    if (!getGeminiApiKey()) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY" },
        { status: 400 }
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
      aspectRatio: "1:1",
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
