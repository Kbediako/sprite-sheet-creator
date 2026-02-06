import { NextRequest, NextResponse } from "next/server";
import {
  BACKGROUND_REMOVAL_PROMPT,
  generateImage,
  getGeminiApiKey
} from "../../lib/gemini-image";

export const maxDuration = 300;

const LAYER1_PROMPT = (characterPrompt: string) =>
  `Create the SKY/BACKDROP layer for a side-scrolling pixel art game parallax background.

This is for a character: "${characterPrompt}"

Create an environment that fits this character's world. This is the FURTHEST layer - only sky and very distant elements (distant mountains, clouds, horizon).

Style: Pixel art, 32-bit retro game aesthetic, matching the character's style.
This is a wide panoramic scene.`;

const LAYER2_PROMPT = `Create the MIDDLE layer of a 3-layer parallax background for a side-scrolling pixel art game.

I've sent you images of: 1) the character, 2) the background/sky layer already created.

Create the character's ICONIC/CANONICAL location from their story. Use their most recognizable setting - home village, famous landmarks, signature battlegrounds.
Examples: Naruto → Hidden Leaf Village with Hokage monument, Goku → World Tournament arena, Link → Hyrule castle.

Elements should fill the frame from middle down to bottom.

Style: Pixel art matching the other images.
IMPORTANT: Use a transparent background (checkerboard pattern) so this layer can overlay the others.`;

const LAYER3_PROMPT = `Create the FOREGROUND layer of a 3-layer parallax background for a side-scrolling pixel art game.

I've sent you images of: 1) the character, 2) the background/sky layer, 3) the middle layer.

Create the closest foreground elements (ground, grass, rocks, platforms - whatever fits the character's world) that complete the scene.

Style: Pixel art matching the other images.
IMPORTANT: Use a transparent background (checkerboard pattern) so this layer can overlay the others.`;

async function generateLayer(
  prompt: string,
  imageUrls: string[],
  aspectRatio: string = "21:9"
): Promise<{ url: string; width: number; height: number }> {
  const image = await generateImage({
    prompt,
    imageUrls,
    aspectRatio,
    imageSize: "1K"
  });

  return {
    url: image.imageUrl,
    width: image.width,
    height: image.height
  };
}

async function removeBackground(
  imageUrl: string
): Promise<{ url: string; width: number; height: number }> {
  const image = await generateImage({
    prompt: BACKGROUND_REMOVAL_PROMPT,
    imageUrls: [imageUrl],
    aspectRatio: "source",
    imageSize: "1K"
  });

  return {
    url: image.imageUrl,
    width: image.width,
    height: image.height
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!getGeminiApiKey()) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY" },
        { status: 400 }
      );
    }
    const {
      characterImageUrl,
      characterPrompt,
      regenerateLayer,  // Optional: 1, 2, or 3 to regenerate only that layer
      existingLayers,   // Optional: { layer1Url, layer2Url, layer3Url } for single layer regen
    } = await request.json();

    if (!characterImageUrl || !characterPrompt) {
      return NextResponse.json(
        { error: "Character image URL and prompt are required" },
        { status: 400 }
      );
    }

    const hasRegenerateLayer =
      regenerateLayer !== undefined && regenerateLayer !== null;

    if (hasRegenerateLayer) {
      const layerNumber = Number(regenerateLayer);
      if (!Number.isInteger(layerNumber) || ![1, 2, 3].includes(layerNumber)) {
        return NextResponse.json(
          { error: "regenerateLayer must be one of: 1, 2, 3" },
          { status: 400 }
        );
      }

      const hasExistingLayers =
        existingLayers &&
        typeof existingLayers.layer1Url === "string" &&
        typeof existingLayers.layer2Url === "string" &&
        typeof existingLayers.layer3Url === "string";

      if (!hasExistingLayers) {
        return NextResponse.json(
          { error: "existingLayers with layer1Url/layer2Url/layer3Url is required when regenerateLayer is set" },
          { status: 400 }
        );
      }

      if (layerNumber === 1) {
        console.log("Regenerating layer 1 (sky/background)...");
        const layer1 = await generateLayer(
          LAYER1_PROMPT(characterPrompt),
          [characterImageUrl],
          "21:9"
        );
        return NextResponse.json({
          layer1Url: layer1.url,
          layer2Url: existingLayers.layer2Url,
          layer3Url: existingLayers.layer3Url,
          width: layer1.width,
          height: layer1.height
        });
      } else if (layerNumber === 2) {
        console.log("Regenerating layer 2 (midground)...");
        const layer2Raw = await generateLayer(
          LAYER2_PROMPT,
          [characterImageUrl, existingLayers.layer1Url],
          "21:9"
        );
        console.log("Removing background from layer 2...");
        const layer2 = await removeBackground(layer2Raw.url);
        return NextResponse.json({
          layer1Url: existingLayers.layer1Url,
          layer2Url: layer2.url,
          layer3Url: existingLayers.layer3Url,
          width: layer2.width,
          height: layer2.height
        });
      } else if (layerNumber === 3) {
        console.log("Regenerating layer 3 (foreground)...");
        const layer3Raw = await generateLayer(
          LAYER3_PROMPT,
          [characterImageUrl, existingLayers.layer1Url, existingLayers.layer2Url],
          "21:9"
        );
        console.log("Removing background from layer 3...");
        const layer3 = await removeBackground(layer3Raw.url);
        return NextResponse.json({
          layer1Url: existingLayers.layer1Url,
          layer2Url: existingLayers.layer2Url,
          layer3Url: layer3.url,
          width: layer3.width,
          height: layer3.height
        });
      }
    }

    // Generate all layers
    // Layer 1: Sky/Background (furthest)
    console.log("Generating layer 1 (sky/background)...");
    const layer1 = await generateLayer(
      LAYER1_PROMPT(characterPrompt),
      [characterImageUrl],
      "21:9"
    );

    // Layer 2: Midground - needs character + layer 1 as reference
    console.log("Generating layer 2 (midground)...");
    const layer2Raw = await generateLayer(
      LAYER2_PROMPT,
      [characterImageUrl, layer1.url],
      "21:9"
    );

    // Remove background from layer 2
    console.log("Removing background from layer 2...");
    const layer2 = await removeBackground(layer2Raw.url);

    // Layer 3: Foreground - needs character + layer 1 + layer 2 as reference
    console.log("Generating layer 3 (foreground)...");
    const layer3Raw = await generateLayer(
      LAYER3_PROMPT,
      [characterImageUrl, layer1.url, layer2.url],
      "21:9"
    );

    // Remove background from layer 3
    console.log("Removing background from layer 3...");
    const layer3 = await removeBackground(layer3Raw.url);

    return NextResponse.json({
      layer1Url: layer1.url,
      layer2Url: layer2.url,
      layer3Url: layer3.url,
      // Also return dimensions (they should all be the same)
      width: layer1.width,
      height: layer1.height,
    });
  } catch (error) {
    console.error("Error generating background layers:", error);
    return NextResponse.json(
      { error: "Failed to generate background layers" },
      { status: 500 }
    );
  }
}
