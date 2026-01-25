// events.types.ts

export type TreeEventHandler = (payload: unknown) => void;

export type TreeEvents = {
    on(type: string, handler: TreeEventHandler): () => void;
    once(type: string, handler: TreeEventHandler): () => void;
    emit(type: string, payload?: unknown): void;
};