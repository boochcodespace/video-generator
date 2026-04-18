'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentProjectId = null;
let currentJobId = null;
let eventSource = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const form = document.getElementById('generate-form');
const videoInput = document.getElementById('video-input');
const dropZone = document.getElementById('drop-zone');
const dropLabel = document.getElementById('drop-label');
const generateBtn = document.getElementById('generate-btn');
const btnLabel = document.getElementById('btn-label');
const apiWarning = document.getElementById('api-warning');

const idleState = document.getElementById('idle-state');
const progressState = document.getElementById('progress-state');
const completeState = document.getElementById('complete-state');
const errorState = document.getElementById('error-state');

const progressTitle = document.getElementById('progress-title');
const progressLog = document.getElementById('progress-log');
const htmlProgressWrap = document.getElementById('html-progress-wrap');
const htmlBar = document.getElementById('html-bar');
const htmlChars = document.getElementById('html-chars');

const completeProjectId = document.getElementById('complete-project-id');
const previewBtn = document.getElementById('preview-btn');
const renderDraftBtn = document.getElementById('render-draft-btn');
const renderProgress = document.getElementById('render-progress');
const renderStatus = document.getElementById('render-status');
const downloadRow = document.getElementById('download-row');
const downloadLink = document.getElementById('download-link');
const previewCmd = document.getElementById('preview-cmd');

const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');
const statusBar = document.getElementById('status-bar');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const projectsList = document.getElementById('projects-list');

// ── UI helpers ────────────────────────────────────────────────────────────────
function showState(name) {
  [idleState, progressState, completeState, errorState].forEach((el) => el.classList.add('hidden'));
  const map = { idle: idleState, progress: progressState, complete: completeState, error: errorState };
  if (map[name]) map[name].classList.remove('hidden');
}

function setStatus(text, type = 'info') {
  statusBar.classList.remove('hidden');
  statusIndicator.className = `indicator indicator-${type}`;
  statusText.textContent = text;
}

function appendLog(msg) {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = msg;
  progressLog.appendChild(line);
  progressLog.scrollTop = progressLog.scrollHeight;
}

function disableForm(disabled) {
  generateBtn.disabled = disabled;
  btnLabel.textContent = disabled ? 'Generating…' : 'Generate Video';
  videoInput.disabled = disabled;
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) {
    videoInput.files = e.dataTransfer.files;
    updateDropLabel(e.dataTransfer.files[0].name);
  }
});
videoInput.addEventListener('change', () => {
  if (videoInput.files.length) updateDropLabel(videoInput.files[0].name);
});

function updateDropLabel(name) {
  dropLabel.innerHTML = `
    <svg class="drop-icon" width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>
    <span class="drop-text"><strong>${name}</strong></span>
    <span class="hint">Click to change</span>`;
}

// ── SSE stream handler ────────────────────────────────────────────────────────
function connectStream(jobId) {
  if (eventSource) eventSource.close();

  eventSource = new EventSource(`/api/stream/${jobId}`);

  eventSource.onmessage = (e) => {
    const event = JSON.parse(e.data);
    handleEvent(event);
  };

  eventSource.onerror = () => {
    setStatus('Connection lost', 'error');
    eventSource.close();
  };
}

function handleEvent({ type, data }) {
  switch (type) {
    case 'status':
      progressTitle.textContent = data;
      appendLog(data);
      setStatus(data, 'busy');
      break;

    case 'log':
      appendLog(data);
      break;

    case 'html_progress':
      htmlProgressWrap.classList.remove('hidden');
      htmlChars.textContent = data.chars.toLocaleString();
      // Animate bar — assume 6000 chars ≈ 100%
      const pct = Math.min(100, Math.round((data.chars / 6000) * 100));
      htmlBar.style.width = `${pct}%`;
      break;

    case 'complete':
      currentProjectId = data.projectId;
      eventSource.close();
      onGenerationComplete(data);
      break;

    case 'error':
      eventSource.close();
      onGenerationError(data);
      break;
  }
}

function onGenerationComplete({ projectId, projectDir, previewCmd: cmd }) {
  disableForm(false);
  showState('complete');
  setStatus('Ready', 'ok');

  completeProjectId.textContent = `Project: ${projectDir}`;
  previewCmd.textContent = cmd;

  loadProjects();
}

function onGenerationError(message) {
  disableForm(false);
  showState('error');
  setStatus('Failed', 'error');
  errorMessage.textContent = message;
}

// ── Form submit ───────────────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(form);
  progressLog.innerHTML = '';
  htmlProgressWrap.classList.add('hidden');
  htmlBar.style.width = '0%';
  htmlChars.textContent = '0';

  disableForm(true);
  showState('progress');
  setStatus('Uploading…', 'busy');

  try {
    const resp = await fetch('/api/generate', { method: 'POST', body: formData });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Server error');
    }
    const { jobId } = await resp.json();
    currentJobId = jobId;
    connectStream(jobId);
  } catch (err) {
    onGenerationError(err.message);
  }
});

// ── Preview button ────────────────────────────────────────────────────────────
previewBtn.addEventListener('click', () => {
  alert(
    `Open a terminal in your project and run:\n\n${previewCmd.textContent}\n\nThen visit http://localhost:3002`
  );
});

// ── Render draft ──────────────────────────────────────────────────────────────
renderDraftBtn.addEventListener('click', async () => {
  if (!currentProjectId) return;
  renderDraftBtn.disabled = true;
  renderProgress.classList.remove('hidden');
  downloadRow.classList.add('hidden');
  renderStatus.textContent = 'Rendering draft…';

  try {
    const resp = await fetch(`/api/render/${currentProjectId}?quality=draft`, { method: 'POST' });
    const { jobId } = await resp.json();

    const es = new EventSource(`/api/stream/${jobId}`);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'status') renderStatus.textContent = event.data;
      if (event.type === 'complete') {
        es.close();
        renderProgress.classList.add('hidden');
        renderDraftBtn.disabled = false;
        const filename = `${currentProjectId}-draft.mp4`;
        downloadLink.href = `/api/projects/${currentProjectId}/download/${filename}`;
        downloadLink.textContent = `⬇ Download ${filename}`;
        downloadRow.classList.remove('hidden');
      }
      if (event.type === 'error') {
        es.close();
        renderProgress.classList.add('hidden');
        renderDraftBtn.disabled = false;
        renderStatus.textContent = `Render failed: ${event.data}`;
      }
    };
  } catch (err) {
    renderProgress.classList.add('hidden');
    renderDraftBtn.disabled = false;
    renderStatus.textContent = `Error: ${err.message}`;
  }
});

// ── Retry ─────────────────────────────────────────────────────────────────────
retryBtn.addEventListener('click', () => {
  showState('idle');
  setStatus('Ready', 'ok');
});

// ── Project history ───────────────────────────────────────────────────────────
async function loadProjects() {
  try {
    const projects = await fetch('/api/projects').then((r) => r.json());
    if (!projects.length) {
      projectsList.innerHTML = '<span class="hint">No projects yet.</span>';
      return;
    }
    projectsList.innerHTML = projects
      .map((p) => {
        const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '';
        const renders = p.renders.length
          ? p.renders
              .map(
                (f) =>
                  `<a class="render-link" href="/api/projects/${p.id}/download/${f}" download>${f}</a>`
              )
              .join('')
          : '<span class="hint">No renders yet</span>';
        return `
          <div class="project-card">
            <div class="project-name">${p.name}</div>
            <div class="project-meta">${date} &nbsp;·&nbsp; <code>${p.id}</code></div>
            <div class="project-renders">${renders}</div>
          </div>`;
      })
      .join('');
  } catch (_) {
    projectsList.innerHTML = '<span class="hint">Could not load projects.</span>';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
  loadProjects();

  // Check API key health
  try {
    const health = await fetch('/api/health').then((r) => r.json());
    if (!health.hasAnthropicKey) {
      apiWarning.classList.remove('hidden');
    }
  } catch (_) {}
})();
