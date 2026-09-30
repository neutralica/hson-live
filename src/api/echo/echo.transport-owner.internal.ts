/** Private release hook for a transport whose sole Echo owner has ended. */
const releases = new WeakMap<object, () => void>();

export function register_echo_transport_owner_release_internal(transport: object, release: () => void): void {
  releases.set(transport, release);
}

export function release_echo_transport_owner_internal(transport: object): void {
  const release = releases.get(transport);
  releases.delete(transport);
  release?.();
}
