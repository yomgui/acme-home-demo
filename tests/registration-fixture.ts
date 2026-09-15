import type { RegistrationCache } from "../server/upstream-client.ts";

export class MemoryRegistrationCache implements RegistrationCache {
  readonly entries = new Map<string, string>();
  reads = 0;
  creates = 0;
  failWrites = false;
  async read(path: string) {
    this.reads++;
    return this.entries.get(path) ?? null;
  }
  async create(path: string, encrypted: string) {
    this.creates++;
    if (this.failWrites || this.entries.has(path))
      throw new Error("Fixture create rejected");
    this.entries.set(path, encrypted);
  }
}
