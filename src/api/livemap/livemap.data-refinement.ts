export type DataLocationCheck = () => boolean;

export function require_data_location(check: DataLocationCheck | undefined): void {
  if (check?.() === false) throw new Error("Data location refinement no longer matches.");
}
