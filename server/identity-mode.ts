export type IdentityMode = "shared" | "openwork" | "demo";

export function resolveIdentityMode(
  value: string = process.env.IDENTITY_MODE ?? "shared",
): IdentityMode {
  if (value !== "shared" && value !== "openwork" && value !== "demo")
    throw new Error(
      "IDENTITY_MODE must be shared or openwork (demo is test-only)",
    );
  return value;
}
