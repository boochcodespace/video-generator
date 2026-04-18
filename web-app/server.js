'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { randomUUID } = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

const WORKSPACE_ROOT = path.join(__dirname, '..');
const VIDEO_PROJECTS_DIR = path.join(WORKSPACE_ROOT, 'video-projects');
const BRAND_ASSETS_DIR = path.join(WORKSPACE_ROOT, 'assets');

// In-memory job store: jobId -> { events: [], clients: [], done: false }
const jobs = new Map();

// ── Multer: store uploads in system temp, keep original extension ─────────────
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function emitEvent(jobId, type, data) {
  const job = jobs.get(jobId);
  if (!job) return;
  const event = { type, data, ts: Date.now() };
  job.events.push(event);
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  job.clients.forEach((res) => res.write(msg));
}

function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function copyBrandAssets(destDir) {
  const files = ['brand-tokens.css', 'AIS Logo PNG.png', 'AIS Background.png'];
  files.forEach((f) => {
    const src = path.join(BRAND_ASSETS_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, f));
    }
  });
}

// ── Claude system prompt (cached) ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert HyperFrames educational video composition generator.

HyperFrames renders HTML + GSAP animations to MP4 using headless Chrome. You generate a complete, valid single-file index.html composition.

## Render Contract (follow EXACTLY — violations cause broken renders)

1. Root <div>: must have id, data-composition-id, data-start="0", data-width, data-height
2. Every timed VISIBLE element needs class="clip" — EXCEPT <video> and <audio> tags
3. Every timed element needs data-start, data-duration, data-track-index
4. data-start may reference another clip's id: "intro", "intro + 2", "intro - 0.5"
5. <video> must be muted; audio goes in a sibling <audio> element
6. Register EXACTLY ONE paused GSAP timeline: window.__timelines["COMP_ID"] = tl
7. Composition total duration = tl.duration() — always end with tl.set({}, {}, TOTAL_SECONDS)
8. NEVER call .play() / .pause() / .currentTime on media — the framework owns playback
9. NEVER animate width/height/top/left directly on <video> — wrap in a <div> and animate the wrapper
10. No Date.now(), no unseeded Math.random(), no runtime network fetches

## Required HTML skeleton

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>TITLE</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,700;0,900;1,400&family=Roboto+Mono:wght@400;700&display=block" rel="stylesheet" />
  <link rel="stylesheet" href="assets/brand-tokens.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 1920px; height: 1080px; overflow: hidden; background: #07121c; }
    /* your styles */
  </style>
</head>
<body>
  <div id="root" data-composition-id="COMP_ID" data-start="0" data-width="1920" data-height="1080">
    <!-- face video: NEVER animate <video> directly, always via a wrapper div -->
    <div id="face-clip">
      <div id="face-wrapper">
        <video id="face-video"
          data-start="0" data-duration="TOTAL_SECONDS" data-track-index="0"
          src="assets/VIDEO_FILENAME" muted playsinline></video>
      </div>
    </div>
    <!-- audio (separate from the muted video) -->
    <audio id="face-audio"
      data-start="0" data-duration="TOTAL_SECONDS" data-track-index="4"
      data-volume="1" src="assets/VIDEO_FILENAME"></audio>

    <!-- timed clips (must have class="clip") -->
    <div id="clip-01" class="clip" data-start="0" data-duration="5" data-track-index="1">
      content here
    </div>
  </div>

  <script>
  (function () {
    const tl = gsap.timeline({ paused: true });

    // entrance
    tl.fromTo('#clip-01', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0);
    // exit
    tl.to('#clip-01', { opacity: 0, duration: 0.3 }, 4.7);

    // always pad to total video duration
    tl.set({}, {}, TOTAL_SECONDS);

    window.__timelines = window.__timelines || {};
    window.__timelines['COMP_ID'] = tl;
  })();
  </script>
</body>
</html>
\`\`\`

## Brand tokens (in assets/brand-tokens.css)
- --ais-bg: #07121c  (dark navy — use as background)
- --ais-surface: #0d2031  (card/panel background)
- --ais-accent: #37bdf8  (cyan — highlight important text/borders)
- --ais-warn: #f09025   (orange — warnings, "hot" callouts)
- --ais-text: #ffffff
- --font-mono: "Roboto Mono", monospace
- --font-display: "Montserrat", sans-serif

## Corner PiP (speaker in bottom-right corner — standard teaching layout)

CSS:
\`\`\`css
#face-clip {
  position: absolute; right: 48px; bottom: 48px;
  width: 360px; height: 540px;
  border-radius: 32px; overflow: hidden; z-index: 10;
  box-shadow: 0 20px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(55,189,248,0.25);
}
#face-wrapper {
  position: absolute; top: 0; left: 0;
  width: 1920px; height: 1080px;
  transform-origin: 0 0;
  transform: translate(-300px, 0) scale(0.5); /* show center 720px of the 1920px frame */
}
#face-video { display: block; width: 1920px; height: 1080px; object-fit: cover; }
\`\`\`

## Educational video structure

Use transcript timestamps to determine scene starts/ends. Aim for 5–10 timed text overlays.

1. **Title card** (0s – 3s): full-screen. Large lesson title + subtitle. Fade in.
2. **Teaching body** (3s – N-3s): corner PiP face + text overlays on left 60% of screen, synced to segments.
   - Each overlay = a short key phrase from the corresponding transcript segment.
   - Use font-size 52-72px, Montserrat 700. White text, --ais-accent for emphasis.
   - Animate: fromTo opacity/y on entrance, fade out 0.3s before next segment.
3. **Outro** (N-3s – Ns): fade to dark + simple CTA text. Corner PiP fades out.

Keep text CONCISE — headline form only, never full transcript sentences.
Use data-track-index="1" for all text/graphic clips; data-track-index="0" for video; data-track-index="4" for audio.
Avoid overlapping clips on the same track-index at the same time.`;

// ── Transcription ─────────────────────────────────────────────────────────────

async function transcribeVideo(projectDir, videoFilename) {
  const videoPath = path.join(projectDir, 'assets', videoFilename);
  const outPath = path.join(projectDir, 'assets', 'transcript.json');

  // Try HyperFrames CLI first (uses local whisper.cpp or OPENAI_API_KEY)
  try {
    await run(
      `npx hyperframes transcribe "${videoPath}" --model small.en --json --output "${outPath}"`,
      projectDir
    );
    if (fs.existsSync(outPath)) {
      return JSON.parse(fs.readFileSync(outPath, 'utf8'));
    }
  } catch (_) {
    // fall through to OpenAI direct call
  }

  // Fall back to OpenAI Whisper API
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  try {
    const OpenAI = require('openai');
    const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const audioStream = fs.createReadStream(videoPath);
    const result = await oai.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    return null;
  }
}

function formatTranscriptForPrompt(transcript) {
  if (!transcript) return 'No transcript available. Create reasonable timed sections based on the video duration.';

  const lines = [];
  if (transcript.text) {
    lines.push(`FULL TEXT: ${transcript.text}`);
    lines.push('');
  }
  if (transcript.segments && transcript.segments.length) {
    lines.push('SEGMENTS (use these for timing overlays):');
    transcript.segments.forEach((s, i) => {
      const start = typeof s.start === 'number' ? s.start.toFixed(2) : s.start;
      const end = typeof s.end === 'number' ? s.end.toFixed(2) : s.end;
      lines.push(`  [${start}s – ${end}s] ${(s.text || '').trim()}`);
    });
  }
  return lines.join('\n');
}

// ── Claude composition generator ──────────────────────────────────────────────

async function generateComposition(jobId, { title, videoFilename, durationSecs, style, description, transcript }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const compId = slugify(title) || 'lesson';

  const userMessage = `Generate a complete HyperFrames index.html for this educational video:

Title: ${title}
Composition ID: ${compId}
Video file: assets/${videoFilename}
Video duration: ${durationSecs}s
Style: ${style || 'educational'}
Description: ${description || 'Educational learning content video with talking-head speaker.'}

Transcript:
${formatTranscriptForPrompt(transcript)}

Requirements:
- Use the corner PiP layout (speaker bottom-right, text left side)
- Create 5–10 timed text overlays synced to the transcript segments above
- Add a title card at the start (0–3s) and an outro at the end (last 3s)
- Use --ais-accent (#37bdf8) to highlight key terms
- All overlays must use class="clip" and valid data-start/data-duration/data-track-index
- End the GSAP timeline with: tl.set({}, {}, ${durationSecs})
- window.__timelines["${compId}"] = tl

Output ONLY the complete index.html file — no explanation, no markdown fences.`;

  emitEvent(jobId, 'status', 'Generating composition with Claude...');

  let html = '';
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      html += chunk.delta.text;
      emitEvent(jobId, 'html_progress', { chars: html.length });
    }
  }

  // Strip markdown fences if Claude wrapped output anyway
  html = html.replace(/^```html\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return html;
}

// ── Project pipeline ──────────────────────────────────────────────────────────

async function runPipeline(jobId, { title, style, description, tmpVideoPath, originalFilename }) {
  try {
    // 1. Create project folder
    const slug = slugify(title) || `project-${jobId.slice(0, 8)}`;
    const projectDir = path.join(VIDEO_PROJECTS_DIR, slug);
    fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'compositions'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'renders'), { recursive: true });

    emitEvent(jobId, 'status', 'Setting up project folder...');

    // 2. Move video into assets/
    const ext = path.extname(originalFilename) || '.mp4';
    const videoFilename = `${slug}${ext}`;
    const videoDestPath = path.join(projectDir, 'assets', videoFilename);
    fs.copyFileSync(tmpVideoPath, videoDestPath);
    fs.unlinkSync(tmpVideoPath);

    // 3. Copy brand assets
    copyBrandAssets(path.join(projectDir, 'assets'));

    // 4. Write meta.json + hyperframes.json
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(projectDir, 'meta.json'),
      JSON.stringify({ id: slug, name: title, createdAt: now, width: 1920, height: 1080, fps: 30 }, null, 2)
    );
    fs.writeFileSync(
      path.join(projectDir, 'hyperframes.json'),
      JSON.stringify(
        {
          $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
          registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
          paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
        },
        null,
        2
      )
    );

    // 5. Get video duration
    emitEvent(jobId, 'status', 'Probing video duration...');
    let durationSecs = 60;
    try {
      const ffprobeOut = await run(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "assets/${videoFilename}"`,
        projectDir
      );
      durationSecs = Math.ceil(parseFloat(ffprobeOut) || 60);
    } catch (_) {}

    // 6. Transcribe
    emitEvent(jobId, 'status', 'Transcribing audio...');
    const transcript = await transcribeVideo(projectDir, videoFilename);
    if (transcript) {
      emitEvent(jobId, 'log', 'Transcript ready.');
    } else {
      emitEvent(jobId, 'log', 'No transcript (no OPENAI_API_KEY or whisper). Generating without word-level sync.');
    }

    // 7. Generate with Claude
    const html = await generateComposition(jobId, {
      title,
      videoFilename,
      durationSecs,
      style,
      description,
      transcript,
    });

    // 8. Save index.html
    const indexPath = path.join(projectDir, 'index.html');
    fs.writeFileSync(indexPath, html, 'utf8');
    emitEvent(jobId, 'log', 'index.html written.');

    // 9. Lint
    emitEvent(jobId, 'status', 'Running hyperframes lint...');
    let lintOutput = '';
    try {
      lintOutput = await run('npx hyperframes lint', projectDir);
      emitEvent(jobId, 'log', lintOutput || 'Lint passed.');
    } catch (e) {
      emitEvent(jobId, 'log', `Lint warnings: ${e.message}`);
    }

    // 10. Done
    emitEvent(jobId, 'complete', {
      projectId: slug,
      projectDir: path.relative(WORKSPACE_ROOT, projectDir),
      previewCmd: `cd video-projects/${slug} && npx hyperframes preview`,
    });

    jobs.get(jobId).done = true;
  } catch (err) {
    emitEvent(jobId, 'error', err.message);
    jobs.get(jobId).done = true;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  });
});

// Start generation pipeline
app.post('/api/generate', upload.single('video'), (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const jobId = randomUUID();
  jobs.set(jobId, { events: [], clients: [], done: false });

  const { title = 'Untitled Lesson', style = 'educational', description = '' } = req.body;

  // Kick off pipeline (non-blocking)
  runPipeline(jobId, {
    title,
    style,
    description,
    tmpVideoPath: req.file.path,
    originalFilename: req.file.originalname,
  });

  res.json({ jobId });
});

// SSE stream for job progress
app.get('/api/stream/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay past events
  job.events.forEach((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));

  if (job.done) {
    res.end();
    return;
  }

  job.clients.push(res);
  req.on('close', () => {
    job.clients = job.clients.filter((c) => c !== res);
  });
});

// List projects
app.get('/api/projects', (_req, res) => {
  try {
    const dirs = fs.readdirSync(VIDEO_PROJECTS_DIR, { withFileTypes: true });
    const projects = dirs
      .filter((d) => d.isDirectory())
      .map((d) => {
        const metaPath = path.join(VIDEO_PROJECTS_DIR, d.name, 'meta.json');
        const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
        const rendersDir = path.join(VIDEO_PROJECTS_DIR, d.name, 'renders');
        const renders = fs.existsSync(rendersDir)
          ? fs.readdirSync(rendersDir).filter((f) => f.endsWith('.mp4'))
          : [];
        return { id: d.name, name: meta.name || d.name, createdAt: meta.createdAt, renders };
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(projects);
  } catch (e) {
    res.json([]);
  }
});

// Trigger render (draft or standard)
app.post('/api/render/:projectId', (req, res) => {
  const { projectId } = req.params;
  const quality = req.query.quality === 'standard' ? 'standard' : 'draft';
  const projectDir = path.join(VIDEO_PROJECTS_DIR, projectId);

  if (!fs.existsSync(projectDir)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const jobId = randomUUID();
  jobs.set(jobId, { events: [], clients: [], done: false });

  const outputFile = `renders/${projectId}-${quality}.mp4`;

  emitEvent(jobId, 'status', `Starting ${quality} render...`);

  run(`npx hyperframes render --quality ${quality} --output ${outputFile}`, projectDir)
    .then(() => {
      emitEvent(jobId, 'complete', { renderPath: path.join(projectDir, outputFile) });
      jobs.get(jobId).done = true;
    })
    .catch((e) => {
      emitEvent(jobId, 'error', e.message);
      jobs.get(jobId).done = true;
    });

  res.json({ jobId });
});

// Download rendered MP4
app.get('/api/projects/:projectId/download/:filename', (req, res) => {
  const filePath = path.join(VIDEO_PROJECTS_DIR, req.params.projectId, 'renders', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

// ── Start server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nVideo Generator running at http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠  ANTHROPIC_API_KEY not set — add it to .env before generating videos\n');
  }
});
