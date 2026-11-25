export type ReuseEventBody<T> = (key: string, compute: () => T) => T;

// Each scan retains the active bodies that fit. Looking up the previous set
// separately prevents an early miss from evicting a body later in the scan.
export class EventBodyCache<T> {
  private bodies = new Map<string, T>();

  scan<R>(visit: (reuse: ReuseEventBody<T>) => R): R {
    const active = new Map<string, T>();
    let budget = 1_000_000;
    const result = visit((key, compute) => {
      const value = active.get(key) ?? this.bodies.get(key) ?? compute();
      const cost = key.length + 64; // UTF-16 key length plus an allowance for each entry.
      if (!active.has(key) && key.length <= 65_536 && cost <= budget) {
        active.set(key, value);
        budget -= cost;
      }
      return value;
    });
    this.bodies = active;
    return result;
  }
}
