import type { Locus, LocusActivity, LocusActivityKind } from "./locus.types.js";

type ManagedLocus = Readonly<{
  activity: LocusActivity;
  dispose(): void;
}>;

export type LiveHostPrincipal = Readonly<{
  id?: string;
  anonymous: boolean;
  value?: unknown;
}>;

export type LiveHostApplicationContext = Readonly<{
  applicationName: string;
  correlationId: string;
  principal: LiveHostPrincipal;
  clientAddress?: string;
}>;

export type LiveHostRequestRoute = Readonly<{
  method: string;
  path: string;
  handle(
    request: Request,
    context: LiveHostApplicationContext,
  ): Response | Promise<Response>;
}>;

export type LiveHostConnection = Readonly<{
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  onClose(listener: () => void): () => void;
}>;

export type LiveHostConnectionRoute = Readonly<{
  path: string;
  accept(
    request: Request,
    connection: LiveHostConnection,
    context: LiveHostApplicationContext,
  ): void | Promise<void>;
}>;

export type LiveHostApplication = Readonly<{
  name: string;
  requests?: readonly LiveHostRequestRoute[];
  connections?: readonly LiveHostConnectionRoute[];
  ready?(): boolean;
  dispose(): void | Promise<void>;
}>;

export type LiveHost = Readonly<{
  applicationNames: readonly string[];
  ready(): boolean;
  dispose(): Promise<void>;
}>;

export type LiveHostLocusRegistryResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: string;
        message: string;
        cause?: unknown;
      }>;
    }>;

export type LiveHostLocusAcquisition<TLocus extends ManagedLocus = Locus> = Readonly<{
  locus: TLocus;
  release(): void;
}>;

export type LiveHostLocusEvictionResult =
  | Readonly<{ status: "evicted" }>
  | Readonly<{ status: "not-found" }>
  | Readonly<{
      status: "busy";
      blockers: readonly (LocusActivityKind | "acquisition" | "loading" | "disposing")[];
    }>
  | Readonly<{ status: "disposing" }>
  | Readonly<{
      status: "failed";
      error: Readonly<{
        code: string;
        message: string;
        cause?: unknown;
      }>;
    }>;

export type LiveHostLocusRegistryOptions<TLocus extends ManagedLocus = Locus> = Readonly<{
  maxLoci: number;
  idleMs: number;
  automaticSweep?: boolean;
  sweepIntervalMs?: number;
  create(key: string): TLocus | Promise<TLocus>;
  dispose?(locus: TLocus): void | Promise<void>;
}>;

export type LiveHostLocusRegistry<TLocus extends ManagedLocus = Locus> = Readonly<{
  acquire(key: string): Promise<LiveHostLocusRegistryResult<LiveHostLocusAcquisition<TLocus>>>;
  has(key: string): boolean;
  evict(key: string): Promise<LiveHostLocusEvictionResult>;
  dispose(): Promise<void>;
}>;
