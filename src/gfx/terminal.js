/**WARNING CLAUDESLOP!!! */
export class Terminal {
  constructor(root, { speed = 10, jitter = 30 } = {}) {
    this.root = root;
    this.output = root.querySelector(".output");
    this.speed = speed;
    this.jitter = jitter;
  }

  /** setTimeout can't be awaited on its own; a promise around it can. */
  #wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Appends text character by character. Resolves once the last one lands. */
  async type(text) {
    this.root.dataset.typing = ""; // reveals the cursor

    for (const char of text) {
      this.output.textContent += char;
      await this.#wait(this.speed + Math.random() * this.jitter);
    }

    delete this.root.dataset.typing; // and it is gone for good
  }

  /** Drops text in all at once, no animation. */
  write(text) {
    this.output.textContent = text;
  }
}
