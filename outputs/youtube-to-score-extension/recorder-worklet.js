// Hands the recorder small stereo blocks (~21 ms at 48 kHz), so pausing for an
// ad or a buffer stall drops at most one block of audio.
const SIZE = 1024;

class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.left = new Float32Array(SIZE);
    this.right = new Float32Array(SIZE);
    this.filled = 0;
  }

  process([input]) {
    const left = input[0];
    if (!left) return true;
    const right = input[1] || left;
    this.left.set(left, this.filled);
    this.right.set(right, this.filled);
    this.filled += left.length;
    if (this.filled >= SIZE) {
      this.port.postMessage([this.left, this.right], [this.left.buffer, this.right.buffer]);
      this.reset();
    }
    return true;
  }
}

registerProcessor('tap', Tap);
