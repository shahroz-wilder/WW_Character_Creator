# WW Character Creator

WW Character Creator is a local web app for building a game-ready character pipeline from a text prompt and optional reference image.

The main flow is:

1. `Generate 2D` creates the portrait and then automatically generates the full multiview set.
2. `Generate 3D` sends the multiview to Tripo, builds the 3D model, rigs it, runs the default animations, and generates sprite output.
3. `Download` exports the final bundle when the pipeline is complete.

## What It Does

- Generates a portrait with Gemini.
- Expands that portrait into front, back, left, and right multiview images.
- Creates a textured 3D model through Tripo.
- Runs auto-rigging and animation retargeting.
- Captures 2.5D sprite directions and preview GIF assets.
- Lets you inspect the model in a Three.js viewer with DEV look controls.
- Exports a downloadable package containing the generated assets.

## Current Default Flow

The main UI is organized into four steps:

1. `Portrait`
   - Enter a prompt.
   - Optionally upload a reference image.
   - Click `Generate 2D`.
   - The app generates the portrait first, then automatically runs full multiview generation.

2. `Multiview`
   - Review the front, back, left, and right images.
   - Click `Generate 3D`.

3. `3D Model`
   - The automatic 3D pipeline runs:
     - model generation
     - auto-rig
     - retarget animations
     - sprite capture
   - Default retarget animations:
     - `preset:biped:walk`
     - `preset:biped:run`
     - `preset:biped:look_around`

4. `Sprite`
   - Review the generated sprite previews.
   - Click `Download` to export the final bundle.

The `DEV` panel exposes the manual and advanced controls if you need to override parts of the pipeline.

## Project Structure

- `client/` - Vite + React frontend
- `server/` - Express API for Gemini, Tripo, and PixelLab orchestration
- `WIP/` - scratch/work-in-progress files

Important frontend files:

- [client/src/App.jsx](d:/CODEX/PROJECTS/10_WW_Character/client/src/App.jsx)
- [client/src/components/ModelViewer.jsx](d:/CODEX/PROJECTS/10_WW_Character/client/src/components/ModelViewer.jsx)
- [client/src/components/CharacterPromptForm.jsx](d:/CODEX/PROJECTS/10_WW_Character/client/src/components/CharacterPromptForm.jsx)

Important backend files:

- [server/src/index.js](d:/CODEX/PROJECTS/10_WW_Character/server/src/index.js)
- [server/src/routes/character.js](d:/CODEX/PROJECTS/10_WW_Character/server/src/routes/character.js)
- [server/src/services/tripoService.js](d:/CODEX/PROJECTS/10_WW_Character/server/src/services/tripoService.js)
- [server/src/services/spriteService.js](d:/CODEX/PROJECTS/10_WW_Character/server/src/services/spriteService.js)

## Requirements

- Node.js `20+`
- npm
- API keys for:
  - Gemini
  - Tripo
  - PixelLab

## Installation

Install dependencies in all three package locations:

```bash
npm install
npm --prefix client install
npm --prefix server install
```

The root install is only for the helper script that starts client and server together.

## Environment Setup

Copy the example env file:

```bash
copy server\.env.example server\.env
```

Then fill in the required keys in `server/.env`:

```env
GEMINI_API_KEY=...
TRIPO_API_KEY=...
PIXELLAB_API_KEY=...
```

Useful defaults already included in the example:

- `PORT=5000`
- `CLIENT_ORIGIN=http://localhost:5173`
- `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview`
- `TRIPO_MODEL_VERSION=v3.1-20260211`
- `TRIPO_RIG_FORMAT=glb`
- `TRIPO_RIG_TYPE=biped`

Do not commit `server/.env`. It is ignored by git.

## Running Locally

Run both apps together from the project root:

```bash
npm run start-all
```

Or run them separately:

```bash
npm run dev:server
npm run dev:client
```

Direct package commands also work:

```bash
npm --prefix server run dev
npm --prefix client run dev
```

Local URLs:

- Client: `http://localhost:5173`
- Server: `http://localhost:5000`

## How To Use

### Fast Path

1. Start the server and client.
2. Open `http://localhost:5173`.
3. Enter a character prompt in Step 01.
4. Optionally upload a reference image.
5. Click `Generate 2D`.
6. Wait for portrait generation and automatic multiview generation to finish.
7. Click `Generate 3D`.
8. Wait for the full 3D pipeline to complete.
9. Click `Download`.

### Manual / DEV Path

Open the `DEV` drawer if you need to:

- change portrait or multiview presets
- change Tripo mesh, texture, face limit, or PBR settings
- run manual Tripo tasks
- change viewer tone mapping and light setup
- capture model views or sprite runs manually

## Testing

Frontend tests:

```bash
npm --prefix client run test
```

Backend tests:

```bash
npm --prefix server run test
```

Frontend lint:

```bash
npm --prefix client run lint
```

## Git Workflow

Check local changes:

```bash
git status
```

Stage everything:

```bash
git add -A
```

Create a commit:

```bash
git commit -m "Describe your change"
```

Push to GitHub:

```bash
git push origin main
```

If you are working on another branch, replace `main` with that branch name.

## Recommended Push Checklist

Before pushing:

1. Run `git status`.
2. Make sure `server/.env` is not staged.
3. Run the tests you changed.
4. Commit with a clear message.
5. Push with `git push origin main`.

## Troubleshooting

### App fails on startup

Check that `server/.env` exists and includes all required API keys.

### Frontend loads but generation fails

Make sure the server is running on `http://localhost:5000` and your keys are valid.

### UI looks stale after a change

Hard refresh the browser.

### Long-running 3D tasks

Tripo and sprite generation steps are remote and can take time. The UI polls those jobs until completion.
