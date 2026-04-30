export function newUuid(): string {
  return Bun.randomUUIDv7();
}
