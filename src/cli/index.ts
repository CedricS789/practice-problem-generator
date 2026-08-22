import {
  AgyCliProviderAdapter,
  type AgyVisionProbeResult,
} from "./agy";
import { ClaudeCliProviderAdapter } from "./claude";
import { CliJobCoordinator } from "./coordinator";
import { CodexCliProviderAdapter } from "./codex";
import type {
  CliJobFileSystem,
  CliProcessRunner,
  ProviderDetection,
  ProviderId,
} from "./contracts";
import { DesktopJobFileSystem, DesktopProcessRunner } from "./runtime";

export * from "./agy";
export * from "./activity";
export {
  appendNeutralMediaManifest,
  DEFAULT_GENERATION_TIMEOUT_MS,
  GENERATION_RECOVERY_CONTEXT_FILENAME,
} from "./base-adapter";
export * from "./claude";
export * from "./codex";
export * from "./contracts";
export * from "./coordinator";
export * from "./errors";
export * from "./parse";
export * from "./runtime";

export const DEFAULT_PROVIDER_ID: ProviderId = "codex";

export interface CliProviderLayer {
  readonly adapters: CliProviderAdapters;
  readonly coordinator: CliJobCoordinator;
  detectAll(signal?: AbortSignal): Promise<readonly ProviderDetection[]>;
  probeAgyVision(signal?: AbortSignal): Promise<AgyVisionProbeResult>;
}

export interface CliProviderAdapters {
  readonly codex: CodexCliProviderAdapter;
  readonly claude: ClaudeCliProviderAdapter;
  readonly agy: AgyCliProviderAdapter;
}

export function createCliProviderLayer(dependencies: {
  readonly runner?: CliProcessRunner;
  readonly jobFileSystem?: CliJobFileSystem;
  readonly executables?: Readonly<Partial<Record<ProviderId, string>>>;
} = {}): CliProviderLayer {
  const runner = dependencies.runner ?? new DesktopProcessRunner();
  const jobFileSystem =
    dependencies.jobFileSystem ?? new DesktopJobFileSystem();
  const adapters: CliProviderAdapters = {
    codex: new CodexCliProviderAdapter(
      runner,
      jobFileSystem,
      dependencies.executables?.codex,
    ),
    claude: new ClaudeCliProviderAdapter(
      runner,
      jobFileSystem,
      dependencies.executables?.claude,
    ),
    agy: new AgyCliProviderAdapter(
      runner,
      jobFileSystem,
      dependencies.executables?.agy,
    ),
  };
  const coordinator = new CliJobCoordinator();
  let maintenanceJobOrdinal = 1;
  const configureDetection = (
    adapter: CodexCliProviderAdapter | ClaudeCliProviderAdapter | AgyCliProviderAdapter,
  ): void => {
    adapter.configureDetectionScheduler(async (task, signal) => {
      const ordinal = maintenanceJobOrdinal;
      maintenanceJobOrdinal += 1;
      return await coordinator.runWhenAvailable(
        adapter.id,
        task,
        signal,
        {
          id: `provider-detection-${adapter.id}-${String(ordinal).padStart(4, "0")}`,
          kind: "provider-detection",
          provider: adapter.id,
        },
      );
    });
  };
  configureDetection(adapters.codex);
  configureDetection(adapters.claude);
  configureDetection(adapters.agy);

  return {
    adapters,
    coordinator,
    async detectAll(signal?: AbortSignal) {
      const providerAdapters = [adapters.codex, adapters.claude, adapters.agy] as const;
      const detections: ProviderDetection[] = [];
      for (const adapter of providerAdapters) {
        detections.push(await adapter.detect(signal));
      }
      return detections;
    },
    async probeAgyVision(signal?: AbortSignal) {
      const ordinal = maintenanceJobOrdinal;
      maintenanceJobOrdinal += 1;
      return await coordinator.runWhenAvailable(
        "agy",
        async (jobSignal) => await adapters.agy.probeVision(jobSignal),
        signal,
        {
          id: `provider-probe-agy-${String(ordinal).padStart(4, "0")}`,
          kind: "provider-probe",
          provider: "agy",
        },
      );
    },
  };
}
