const defaultIntervalMs = 1000 / 60;
// A refresh this close to the next frame counts as on time, which absorbs
// display jitter without letting the average rise above the target rate.
const earlyToleranceMs = 5;
const displayTimeoutMs = 100;
const minTimerMs = 4;

class FramePacer {
  private nextFrameAt = 0;
  private lastDisplayAt = -Infinity;

  constructor(private readonly intervalMs = defaultIntervalMs) {}

  start(now: number) {
    this.nextFrameAt = now + this.intervalMs;
  }

  onDisplay(now: number) {
    this.lastDisplayAt = now;
    return this.take(now);
  }

  // The timer only runs frames while the page has stopped refreshing.
  onTimer(now: number) {
    return now - this.lastDisplayAt > displayTimeoutMs && this.take(now);
  }

  timerDelay(now: number) {
    return Math.max(minTimerMs, this.nextFrameAt - now);
  }

  private take(now: number) {
    if (now < this.nextFrameAt - earlyToleranceMs) return false;
    this.nextFrameAt += this.intervalMs;
    if (this.nextFrameAt < now) {
      this.nextFrameAt = now + this.intervalMs - earlyToleranceMs;
    }
    return true;
  }
}

export { FramePacer };
