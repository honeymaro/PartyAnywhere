/**
 * While the stage is fullscreen, hide the on-stage controls (and the cursor) after
 * `idleMs` of no pointer movement, and reveal them on pointer move. Outside fullscreen
 * the controls are always visible. Toggles the `controls-hidden` class on `stage`.
 */
export function setupControlsAutohide(stage: HTMLElement, idleMs = 3000): void {
  let timer = 0;
  let active = false;

  const hide = (): void => {
    stage.classList.add('controls-hidden');
  };

  const reveal = (): void => {
    stage.classList.remove('controls-hidden');
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(hide, idleMs);
  };

  stage.addEventListener('pointermove', () => {
    if (active) reveal();
  });

  document.addEventListener('fullscreenchange', () => {
    active = document.fullscreenElement === stage;
    if (active) {
      reveal(); // show now, then start the idle countdown
    } else {
      if (timer) clearTimeout(timer);
      timer = 0;
      stage.classList.remove('controls-hidden'); // always visible in windowed mode
    }
  });
}
