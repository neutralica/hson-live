/** A passive namespace: only invoking a read resolves the owning endpoint. */
export function required_reads<T, H>(snap: () => T, hson: () => H) {
  const require = <V>(read: () => V, representation: string): Exclude<V, undefined> => {
    const value = read();
    if (value === undefined) throw new Error(`Required ${representation} read: endpoint is absent or its refinement no longer matches.`);
    return value as Exclude<V, undefined>;
  };
  return Object.freeze({
    snap: () => require(snap, "snapshot"),
    hson: () => require(hson, "Hson"),
  });
}
