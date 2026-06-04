import { CaptureService } from './capture/capture-service';
import { AudioAnalyser } from './audio/audio-analyser';
import { VisualizerHost } from './gl/visualizer-host';
import { VisualizerRegistry } from './gl/registry';
import { hexToRgb, DEFAULT_PALETTE } from './color/color-utils';
import { ColorService } from './color/color-service';
import type { ColorSourceId } from './color/color-service';
import { ManualColorSource, ImageColorSource, ScreenColorSource } from './color/sources';
import { registerAll } from './visualizers/index';
import { RotationController } from './rotation-controller';
import { loadSettings, saveSettings } from './settings-store';
import type { Settings } from './settings-store';
import type { AudioFrame, Palette } from './core/types';
import type { VisualizerInfo } from './gl/registry';

const SILENT_FRAME: AudioFrame = {
  spectrum: new Uint8Array(0),
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  beat: 0,
};

/** Wires capture -> analyser -> visualizer host and drives the render loop. */
export class App {
  private canvas: HTMLCanvasElement;
  private capture = new CaptureService();
  private registry = new VisualizerRegistry();
  private host: VisualizerHost;
  private analyser: AudioAnalyser | null = null;
  private rafId = 0;
  private startTime = 0;
  private lastTime = 0;
  private onStoppedCb: (() => void) | null = null;
  private video: HTMLVideoElement;
  private colorService: ColorService;
  private manualSource = new ManualColorSource(DEFAULT_PALETTE);
  private imageSource = new ImageColorSource();
  private screenSource: ScreenColorSource | null = null;
  private rotation = new RotationController();
  private selected = new Set<string>();
  private started = false;
  private starting = false;
  private manualColorHex = '#4f7cff';
  private imageOverlayEnabled = false;
  private overlayEffects: string[] = ['pulse'];
  private onFrameCb: ((audio: AudioFrame, dt: number, palette: Palette) => void) | null = null;
  private resizeHandler = (): void => this.handleResize();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.host = new VisualizerHost(canvas);

    const saved = loadSettings();

    registerAll(this.registry);
    const allIds = this.registry.list().map((v) => v.id);
    const restored = saved.selectedIds?.filter((id) => allIds.includes(id));
    for (const id of restored && restored.length ? restored : allIds) this.selected.add(id);

    if (saved.rotationIntervalSec) this.rotation.setIntervalSec(saved.rotationIntervalSec);
    if (saved.rotationPaused) this.rotation.setPaused(true);
    this.rotation.setPool(this.orderedPool());
    this.rotation.onChange((id) => {
      if (this.started) this.activateById(id);
    });

    this.handleResize();
    window.addEventListener('resize', this.resizeHandler);

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.style.display = 'none';
    document.body.appendChild(this.video);

    if (saved.manualColor) {
      try {
        this.manualSource.setPrimary(hexToRgb(saved.manualColor));
        this.manualColorHex = saved.manualColor;
      } catch {
        // ignore a corrupt saved color
      }
    }

    this.imageOverlayEnabled = saved.imageOverlay ?? false;
    this.overlayEffects = saved.overlayEffects ?? ['pulse'];

    this.colorService = new ColorService(DEFAULT_PALETTE, saved.colorSource ?? 'screen');
    this.colorService.addSource(this.manualSource);
    this.colorService.addSource(this.imageSource);
  }

  private persist(): void {
    const settings: Settings = {
      selectedIds: [...this.selected],
      colorSource: this.colorService.getActive(),
      manualColor: this.manualColorHex,
      rotationIntervalSec: this.rotation.getIntervalSec(),
      rotationPaused: this.rotation.isPaused(),
      imageOverlay: this.imageOverlayEnabled,
      overlayEffects: this.overlayEffects,
    };
    saveSettings(settings);
  }

  async start(): Promise<{ hasAudio: boolean }> {
    if (this.starting) return { hasAudio: false };
    this.starting = true;
    this.stop();
    try {
      const { stream, hasAudio } = await this.capture.start();
      if (!hasAudio) {
        // Common mistake: shared a tab without enabling "Share tab audio".
        // Release the video-only stream and let the caller show guidance — there's
        // nothing to visualize without audio (and createMediaStreamSource would throw).
        this.capture.stop();
        return { hasAudio: false };
      }
      this.analyser = new AudioAnalyser(stream);
      await this.analyser.resume();
      this.video.srcObject = stream;
      await this.video.play().catch(() => undefined);
      this.screenSource = new ScreenColorSource(this.video);
      this.colorService.addSource(this.screenSource);
      this.started = true;
      const cur = this.rotation.current();
      if (cur) this.activateById(cur);
      this.capture.onEnded(() => this.stop());
      this.startLoop();
      return { hasAudio };
    } catch (err) {
      this.stop();
      throw err;
    } finally {
      this.starting = false;
    }
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.resizeHandler);
    this.host.dispose();
    this.video.remove();
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.startTime = 0;
    this.lastTime = 0;
    this.started = false;
    this.analyser?.close();
    this.analyser = null;
    this.colorService.removeSource('screen');
    this.screenSource = null;
    this.video.srcObject = null;
    this.capture.stop();
    this.onStoppedCb?.();
  }

  onStopped(cb: () => void): void {
    this.onStoppedCb = cb;
  }

  async enterFullscreen(): Promise<void> {
    // Fullscreen the #stage wrapper (canvas + image overlay), not just the canvas.
    await (this.canvas.parentElement ?? this.canvas).requestFullscreen();
  }

  // used by the Plan 3 gallery
  visualizers(): VisualizerInfo[] {
    return this.registry.list();
  }

  /** Activate a visualizer; if it fails to init (e.g. bad shader), drop it from the pool. */
  private activateById(id: string): void {
    const ok = this.host.activate(this.registry.create(id));
    if (!ok) {
      this.selected.delete(id);
      this.rotation.setPool(this.orderedPool()); // re-emits onChange → next valid one
    }
  }

  private orderedPool(): string[] {
    return this.registry.list().map((v) => v.id).filter((id) => this.selected.has(id));
  }

  selectedIds(): Set<string> {
    return new Set(this.selected);
  }

  setPoolSelected(id: string, selected: boolean): void {
    if (selected) this.selected.add(id);
    else this.selected.delete(id);
    this.rotation.setPool(this.orderedPool());
    this.persist();
  }

  /** Select or deselect every registered visualizer at once. */
  setAllSelected(selected: boolean): void {
    this.selected.clear();
    if (selected) for (const v of this.registry.list()) this.selected.add(v.id);
    this.rotation.setPool(this.orderedPool());
    this.persist();
  }

  rotateNext(): void {
    this.rotation.next();
  }

  rotatePrev(): void {
    this.rotation.prev();
  }

  setRotationPaused(paused: boolean): void {
    this.rotation.setPaused(paused);
    this.persist();
  }

  isRotationPaused(): boolean {
    return this.rotation.isPaused();
  }

  setRotationIntervalSec(sec: number): void {
    this.rotation.setIntervalSec(sec);
    this.persist();
  }

  getRotationIntervalSec(): number {
    return this.rotation.getIntervalSec();
  }

  isImageOverlayEnabled(): boolean {
    return this.imageOverlayEnabled;
  }

  setImageOverlayEnabled(enabled: boolean): void {
    this.imageOverlayEnabled = enabled;
    this.persist();
  }

  getOverlayEffects(): string[] {
    return [...this.overlayEffects];
  }

  setOverlayEffects(ids: string[]): void {
    this.overlayEffects = ids;
    this.persist();
  }

  /** Register a per-frame callback (audio + dt + current palette). Fires only while running. */
  onFrame(cb: (audio: AudioFrame, dt: number, palette: Palette) => void): void {
    this.onFrameCb = cb;
  }

  setColorSource(id: ColorSourceId): void {
    this.colorService.setActive(id);
    this.persist();
  }

  getColorSource(): ColorSourceId {
    return this.colorService.getActive();
  }

  getManualColorHex(): string {
    return this.manualColorHex;
  }

  setManualColor(hex: string): void {
    this.manualColorHex = hex;
    this.manualSource.setPrimary(hexToRgb(hex));
    this.colorService.setActive('manual');
    this.persist();
  }

  setImageFromFile(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        this.imageSource.setImage(img);
        URL.revokeObjectURL(url);
        this.colorService.setActive('image');
        this.persist();
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  }

  private startLoop(): void {
    const loop = (now: number) => {
      if (this.startTime === 0) {
        this.startTime = now;
        this.lastTime = now;
      }
      const time = (now - this.startTime) / 1000;
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;

      this.rotation.update(dt);
      const audio = this.analyser ? this.analyser.frame() : SILENT_FRAME;
      this.screenSource?.sample(now);
      const palette = this.colorService.update(dt);
      this.host.render({
        time,
        dt,
        resolution: [this.canvas.width, this.canvas.height],
        audio,
        palette,
      });
      this.onFrameCb?.(audio, dt, palette);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private handleResize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.host.resize(
      Math.floor(window.innerWidth * dpr),
      Math.floor(window.innerHeight * dpr),
    );
  }
}
