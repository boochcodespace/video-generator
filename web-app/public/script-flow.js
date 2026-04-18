'use strict';

// ── Tab switching ─────────────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll('.tab-btn');
const flowVideo = document.getElementById('flow-video');
const flowScript = document.getElementById('flow-script');

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'video') {
      flowVideo.classList.remove('hidden');
      flowScript.classList.add('hidden');
    } else {
      flowVideo.classList.add('hidden');
      flowScript.classList.remove('hidden');
    }
  });
});

// ── State ─────────────────────────────────────────────────────────────────────
let sfScenes = [];
let sfProjectId = null;
let sfEventSource = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const sfInput    = document.getElementById('sf-input');
const sfReview   = document.getElementById('sf-review');
const sfBuilding = document.getElementById('sf-building');
const sfComplete = document.getElementById('sf-complete');
const sfError    = document.getElementById('sf-error');

const sfTitle      = document.getElementById('sf-title');
const sfScript     = document.getElementById('sf-script');
const sfStyle      = document.getElementById('sf-style');
const sfVoice      = document.getElementById('sf-voice');
const sfParseBtn   = document.getElementById('sf-parse-btn');
const sfParseLabel = document.getElementById('sf-parse-label');
const sfApiWarning = document.getElementById('sf-api-warning');

const sfReviewTitle  = document.getElementById('sf-review-title');
const sfReviewMeta   = document.getElementById('sf-review-meta');
const sfScenesList   = document.getElementById('sf-scenes-list');
const sfBackBtn      = document.getElementById('sf-back-btn');
const sfGenerateBtn  = document.getElementById('sf-generate-btn');
const sfAddSceneBtn  = document.getElementById('sf-add-scene-btn');

const sfProgressTitle     = document.getElementById('sf-progress-title');
const sfProgressLog       = document.getElementById('sf-progress-log');
const sfTtsProgress       = document.getElementById('sf-tts-progress');
const sfHtmlProgressWrap  = document.getElementById('sf-html-progress-wrap');
const sfHtmlBar           = document.getElementById('sf-html-bar');
const sfHtmlChars         = document.getElementById('sf-html-chars');

const sfCompleteProjectId = document.getElementById('sf-complete-project-id');
const sfPreviewBtn        = document.getElementById('sf-preview-btn');
const sfRenderBtn         = document.getElementById('sf-render-btn');
const sfRenderProgress    = document.getElementById('sf-render-progress');
const sfRenderStatus      = document.getElementById('sf-render-status');
const sfDownloadRow       = document.getElementById('sf-download-row');
const sfDownloadLink      = document.getElementById('sf-download-link');
const sfPreviewCmd        = document.getElementById('sf-preview-cmd');

const sfErrorMessage = document.getElementById('sf-error-message');
const sfRetryBtn     = document.getElementById('sf-retry-btn');

// ── Stage helpers ─────────────────────────────────────────────────────────────
function sfShowStage(name) {
  [sfInput, sfReview, sfBuilding, sfComplete, sfError].forEach((el) => el.classList.add('hidden'));
  const map = { input: sfInput, review: sfReview, building: sfBuilding, complete: sfComplete, error: sfError };
  if (map[name]) map[name].classList.remove('hidden');
}

function sfAppendLog(msg) {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = msg;
  sfProgressLog.appendChild(line);
  sfProgressLog.scrollTop = sfProgressLog.scrollHeight;
}

// ── Parse handler ─────────────────────────────────────────────────────────────
sfParseBtn.addEventListener('click', async () => {
  const script = sfScript.value.trim();
  const title  = sfTitle.value.trim();
  if (!script) { sfScript.focus(); return; }
  if (!title)  { sfTitle.focus(); return; }

  sfParseBtn.disabled = true;
  sfParseLabel.textContent = 'Parsing…';

  try {
    const resp = await fetch('/api/script/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Parse failed');
    }
    const { scenes } = await resp.json();
    sfScenes = scenes;
    renderSceneReview();
    sfShowStage('review');
  } catch (err) {
    alert(`Parse error: ${err.message}`);
  } finally {
    sfParseBtn.disabled = false;
    sfParseLabel.textContent = 'Parse into scenes';
  }
});

// ── Scene review renderer ─────────────────────────────────────────────────────
function renderSceneReview() {
  const totalDur = sfScenes.reduce((a, s) => a + s.duration, 0);
  const mins = Math.floor(totalDur / 60);
  const secs = Math.round(totalDur % 60);

  sfReviewTitle.textContent = sfTitle.value.trim() || 'Scene breakdown';
  sfReviewMeta.textContent = `${sfScenes.length} scenes · ~${mins}m ${secs}s`;

  sfScenesList.innerHTML = '';
  sfScenes.forEach((scene, idx) => renderSceneCard(scene, idx));
}

function renderSceneCard(scene, idx) {
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.dataset.sceneId = scene.id;

  card.innerHTML = `
    <div class="scene-card-header">
      <span class="scene-num">${String(idx + 1).padStart(2, '0')}</span>
      <input class="scene-headline" type="text" value="${escHtml(scene.headline)}" placeholder="Scene title" />
      <span class="scene-duration">${scene.duration}s</span>
      <button class="scene-remove" title="Remove scene">×</button>
    </div>
    <div class="scene-card-body">
      <div>
        <div class="scene-script-label">Narration</div>
        <textarea class="scene-script-text" rows="4">${escHtml(scene.script)}</textarea>
      </div>
      <div class="scene-image-section">
        <div class="scene-script-label">Slide image <span class="optional">optional</span></div>
        <div class="scene-image-zone">
          <input type="file" accept="image/*" />
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span class="hint">Drop image or click</span>
          <img class="scene-image-preview" src="" alt="" />
        </div>
      </div>
    </div>`;

  // Toggle body open/closed
  const header = card.querySelector('.scene-card-header');
  const body   = card.querySelector('.scene-card-body');
  header.addEventListener('click', (e) => {
    if (e.target.classList.contains('scene-headline') || e.target.classList.contains('scene-remove')) return;
    body.classList.toggle('hidden');
  });

  // Sync edits back to sfScenes
  card.querySelector('.scene-headline').addEventListener('input', (e) => {
    sfScenes[idx].headline = e.target.value;
  });
  card.querySelector('.scene-script-text').addEventListener('input', (e) => {
    sfScenes[idx].script = e.target.value;
    // Recalculate duration
    const words = e.target.value.trim().split(/\s+/).length;
    sfScenes[idx].words = words;
    sfScenes[idx].duration = Math.round((words / 130) * 60 * 10) / 10;
    card.querySelector('.scene-duration').textContent = `${sfScenes[idx].duration}s`;
  });

  // Image preview
  const fileInput = card.querySelector('input[type="file"]');
  const imgPreview = card.querySelector('.scene-image-preview');
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      const url = URL.createObjectURL(fileInput.files[0]);
      imgPreview.src = url;
      imgPreview.classList.add('visible');
      sfScenes[idx]._slideFile = fileInput.files[0];
    }
  });

  // Remove
  card.querySelector('.scene-remove').addEventListener('click', () => {
    sfScenes.splice(idx, 1);
    renderSceneReview();
  });

  sfScenesList.appendChild(card);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Add scene ─────────────────────────────────────────────────────────────────
sfAddSceneBtn.addEventListener('click', () => {
  const n = sfScenes.length + 1;
  sfScenes.push({
    id: `s${String(n).padStart(2, '0')}`,
    headline: '',
    script: '',
    words: 0,
    duration: 5,
  });
  renderSceneReview();
});

// ── Back ──────────────────────────────────────────────────────────────────────
sfBackBtn.addEventListener('click', () => sfShowStage('input'));

// ── Generate handler ──────────────────────────────────────────────────────────
sfGenerateBtn.addEventListener('click', async () => {
  sfShowStage('building');
  sfProgressLog.innerHTML = '';
  sfHtmlProgressWrap.classList.add('hidden');
  sfHtmlBar.style.width = '0%';
  sfHtmlChars.textContent = '0';

  // Build TTS cells
  sfTtsProgress.innerHTML = sfScenes
    .map((s, i) => `<div class="tts-cell" id="tts-cell-${s.id}"><span class="tts-dot"></span>${String(i+1).padStart(2,'0')} ${s.headline.slice(0,16) || 'Scene'}</div>`)
    .join('');
  sfTtsProgress.classList.remove('hidden');

  // Build FormData
  const fd = new FormData();
  fd.append('title', sfTitle.value.trim() || 'Untitled');
  fd.append('style', sfStyle.value);
  fd.append('voice', sfVoice.value);
  fd.append('scenes', JSON.stringify(sfScenes.map(({ _slideFile, ...s }) => s)));

  sfScenes.forEach((s) => {
    if (s._slideFile) fd.append(`slide_${s.id}`, s._slideFile);
  });

  try {
    const resp = await fetch('/api/script/generate', { method: 'POST', body: fd });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Server error');
    }
    const { jobId } = await resp.json();
    sfConnectStream(jobId);
  } catch (err) {
    sfShowError(err.message);
  }
});

// ── SSE ───────────────────────────────────────────────────────────────────────
function sfConnectStream(jobId) {
  if (sfEventSource) sfEventSource.close();
  sfEventSource = new EventSource(`/api/stream/${jobId}`);

  sfEventSource.onmessage = (e) => {
    const event = JSON.parse(e.data);
    sfHandleEvent(event);
  };
  sfEventSource.onerror = () => {
    sfAppendLog('Connection lost');
    sfEventSource.close();
  };
}

function sfHandleEvent({ type, data }) {
  switch (type) {
    case 'status':
      sfProgressTitle.textContent = data;
      sfAppendLog(data);
      break;

    case 'log':
      sfAppendLog(data);
      break;

    case 'tts_progress': {
      // Mark previous as done, current as active
      const cells = sfTtsProgress.querySelectorAll('.tts-cell');
      cells.forEach((c, i) => {
        if (i < data.index) c.classList.add('done'), c.classList.remove('active');
        else if (i === data.index) c.classList.add('active'), c.classList.remove('done');
      });
      break;
    }

    case 'html_progress':
      sfHtmlProgressWrap.classList.remove('hidden');
      sfHtmlChars.textContent = data.chars.toLocaleString();
      sfHtmlBar.style.width = `${Math.min(100, Math.round((data.chars / 8000) * 100))}%`;
      break;

    case 'complete':
      sfEventSource.close();
      // Mark all TTS cells done
      sfTtsProgress.querySelectorAll('.tts-cell').forEach((c) => { c.classList.add('done'); c.classList.remove('active'); });
      sfOnComplete(data);
      break;

    case 'error':
      sfEventSource.close();
      sfShowError(data);
      break;
  }
}

function sfOnComplete({ projectId, projectDir, previewCmd }) {
  sfProjectId = projectId;
  sfCompleteProjectId.textContent = `Project: ${projectDir}`;
  sfPreviewCmd.textContent = previewCmd;
  sfShowStage('complete');
}

function sfShowError(msg) {
  sfErrorMessage.textContent = msg;
  sfShowStage('error');
}

// ── Complete actions ──────────────────────────────────────────────────────────
sfPreviewBtn.addEventListener('click', () => {
  alert(`Open a terminal in your project and run:\n\n${sfPreviewCmd.textContent}\n\nThen visit http://localhost:3002`);
});

sfRenderBtn.addEventListener('click', async () => {
  if (!sfProjectId) return;
  sfRenderBtn.disabled = true;
  sfRenderProgress.style.display = 'flex';
  sfDownloadRow.classList.add('hidden');
  sfRenderStatus.textContent = 'Rendering draft…';

  try {
    const resp = await fetch(`/api/render/${sfProjectId}?quality=draft`, { method: 'POST' });
    const { jobId } = await resp.json();

    const es = new EventSource(`/api/stream/${jobId}`);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'status') sfRenderStatus.textContent = event.data;
      if (event.type === 'complete') {
        es.close();
        sfRenderProgress.style.display = 'none';
        sfRenderBtn.disabled = false;
        const filename = `${sfProjectId}-draft.mp4`;
        sfDownloadLink.href = `/api/projects/${sfProjectId}/download/${filename}`;
        sfDownloadLink.textContent = `Download ${filename}`;
        sfDownloadRow.classList.remove('hidden');
      }
      if (event.type === 'error') {
        es.close();
        sfRenderProgress.style.display = 'none';
        sfRenderBtn.disabled = false;
        sfRenderStatus.textContent = `Render failed: ${event.data}`;
      }
    };
  } catch (err) {
    sfRenderProgress.style.display = 'none';
    sfRenderBtn.disabled = false;
    sfRenderStatus.textContent = `Error: ${err.message}`;
  }
});

sfRetryBtn.addEventListener('click', () => sfShowStage('input'));

// ── Init: check API key ───────────────────────────────────────────────────────
(async function sfInit() {
  try {
    const health = await fetch('/api/health').then((r) => r.json());
    if (!health.hasAnthropicKey) sfApiWarning.classList.remove('hidden');
  } catch (_) {}
})();
