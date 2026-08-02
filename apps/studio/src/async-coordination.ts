export interface LatestCommitLease {
  isCurrent(): boolean;
}

export interface LatestCommitGate {
  begin(): LatestCommitLease;
  invalidate(): void;
}

export function createLatestCommitGate(): LatestCommitGate {
  let epoch = 0;

  return {
    begin() {
      const leaseEpoch = ++epoch;
      return {
        isCurrent: () => leaseEpoch === epoch,
      };
    },
    invalidate() {
      epoch += 1;
    },
  };
}

export interface ExclusiveActionLease {
  release(): boolean;
}

export interface ExclusiveActionGate {
  isActive(): boolean;
  tryStart(): ExclusiveActionLease | undefined;
}

export function createExclusiveActionGate(): ExclusiveActionGate {
  let activeRelease: (() => boolean) | undefined;

  return {
    isActive: () => activeRelease !== undefined,
    tryStart() {
      if (activeRelease) return undefined;
      const release = () => {
        if (activeRelease !== release) return false;
        activeRelease = undefined;
        return true;
      };
      activeRelease = release;
      return { release };
    },
  };
}
