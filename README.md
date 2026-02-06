# Sprite Sheet Creator

Sprite sheet generator for 2D pixel art characters. Built with Google Gemini image APIs.

## Demo

### Generated Sprite Sheets

| Walk Cycle | Jump Animation | Attack Animation |
|:----------:|:--------------:|:----------------:|
| ![Walk Sprite Sheet](./assets/walk-sprite-sheet.png) | ![Jump Sprite Sheet](./assets/jump-sprite-sheet.png) | ![Attack Sprite Sheet](./assets/attack-sprite-sheet.png) |

### Sandbox Preview

![Sandbox Preview](./assets/sandbox-preview.png)

## Features

- **Character Generation** - Generate pixel art characters from text prompts using nano-banana-pro
- **Walk Cycle Sprites** - Automatically generate 4-frame walk cycle sprite sheets (2x2 grid)
- **Jump Animation** - Generate 4-frame jump animation sprite sheets (2x2 grid)
- **Attack Animation** - Generate 4-frame attack animation sprite sheets (2x2 grid) - AI picks the attack style
- **Idle Animation** - Generate 4-frame idle/breathing animation sprite sheets (2x2 grid)
- **Background Removal** - Prompt-based transparent background removal via Gemini
- **Frame Extraction** - Adjustable grid dividers for precise frame cropping
- **Animation Preview** - Test animations with adjustable FPS
- **Custom Backgrounds** - AI-generated 3-layer parallax backgrounds based on your character
- **Sandbox Mode** - Walk, jump, and attack in a parallax side-scroller environment

## Custom Backgrounds

Generate character-specific parallax backgrounds with 3 layers:

| Layer | Description |
|-------|-------------|
| **Sky (Back)** | Distant sky, clouds, horizon elements |
| **Mid** | Character's iconic location (e.g., Hidden Leaf Village for Naruto) |
| **Foreground** | Ground layer with terrain matching the character's world |

Gemini image generation uses your character image to generate backgrounds that match style and story.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file with your Gemini API key:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

Get your API key at https://aistudio.google.com/apikey

3. Run the development server:
```bash
npm run dev
```

4. Open http://localhost:3000

## Controls

### Animation Preview (Step 5)
- `D` / `→` - Walk right
- `A` / `←` - Walk left
- `Space` - Stop

### Sandbox (Step 6)
- `A` / `←` - Walk left
- `D` / `→` - Walk right
- `W` / `↑` - Jump
- `J` - Attack

## Tech Stack

- Next.js 14
- React 18
- Google Gemini image generation API (`nano-banana-pro-preview`)
- HTML Canvas
