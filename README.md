# Video Generator

A local web app that turns talking-head recordings into animated learning videos. Upload an MP4, describe what you want, and Claude generates a HyperFrames composition — synced to your transcript, branded to your style, ready to render.

Built for learning and design teams who need to ship content fast without touching code.

---

## How it works

```
Upload MP4 → Transcribe audio → Claude generates HyperFrames HTML → Lint → Preview → Render MP4
```

1. You upload a recording and fill in a title, style, and optional instructions.
2. The server extracts the audio duration and transcribes it with Whisper (local or via OpenAI).
3. Claude (`claude-sonnet-4-6`) generates a complete HyperFrames composition — timed text overlays, corner face-cam, title card, outro — all synced to your transcript timestamps.
4. The composition is linted automatically. You get a preview link and can render a draft MP4 in one click.

---

## Prerequisites

- **Node 20+** — `node --version` to check
- **FFmpeg** on your `PATH` — needed for audio probing and rendering
- **Chrome (latest)** — HyperFrames renders through headless Chromium
- **An Anthropic API key** — required; Claude generates the compositions

Run `npx hyperframes doctor` from any project folder to verify your environment.

---

## Setup

```bash
# 1. Clone the repo
git clone <your-repo-url> video-generator
cd video-generator

# 2. Copy the env template and fill in your keys
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY

# 3. Install the web app dependencies
npm run web:install

# 4. Start the server
npm run web
# → http://localhost:3001
```

The server reads your `.env` from the repo root automatically.

---

## API keys

| Key | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Claude generates HyperFrames compositions. Get yours at [console.anthropic.com](https://console.anthropic.com/). |
| `OPENAI_API_KEY` | Optional | Whisper transcription via OpenAI. If unset, the app tries local `whisper.cpp` first; if neither is available, Claude generates the composition without word-level sync. |

Estimated Claude cost: **$0.10–0.30 per video** on Sonnet (the system prompt is cached, so repeated generations are cheaper).

---

## Using the app

1. Open `http://localhost:3001` in your browser.
2. Drop in an MP4 recording (up to 2 GB).
3. Enter the lesson title.
4. Pick a style: **Educational**, **Corporate**, or **Energetic**.
5. Optionally add instructions — anything you'd tell a video editor ("highlight the 60/30/10 split", "add a callout at 12 seconds", etc.).
6. Click **Generate video**. Progress streams in real-time.
7. Once ready, click **Render draft** to get an MP4, or **Open in Studio** for a live preview.
8. Download the MP4 from the app or grab it from `video-projects/<project-id>/renders/`.

---

## Iterating on a composition

Every generated video is a standard HyperFrames project under `video-projects/<slug>/`. You can open it in VS Code, edit `index.html` directly, and use the full HyperFrames authoring loop:

```bash
cd video-projects/<slug>

# Live preview with hot reload
npx hyperframes preview        # http://localhost:3002

# Lint before rendering
npx hyperframes lint

# Draft render (~1–3 min, fast)
npx hyperframes render --quality draft --output renders/draft.mp4

# Final render (visually lossless 1080p)
npx hyperframes render --quality standard --output renders/final.mp4
```

See `CLAUDE.md` for the full authoring loop and render contract.

---

## Repo layout

```
video-generator/
├── .env.example             ← copy to .env, fill in keys
├── CLAUDE.md                ← workspace guide (render contract, skills, authoring loop)
├── MOTION_PHILOSOPHY.md     ← motion aesthetic reference
├── DESIGN.ais-example.md    ← brand spec template (copy and adapt for your brand)
├── assets/                  ← shared brand assets (logo, background, brand-tokens.css)
├── web-app/                 ← the web UI
│   ├── server.js            ← Express backend (Claude API, transcription, SSE)
│   ├── public/              ← frontend (index.html, app.js, styles.css)
│   └── package.json
├── scripts/                 ← preflight validators
└── video-projects/          ← one folder per generated (or hand-built) video
    └── <slug>/
        ├── index.html       ← root HyperFrames composition
        ├── compositions/    ← sub-compositions
        ├── assets/          ← video, audio, transcript, brand files
        ├── renders/         ← render outputs (gitignored)
        ├── hyperframes.json ← CLI config
        └── meta.json        ← id / name / dimensions / fps
```

---

## Customising the brand

By default every generated video uses the AIS brand tokens (dark navy, cyan accent, Montserrat). To use your own brand:

1. Edit `assets/brand-tokens.css` — swap `--ais-bg`, `--ais-accent`, `--ais-warn`, and the font variables for your own values.
2. Replace `assets/AIS Logo PNG.png` and `assets/AIS Background.png` with your own files (keep the filenames or update the references in `server.js → copyBrandAssets`).
3. Write a `DESIGN.md` for your project using `DESIGN.ais-example.md` as the template.

After swapping brand tokens, check for hardcoded hex values still in older compositions:

```bash
grep -rn "#37bdf8\|#f09025\|#07121c" video-projects/
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ANTHROPIC_API_KEY not set` warning | Add the key to `.env` and restart the server (`npm run web`) |
| Transcription skipped | Set `OPENAI_API_KEY` in `.env`, or install `whisper.cpp` locally |
| Render fails | Run `npx hyperframes doctor` from the project folder — it checks Node, FFmpeg, and Chrome |
| Studio preview stuck at 0 s | Hard-refresh (`Ctrl+Shift+R`). If it persists, open a specific sub-comp: `http://localhost:3002/?comp=<id>` |
| Lint errors: overlapping clips | Two clips share the same `data-track-index` at the same time — change one clip's index or adjust its timing |
| Video frozen, audio continues | A `<video>` element was animated directly — wrap it in a `<div>` and animate the wrapper instead |

More: `npx hyperframes docs <topic>` — topics: `data-attributes`, `gsap`, `rendering`, `examples`, `troubleshooting`, `compositions`.

---

## Claude Code integration

The `.claude/skills/` folder ships slash commands that encode framework-specific patterns. If you use [Claude Code](https://claude.ai/code), invoke them before editing any composition:

| Skill | Use when |
|---|---|
| `/hyperframes` | Authoring or editing a composition |
| `/gsap` | Writing GSAP timelines or easing |
| `/hyperframes-cli` | CLI reference (render flags, transcribe, TTS) |
| `/make-a-video` | End-to-end beginner flow |
| `/short-form-video` | 9:16 vertical talking-head videos |

---

## License

Code — MIT. AIS brand assets (logo, background, brand tokens) remain the property of AI Automation Society and are included as a worked example only — replace them before shipping anything externally.

HyperFrames framework © HeyGen — docs at [hyperframes.heygen.com](https://hyperframes.heygen.com).
