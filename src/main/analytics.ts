/**
 * Product analytics — completely disabled for Conclave local-first standalone operation.
 */
export type AnalyticsFeature = string;
export type SpawnFailReason = string;
export type InstallRung = string;
export type InstallOutcome = string;
export type MessageSurface = 'terminal' | 'composer' | 'steer' | 'hive';

export function isRendererMessageSurface(surface: unknown): surface is MessageSurface {
  return typeof surface === 'string' && ['terminal', 'composer', 'steer', 'hive'].includes(surface);
}

export const analytics = {
  init(_options?: any, _legacyAppVersion?: string): void {},
  setEnabled(_enabled: boolean): void {},
  isEnabled(): boolean {
    return false;
  },
  track(_event: string, _properties?: Record<string, unknown>): void {},
  trackFeature(_feature: string, _props?: Record<string, unknown>): void {},
  trackMessageSent(_surface?: any, _metadata?: Record<string, unknown>): void {},
  endSession(): void {},
  flush(): Promise<void> {
    return Promise.resolve();
  }
};
