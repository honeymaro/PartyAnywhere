export interface CaptureResult {
  stream: MediaStream;
  hasAudio: boolean;
}

/** Wraps getDisplayMedia for tab sharing, exposing audio-presence and share-ended signals. */
export class CaptureService {
  private stream: MediaStream | null = null;
  private endedTrack: MediaStreamTrack | null = null;
  private endedHandler: (() => void) | null = null;

  async start(): Promise<CaptureResult> {
    if (this.stream) this.stop(); // defensive: never orphan a previous stream
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    this.stream = stream;
    return { stream, hasAudio: stream.getAudioTracks().length > 0 };
  }

  /** Fires when the user stops sharing (the video track ends). Self-removes after firing. */
  onEnded(callback: () => void): void {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    const handler = () => {
      track.removeEventListener('ended', handler);
      this.endedTrack = null;
      this.endedHandler = null;
      callback();
    };
    this.endedTrack = track;
    this.endedHandler = handler;
    track.addEventListener('ended', handler);
  }

  stop(): void {
    if (this.endedTrack && this.endedHandler) {
      this.endedTrack.removeEventListener('ended', this.endedHandler);
      this.endedTrack = null;
      this.endedHandler = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
