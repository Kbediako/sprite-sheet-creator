import { fal } from "@fal-ai/client";
import { NextRequest, NextResponse } from "next/server";

const credentials = process.env.FAL_KEY ?? process.env.GEMINI_API_KEY;

if (credentials) {
  fal.config({ credentials });
}

export async function POST(request: NextRequest) {
  try {
    if (!credentials) {
      return NextResponse.json(
        { error: "Missing FAL_KEY or GEMINI_API_KEY" },
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

    const result = await fal.subscribe("fal-ai/bria/background/remove", {
      input: {
        image_url: imageUrl,
      },
    });

    const data = result.data as {
      image: { url: string; width: number; height: number };
    };

    if (!data.image) {
      return NextResponse.json(
        { error: "Background removal failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      imageUrl: data.image.url,
      width: data.image.width,
      height: data.image.height,
    });
  } catch (error) {
    console.error("Error removing background:", error);
    return NextResponse.json(
      { error: "Failed to remove background" },
      { status: 500 }
    );
  }
}
