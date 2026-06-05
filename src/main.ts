import './style.css';
import { App } from './app';
import type { ColorSourceId } from './color/color-service';
import { VISUALIZERS } from './visualizers/index';
import { PreviewGallery } from './ui/preview-gallery';
import { ImageOverlay } from './ui/image-overlay';
import { OVERLAY_EFFECTS } from './ui/overlay-effects';
import { setupControlsAutohide } from './ui/controls-autohide';
import { applyUiPalette } from './ui/ui-palette';
import { hexToRgb } from './color/color-utils';

const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <div id="stage">
    <canvas id="view"></canvas>
    <span id="status">Idle</span>
    <div id="controls" class="ctl-bar">
      <div class="ctl-main">
        <span class="ctl-group">
          <button id="start" type="button">Start screen share</button>
          <label id="image-label" class="file-btn">Select image<input id="image-file" type="file" accept="image/*" hidden /></label>
          <button id="fullscreen" type="button" disabled>⛶ Fullscreen</button>
        </span>
      </div>
    </div>
    <div id="controls-right" class="ctl-bar">
      <div id="overlay-context" class="ctl-context control-hidden">
        <label>Effects</label>
        <span id="overlay-effects" class="overlay-effects"></span>
      </div>
      <div class="ctl-main">
        <span class="ctl-group">
          <button id="overlay-toggle" type="button">Image overlay</button>
        </span>
      </div>
    </div>
    <div id="transport" class="ctl-float">
      <button id="rot-prev" type="button">◀</button>
      <button id="rot-pause" type="button">⏸ Pause</button>
      <button id="rot-next" type="button">▶</button>
      <span class="ctl-sep"></span>
      <label>Rotate (s)</label>
      <input id="rot-interval" type="number" min="3" max="600" value="20" />
    </div>
    <div id="setup">
      <div class="ctl-main">
        <span class="ctl-group">
          <button id="gallery-toggle" type="button">Visualizers ▦</button>
        </span>
      </div>
      <div class="ctl-main">
        <span class="ctl-group">
          <label>Color</label>
          <span class="segmented">
            <button id="src-screen" type="button" class="src active">Auto</button>
            <button id="src-image" type="button" class="src" disabled>From image</button>
            <button id="src-manual" type="button" class="src">Manual</button>
          </span>
        </span>
      </div>
      <div id="color-context" class="ctl-context control-hidden">
        <label>Primary</label>
        <input id="color-pick" type="color" value="#4f7cff" />
        <label>Accent</label>
        <input id="accent-pick" type="color" value="#ff4fa3" />
      </div>
    </div>
    <div id="gallery" class="hidden">
      <div class="gallery-head">
        <h2>Select Visualizers</h2>
        <div class="gallery-head-actions">
          <button id="gallery-all" type="button">Select all</button>
          <button id="gallery-none" type="button">Deselect all</button>
          <button id="gallery-close" type="button">Close ✕</button>
        </div>
      </div>
      <div id="gallery-grid"></div>
    </div>
  </div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const stage = document.querySelector<HTMLDivElement>('#stage')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start')!;
const fsBtn = document.querySelector<HTMLButtonElement>('#fullscreen')!;

const app = new App(canvas);
const overlay = new ImageOverlay(stage);
app.onFrame((audio, dt, palette) => {
  overlay.update(audio, dt, palette);
  applyUiPalette(stage, palette.primary, palette.accent);
});

app.onStopped(() => {
  status.classList.remove('warn');
  status.textContent = 'Idle';
  // Don't disable while still fullscreen — that would trap the user (Exit unreachable).
  fsBtn.disabled = !document.fullscreenElement;
  overlay.reset();
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    const { hasAudio } = await app.start();
    if (hasAudio) {
      status.classList.remove('warn');
      status.textContent = 'Sharing';
      fsBtn.disabled = false;
    } else {
      // No audio track: the user shared a tab/screen without tab audio. Guide them.
      status.classList.add('warn');
      status.textContent =
        '⚠ No tab audio. Click "Start screen share" again, choose the tab, and turn ON "Share tab audio" in the share dialog.';
    }
  } catch (err) {
    status.classList.add('warn');
    status.textContent = `Start failed: ${(err as Error).message}`;
  } finally {
    startBtn.disabled = false;
  }
});

fsBtn.addEventListener('click', () => {
  void app.toggleFullscreen().catch(() => undefined);
});

document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = document.fullscreenElement ? '⛶ Exit' : '⛶ Fullscreen';
});

setupControlsAutohide(stage);

const srcButtons: Record<ColorSourceId, HTMLButtonElement> = {
  screen: document.querySelector<HTMLButtonElement>('#src-screen')!,
  image: document.querySelector<HTMLButtonElement>('#src-image')!,
  manual: document.querySelector<HTMLButtonElement>('#src-manual')!,
};

const colorPick = document.querySelector<HTMLInputElement>('#color-pick')!;
const accentPick = document.querySelector<HTMLInputElement>('#accent-pick')!;
const colorContext = document.querySelector<HTMLDivElement>('#color-context')!;
const overlayContext = document.querySelector<HTMLDivElement>('#overlay-context')!;

function highlightSource(id: ColorSourceId): void {
  for (const key of Object.keys(srcButtons) as ColorSourceId[]) {
    srcButtons[key].classList.toggle('active', key === id);
  }
  // Reveal the manual color pickers only when Manual is active. The image upload stays
  // always visible — the uploaded image now also feeds the image overlay, not just color.
  colorContext.classList.toggle('control-hidden', id !== 'manual');
}

(Object.keys(srcButtons) as ColorSourceId[]).forEach((id) => {
  srcButtons[id].addEventListener('click', () => {
    app.setColorSource(id);
    highlightSource(id);
  });
});

// Initialize from persisted settings: color picker value + visibility for the active source.
colorPick.value = app.getManualColorHex();
accentPick.value = app.getManualAccentHex();
applyUiPalette(stage, hexToRgb(app.getManualColorHex()), hexToRgb(app.getManualAccentHex()));
highlightSource(app.getColorSource());

colorPick.addEventListener('input', () => {
  app.setManualColor(colorPick.value);
  applyUiPalette(stage, hexToRgb(colorPick.value), hexToRgb(accentPick.value));
  highlightSource('manual');
});

accentPick.addEventListener('input', () => {
  app.setManualAccent(accentPick.value);
  applyUiPalette(stage, hexToRgb(colorPick.value), hexToRgb(accentPick.value));
  highlightSource('manual');
});

const imageFile = document.querySelector<HTMLInputElement>('#image-file')!;
imageFile.addEventListener('change', async () => {
  const file = imageFile.files?.[0];
  if (!file) return;
  overlay.setImageFile(file);
  try {
    await app.setImageFromFile(file);
    srcButtons.image.disabled = false; // image-based color is now available
    highlightSource('image');
  } catch (err) {
    status.textContent = `Image load failed: ${(err as Error).message}`;
  }
});

const rotPrev = document.querySelector<HTMLButtonElement>('#rot-prev')!;
const rotNext = document.querySelector<HTMLButtonElement>('#rot-next')!;
const rotPause = document.querySelector<HTMLButtonElement>('#rot-pause')!;
const rotInterval = document.querySelector<HTMLInputElement>('#rot-interval')!;

// Restore persisted rotation UI state.
rotInterval.value = String(app.getRotationIntervalSec());
let paused = app.isRotationPaused();
rotPause.textContent = paused ? '▶ Resume' : '⏸ Pause';

rotPrev.addEventListener('click', () => app.rotatePrev());
rotNext.addEventListener('click', () => app.rotateNext());
rotPause.addEventListener('click', () => {
  paused = !paused;
  app.setRotationPaused(paused);
  rotPause.textContent = paused ? '▶ Resume' : '⏸ Pause';
});
rotInterval.addEventListener('change', () => {
  const sec = Number(rotInterval.value);
  if (sec >= 3) app.setRotationIntervalSec(sec);
});

const galleryEl = document.querySelector<HTMLDivElement>('#gallery')!;
const galleryGrid = document.querySelector<HTMLDivElement>('#gallery-grid')!;
const galleryToggle = document.querySelector<HTMLButtonElement>('#gallery-toggle')!;
const galleryClose = document.querySelector<HTMLButtonElement>('#gallery-close')!;

let gallery: PreviewGallery | null = null;

function openGallery(): void {
  if (!gallery) {
    gallery = new PreviewGallery({
      container: galleryGrid,
      entries: VISUALIZERS,
      selected: app.selectedIds(),
      onToggle: (id, checked) => app.setPoolSelected(id, checked),
    });
  }
  galleryEl.classList.remove('hidden');
  gallery.start();
}

function closeGallery(): void {
  galleryEl.classList.add('hidden');
  gallery?.stop();
}

galleryToggle.addEventListener('click', () => {
  if (galleryEl.classList.contains('hidden')) openGallery();
  else closeGallery();
});
galleryClose.addEventListener('click', closeGallery);

const galleryAll = document.querySelector<HTMLButtonElement>('#gallery-all')!;
const galleryNone = document.querySelector<HTMLButtonElement>('#gallery-none')!;

function setAllSelected(checked: boolean): void {
  app.setAllSelected(checked);
  gallery?.setAllChecked(checked);
}

galleryAll.addEventListener('click', () => setAllSelected(true));
galleryNone.addEventListener('click', () => setAllSelected(false));

const overlayToggle = document.querySelector<HTMLButtonElement>('#overlay-toggle')!;
const overlayEffectsEl = document.querySelector<HTMLSpanElement>('#overlay-effects')!;

// One checkbox per effect — multiple can be active at once (e.g. Spin + Pulse).
const effectChecks: Record<string, HTMLInputElement> = {};
for (const e of OVERLAY_EFFECTS) {
  const label = document.createElement('label');
  label.className = 'overlay-effect';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = e.id;
  const name = document.createElement('span');
  name.textContent = e.name;
  label.appendChild(cb);
  label.appendChild(name);
  overlayEffectsEl.appendChild(label);
  effectChecks[e.id] = cb;
  cb.addEventListener('change', applyEffects);
}

function applyEffects(): void {
  const ids = OVERLAY_EFFECTS.map((e) => e.id).filter((id) => effectChecks[id].checked);
  app.setOverlayEffects(ids);
  overlay.setEffects(ids);
}

function reflectOverlay(enabled: boolean): void {
  overlayToggle.classList.toggle('active', enabled);
  overlayToggle.textContent = `Image overlay: ${enabled ? 'On' : 'Off'}`;
  overlayContext.classList.toggle('control-hidden', !enabled);
}

// Restore persisted overlay state (filter to known effect ids).
const knownEffectIds = new Set(OVERLAY_EFFECTS.map((e) => e.id));
const savedEffects = app.getOverlayEffects().filter((id) => knownEffectIds.has(id));
for (const e of OVERLAY_EFFECTS) effectChecks[e.id].checked = savedEffects.includes(e.id);
app.setOverlayEffects(savedEffects); // normalize the persisted value (drops any unknown ids)
overlay.setEffects(savedEffects);
overlay.setEnabled(app.isImageOverlayEnabled());
reflectOverlay(app.isImageOverlayEnabled());

overlayToggle.addEventListener('click', () => {
  const next = !app.isImageOverlayEnabled();
  app.setImageOverlayEnabled(next);
  overlay.setEnabled(next);
  reflectOverlay(next);
});

window.addEventListener('beforeunload', () => {
  gallery?.dispose();
  overlay.dispose();
});
