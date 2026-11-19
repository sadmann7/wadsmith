// Several physical inputs can drive one game key, so a game key only goes up
// once the last input holding it has let go.
class HeldKeys {
  private readonly sources = new Map<string, number>();

  has(source: string) {
    return this.sources.has(source);
  }

  // Returns whether the game key has just gone down.
  press(source: string, key: number) {
    if (this.sources.has(source)) return false;
    const alreadyDown = this.isDown(key);
    this.sources.set(source, key);
    return !alreadyDown;
  }

  // Returns the game key that has just gone up, if any.
  release(source: string) {
    const key = this.sources.get(source);
    if (key === undefined) return null;
    this.sources.delete(source);
    return this.isDown(key) ? null : key;
  }

  keys() {
    return [...new Set(this.sources.values())];
  }

  releaseAll() {
    const released = new Set(this.sources.values());
    this.sources.clear();
    return [...released];
  }

  private isDown(key: number) {
    return [...this.sources.values()].includes(key);
  }
}

export { HeldKeys };
