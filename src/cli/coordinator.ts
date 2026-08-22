import type {
  CliJobIdentity,
  CliJobKind,
  CliProviderAdapter,
  ProviderId,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "./contracts";
import { CliProviderError } from "./errors";

export class CliJobCoordinator {
  private nextJobOrdinal = 1;
  private readonly listeners = new Set<
    (activeJob: CliJobIdentity | undefined) => void
  >();
  private active:
    | {
        readonly identity: CliJobIdentity;
        readonly controller: AbortController;
      }
    | undefined;

  get isBusy(): boolean {
    return this.active !== undefined;
  }

  get activeProviderId(): ProviderId | undefined {
    return this.active?.identity.provider;
  }

  get activeJob(): CliJobIdentity | undefined {
    return this.active?.identity;
  }

  async generate<T>(
    adapter: CliProviderAdapter,
    request: StructuredGenerationRequest<T>,
    identity?: CliJobIdentity,
  ): Promise<StructuredGenerationResult<T>> {
    if (identity !== undefined && identity.provider !== adapter.id) {
      throw new CliProviderError(
        "unsupported-capability",
        "The selected CLI job provider does not match its adapter.",
        { provider: adapter.id },
      );
    }
    return await this.runExclusive(
      adapter.id,
      async (signal) =>
        await adapter.generate({
          ...request,
          signal,
        }),
      request.signal,
      identity,
    );
  }

  async runExclusive<T>(
    provider: ProviderId,
    task: (signal: AbortSignal) => Promise<T>,
    callerSignal?: AbortSignal,
    identity?: CliJobIdentity,
  ): Promise<T> {
    if (this.active !== undefined) {
      throw new CliProviderError(
        "busy",
        `Practice Problem Generator is already running a ${this.active.identity.provider} ${this.active.identity.kind} job.`,
        {
          provider: this.active.identity.provider,
          detail: `Active job ID: ${this.active.identity.id}`,
        },
      );
    }

    const resolvedIdentity = identity ?? this.createIdentity(provider, "generation");
    if (resolvedIdentity.provider !== provider) {
      throw new CliProviderError(
        "unsupported-capability",
        "The selected CLI job provider does not match the requested provider.",
        { provider },
      );
    }

    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    if (callerSignal?.aborted === true) abortFromCaller();
    this.active = { identity: resolvedIdentity, controller };
    this.notifyListeners();

    try {
      return await task(controller.signal);
    } finally {
      callerSignal?.removeEventListener("abort", abortFromCaller);
      if (this.active?.controller === controller) {
        this.active = undefined;
        this.notifyListeners();
      }
    }
  }

  /**
   * Wait for ownership instead of treating an already-running foreground job
   * as a provider failure. The exclusive check is retried after every wakeup,
   * so a foreground job that wins the race still remains globally exclusive.
   */
  async runWhenAvailable<T>(
    provider: ProviderId,
    task: (signal: AbortSignal) => Promise<T>,
    callerSignal?: AbortSignal,
    identity?: CliJobIdentity,
  ): Promise<T> {
    while (true) {
      if (callerSignal?.aborted === true) {
        throw new CliProviderError(
          "cancelled",
          "Waiting for the active AI job was cancelled.",
          { provider },
        );
      }
      try {
        return await this.runExclusive(
          provider,
          task,
          callerSignal,
          identity,
        );
      } catch (error) {
        if (!(error instanceof CliProviderError) || error.code !== "busy") {
          throw error;
        }
        await this.whenIdle(callerSignal);
      }
    }
  }

  cancel(jobId?: string): boolean {
    if (this.active === undefined) return false;
    if (jobId !== undefined && this.active.identity.id !== jobId) return false;
    this.active.controller.abort(
      new DOMException(
        `Practice Problem Generator ${this.active.identity.kind} job cancelled`,
        "AbortError",
      ),
    );
    return true;
  }

  /** Stop polling a durable generation without terminating its local helper. */
  detach(jobId?: string): boolean {
    if (this.active === undefined) return false;
    if (jobId !== undefined && this.active.identity.id !== jobId) return false;
    const reason = new Error(
      `Practice Problem Generator detached from ${this.active.identity.kind} ${this.active.identity.id}`,
    );
    reason.name = "PracticeLabDetach";
    this.active.controller.abort(reason);
    return true;
  }

  subscribe(
    listener: (activeJob: CliJobIdentity | undefined) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async whenIdle(signal?: AbortSignal): Promise<void> {
    if (this.active === undefined) return;
    if (signal?.aborted === true) {
      throw new CliProviderError(
        "cancelled",
        "Waiting for the active AI job was cancelled.",
      );
    }
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = this.subscribe((activeJob) => {
        if (activeJob !== undefined) return;
        cleanup();
        resolve();
      });
      const cancel = (): void => {
        cleanup();
        reject(
          new CliProviderError(
            "cancelled",
            "Waiting for the active AI job was cancelled.",
          ),
        );
      };
      const cleanup = (): void => {
        unsubscribe();
        signal?.removeEventListener("abort", cancel);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (this.active === undefined) {
        cleanup();
        resolve();
      }
    });
  }

  private createIdentity(
    provider: ProviderId,
    kind: CliJobKind,
  ): CliJobIdentity {
    const id = `${kind}-${String(this.nextJobOrdinal).padStart(4, "0")}`;
    this.nextJobOrdinal += 1;
    return { id, kind, provider };
  }

  private notifyListeners(): void {
    const activeJob = this.active?.identity;
    for (const listener of this.listeners) {
      try {
        listener(activeJob);
      } catch {
        // Observer failures must not leak an active-job lock or stop cleanup.
      }
    }
  }
}
