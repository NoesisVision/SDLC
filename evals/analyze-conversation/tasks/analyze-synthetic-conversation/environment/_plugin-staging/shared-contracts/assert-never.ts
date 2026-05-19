export function assertNever(value: never): never {
  throw new Error(`unreachable variant: ${JSON.stringify(value)}`);
}
