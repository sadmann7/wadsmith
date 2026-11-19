// A token bucket. Steady play stays well inside it, and a one-off burst such as
// the map sent at the start of a game fits in its depth.
class Budget {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSecond: number,
    private readonly depth: number,
    now: number,
  ) {
    this.tokens = depth;
    this.last = now;
  }

  take(cost: number, now: number) {
    this.tokens = Math.min(
      this.depth,
      this.tokens + ((now - this.last) / 1000) * this.perSecond,
    );
    this.last = now;
    if (cost > this.tokens) return false;
    this.tokens -= cost;
    return true;
  }
}

const maxTextBytes = 1024 * 1024;
const maxBinaryBytes = 16 * 1024 + 2;
// Dropped messages count against a connection until steady traffic pays them
// back, so a short spike survives and a flood gets the connection closed.
const maxDropped = 200;

type Verdict = "send" | "drop" | "close";

class ConnectionLimits {
  private readonly messages: Budget;
  private readonly bytes: Budget;
  private dropped = 0;

  constructor(now: number) {
    this.messages = new Budget(300, 600, now);
    this.bytes = new Budget(256 * 1024, 2 * maxTextBytes, now);
  }

  check(message: string | ArrayBuffer, now: number): Verdict {
    const size =
      typeof message === "string" ? message.length : message.byteLength;
    if (size > (typeof message === "string" ? maxTextBytes : maxBinaryBytes)) {
      return "close";
    }
    if (this.messages.take(1, now) && this.bytes.take(size, now)) {
      this.dropped = Math.max(0, this.dropped - 1);
      return "send";
    }
    this.dropped += 1;
    return this.dropped > maxDropped ? "close" : "drop";
  }
}

export { Budget, ConnectionLimits, maxBinaryBytes, maxTextBytes };
