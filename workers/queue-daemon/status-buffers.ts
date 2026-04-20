export class RingBuffer<T> {
  private readonly items: T[] = [];
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  push(item: T): void {
    this.items.unshift(item);
    if (this.items.length > this.cap) this.items.length = this.cap;
  }

  snapshot(): T[] {
    return this.items.slice();
  }
}
