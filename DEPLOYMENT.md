# WW Character Creator — Deployment Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Game Client (native / WASM)                    │
│                                                 │
│  CHARACTER_SERVICE_URL ──► webview/iframe        │
│                            loads character       │
│                            creator SPA           │
│                                                 │
│  sprite_url ◄── IPC message ◄── user confirms   │
│      │                                          │
│      ▼                                          │
│  SpacetimeDB (set_player_sprite reducer)        │
│      │                                          │
│      ▼                                          │
│  Other clients fetch sprite PNG via sprite_url   │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Character Creator Service (single process)     │
│                                                 │
│  Express server (PORT)                          │
│  ├── /            → client SPA (client/dist/)   │
│  ├── /api/*       → AI pipeline endpoints       │
│  ├── /sprites/*   → static sprite storage       │
│  └── External APIs:                             │
│      ├── Google Gemini (portraits, multiview)    │
│      ├── Tripo3D (3D models, rigging)           │
│      └── PixelLab (2D sprite animations)        │
│                                                 │
│  Storage: server/sprites/{playerId}/{hash}.png  │
└─────────────────────────────────────────────────┘
```

## Configuration

### Game client

One environment variable controls where the game connects:

```bash
# Point to the character creator service URL
CHARACTER_SERVICE_URL=https://character.example.com
```

The game appends `?embedded=true&spriteSize=128&playerId=<hex>` when loading.

- **Native build**: set the env var before running `cargo run`
- **WASM build**: set `window.CHARACTER_SERVICE_URL` in the hosting page

### Character creator service

All configuration lives in `server/.env`. Copy from `.env.example`:

```bash
cp server/.env.example server/.env
```

**Required variables:**

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `TRIPO_API_KEY` | Tripo3D API key |

**Production variables:**

| Variable | Default | Production example |
|----------|---------|-------------------|
| `PORT` | `5000` | `5000` (or whatever your reverse proxy expects) |
| `CLIENT_ORIGIN` | `http://localhost:5173` | `https://character.example.com,https://game.example.com` |
| `SPRITES_PUBLIC_URL` | `http://localhost:{PORT}/sprites` | `https://character.example.com/sprites` |
| `SPRITES_DIR` | `sprites` (relative to server/) | `/data/sprites` (persistent volume) |

**`CLIENT_ORIGIN`** must include any origin that needs CORS access to sprites.
For WASM game builds, include the game's domain. For native builds, CORS is irrelevant.

**`SPRITES_PUBLIC_URL`** is the URL prefix embedded in sprite URLs returned to the game.
These URLs are persisted in SpacetimeDB and fetched by all clients — they must be publicly reachable.

## Local Development

```bash
# Install all dependencies
npm run install:all

# Start both server (port 5000) and client dev server (port 5173)
npm run start-all

# Run the game client
CHARACTER_SERVICE_URL=http://localhost:5173 cargo run -p shanty_game
```

In dev mode, the Vite dev server proxies `/api/*` and `/sprites/*` to the Express server.

## Production Deployment

### 1. Build the client SPA

```bash
npm run build
# Output: client/dist/
```

### 2. Configure environment

Create `server/.env` with production values:

```env
PORT=5000
CLIENT_ORIGIN=https://character.example.com,https://game.example.com
SPRITES_PUBLIC_URL=https://character.example.com/sprites
SPRITES_DIR=/data/sprites

GEMINI_API_KEY=your-key
TRIPO_API_KEY=your-key
PIXELLAB_API_KEY=your-key
```

### 3. Start the server

```bash
npm start
```

The Express server serves both the API and the built client SPA from `client/dist/`.
A single process handles everything — no separate client server needed.

### 4. Reverse proxy (nginx example)

```nginx
server {
    listen 443 ssl;
    server_name character.example.com;

    ssl_certificate     /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 180s;  # AI generation can take a while
    }
}
```

### 5. Point the game client

```bash
CHARACTER_SERVICE_URL=https://character.example.com cargo run -p shanty_game
```

## Storage

Sprites are stored on the local filesystem:

```
{SPRITES_DIR}/
├── {playerId}/
│   ├── {contentHash}.png   ← sprite sheet (served at /sprites/{playerId}/{hash}.png)
│   ├── portrait.png        ← character portrait
│   └── model.json          ← 3D model URL reference
```

- **Player ID**: hex-encoded SpacetimeDB identity
- **Content hash**: hex hash of the sprite sheet content (ensures unique, cache-safe filenames)
- Sprites are served with `Cache-Control: public, max-age=31536000, immutable`

### Persistent storage

In containerized deployments, mount a persistent volume at `SPRITES_DIR` so sprites survive restarts:

```bash
# Docker example
docker run -v /host/sprites:/data/sprites -e SPRITES_DIR=/data/sprites ...
```

### Sprite URL lifecycle

1. User creates character → service generates sprite → stored in `SPRITES_DIR`
2. Service returns URL: `{SPRITES_PUBLIC_URL}/{playerId}/{hash}.png`
3. Game client calls `set_player_sprite(url, hash)` → persisted in SpacetimeDB
4. All other clients fetch the PNG from that URL to render the player

**Important**: Changing `SPRITES_PUBLIC_URL` does NOT update existing sprite URLs already stored in SpacetimeDB. If you change domains, either:
- Keep the old domain serving sprites (redirect or alias)
- Run a migration to update URLs in SpacetimeDB

## Data Flow Summary

```
User clicks "Customize Appearance"
    │
    ▼
Game opens webview/iframe → CHARACTER_SERVICE_URL?embedded=true&spriteSize=128&playerId=...
    │
    ▼
User creates character in the SPA
    │
    ▼
Client SPA calls /api/* endpoints → Express server → Gemini/Tripo/PixelLab
    │
    ▼
Sprite sheet generated → saved to SPRITES_DIR → URL returned to client SPA
    │
    ▼
Client SPA sends IPC message: { type: "character-created", sprite_url, sprite_hash, sprite_data }
    │
    ▼
Game receives message → calls set_player_sprite(url, hash) reducer → SpacetimeDB
    │
    ▼
Game decodes sprite_data base64 → renders sprite immediately (no network wait)
    │
    ▼
Other clients receive profile update → fetch sprite PNG from sprite_url
```
