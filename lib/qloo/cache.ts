// 정규화한 요청 URL을 키로 쓰는 인스턴스 메모리 TTL 캐시(기본 24시간)

export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // refresh recency (Map keeps insertion order → oldest first)
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value as string;
      this.store.delete(oldest);
    }
  }

  get size(): number {
    return this.store.size;
  }
}
