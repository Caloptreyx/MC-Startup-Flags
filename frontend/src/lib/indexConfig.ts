let configuredEggs: string[] = [];

export function setConfiguredEggs(eggs: unknown): void {
  if (Array.isArray(eggs)) {
    configuredEggs = eggs.filter((item): item is string => typeof item === 'string');
  } else {
    configuredEggs = [];
  }
}

export function getConfiguredEggs(): string[] {
  return configuredEggs;
}
