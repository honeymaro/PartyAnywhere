import './style.css';
import { App } from './app';
import type { ColorSourceId } from './color/color-service';
import { VISUALIZERS } from './visualizers/index';
import { PreviewGallery } from './ui/preview-gallery';

const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <canvas id="stage"></canvas>
  <div id="controls">
    <button id="start" type="button">Start screen share</button>
    <button id="fullscreen" type="button" disabled>Fullscreen</button>
    <span class="divider"></span>
    <label>Color:</label>
    <button id="src-screen" type="button" class="src active">Auto (screen)</button>
    <button id="src-image" type="button" class="src">Image</button>
    <button id="src-manual" type="button" class="src">Manual</button>
    <input id="color-pick" type="color" value="#4f7cff" class="control-hidden" />
    <label id="image-label" class="file-btn control-hidden">Upload image<input id="image-file" type="file" accept="image/*" hidden /></label>
    <span class="divider"></span>
    <button id="rot-prev" type="button">◀</button>
    <button id="rot-pause" type="button">⏸ Pause</button>
    <button id="rot-next" type="button">▶</button>
    <label>Rotate (sec):</label>
    <input id="rot-interval" type="number" min="3" max="600" value="20" />
    <button id="gallery-toggle" type="button">Visualizers ▦</button>
    <span class="divider"></span>
    <span id="status">Idle</span>
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
`;

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start')!;
const fsBtn = document.querySelector<HTMLButtonElement>('#fullscreen')!;

const app = new App(canvas);

app.onStopped(() => {
  status.classList.remove('warn');
  status.textContent = 'Idle';
  fsBtn.disabled = true;
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
  void app.enterFullscreen();
});

const srcButtons: Record<ColorSourceId, HTMLButtonElement> = {
  screen: document.querySelector<HTMLButtonElement>('#src-screen')!,
  image: document.querySelector<HTMLButtonElement>('#src-image')!,
  manual: document.querySelector<HTMLButtonElement>('#src-manual')!,
};

const colorPick = document.querySelector<HTMLInputElement>('#color-pick')!;
const imageLabel = document.querySelector<HTMLLabelElement>('#image-label')!;

function highlightSource(id: ColorSourceId): void {
  for (const key of Object.keys(srcButtons) as ColorSourceId[]) {
    srcButtons[key].classList.toggle('active', key === id);
  }
  // Reveal only the control relevant to the active source.
  colorPick.classList.toggle('control-hidden', id !== 'manual');
  imageLabel.classList.toggle('control-hidden', id !== 'image');
}

(Object.keys(srcButtons) as ColorSourceId[]).forEach((id) => {
  srcButtons[id].addEventListener('click', () => {
    app.setColorSource(id);
    highlightSource(id);
  });
});

// Initialize from persisted settings: color picker value + visibility for the active source.
colorPick.value = app.getManualColorHex();
highlightSource(app.getColorSource());

colorPick.addEventListener('input', () => {
  app.setManualColor(colorPick.value);
  highlightSource('manual');
});

const imageFile = document.querySelector<HTMLInputElement>('#image-file')!;
imageFile.addEventListener('change', async () => {
  const file = imageFile.files?.[0];
  if (!file) return;
  try {
    await app.setImageFromFile(file);
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

window.addEventListener('beforeunload', () => gallery?.dispose());
