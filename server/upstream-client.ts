import { BlobNotFoundError, get, put } from "@vercel/blob";
import { createHash, hkdfSync, type KeyObject } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { SignInError, signInStep } from "./oidc-errors.ts";

const field = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value),
    );
export const authMethodSchema = z.enum([
  "none",
  "client_secret_post",
  "client_secret_basic",
]);
const registrationSchema = z.object({
  clientId: field(512),
  clientSecret: field(4096).optional(),
  authMethod: authMethodSchema,
  issuer: field(2048),
  redirectUri: field(2048),
});
export type UpstreamClient = z.infer<typeof registrationSchema>;
export interface RegistrationCache {
  read(path: string): Promise<string | null>;
  create(path: string, encrypted: string): Promise<void>;
}
export type ClientOptions = {
  env?: NodeJS.ProcessEnv;
  registrationCache?: RegistrationCache;
};
const LIMIT = 16384;
export function registrationPath(issuer: string, callback: string) {
  return `oauth/registrations/v1/${createHash("sha256")
    .update(JSON.stringify([issuer, callback]))
    .digest("hex")}.jwe`;
}
export function privateRegistrationCache(
  token: string,
  sdk: { get: typeof get; put: typeof put } = { get, put },
): RegistrationCache {
  function validPath(path: string) {
    if (!/^oauth\/registrations\/v1\/[0-9a-f]{64}\.jwe$/.test(path))
      throw new SignInError("registration-binding");
  }
  return {
    async read(path) {
      validPath(path);
      try {
        const result = await sdk.get(path, {
          access: "private",
          token,
          useCache: false,
          abortSignal: AbortSignal.timeout(10_000),
        });
        if (!result) return null;
        if (result.statusCode !== 200)
          throw new SignInError("registration-read");
        if (result.blob.size > LIMIT) {
          await result.stream.cancel();
          throw new SignInError("registration-read");
        }
        const reader = result.stream.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > LIMIT) {
              await reader.cancel();
              throw new SignInError("registration-read");
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        return Buffer.concat(chunks).toString("utf8");
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw new SignInError("registration-read");
      }
    },
    async create(path, encrypted) {
      validPath(path);
      if (Buffer.byteLength(encrypted) > LIMIT)
        throw new SignInError("registration-write");
      await sdk.put(path, encrypted, {
        token,
        access: "private",
        allowOverwrite: false,
        addRandomSuffix: false,
        contentType: "application/jose",
        cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(10_000),
      });
    },
  };
}
export function createClientResolver(
  issuer: string,
  callback: string,
  privateKey: KeyObject,
  options: ClientOptions = {},
) {
  const env = options.env ?? process.env;
  const path = registrationPath(issuer, callback);
  const key = new Uint8Array(
    hkdfSync(
      "sha256",
      privateKey.export({ type: "pkcs8", format: "der" }),
      Buffer.from(issuer),
      Buffer.from(`employee-home-upstream-registration-v1\0${callback}`),
      32,
    ),
  );
  function validated(value: unknown): UpstreamClient {
    const client = registrationSchema.parse(value);
    if (
      client.issuer !== issuer ||
      client.redirectUri !== callback ||
      (client.authMethod === "none"
        ? client.clientSecret !== undefined
        : client.clientSecret === undefined)
    )
      throw new SignInError("registration-binding");
    return client;
  }
  function configured(): UpstreamClient | undefined {
    if (env.UPSTREAM_CLIENT_ID === undefined) {
      if (
        [
          env.UPSTREAM_CLIENT_SECRET,
          env.UPSTREAM_CLIENT_ISSUER,
          env.UPSTREAM_CLIENT_REDIRECT_URI,
          env.UPSTREAM_CLIENT_AUTH_METHOD,
        ].some((value) => value !== undefined)
      )
        throw new SignInError("configuration");
      return undefined;
    }
    try {
      return validated({
        clientId: env.UPSTREAM_CLIENT_ID,
        clientSecret: env.UPSTREAM_CLIENT_SECRET,
        issuer: env.UPSTREAM_CLIENT_ISSUER,
        redirectUri: env.UPSTREAM_CLIENT_REDIRECT_URI,
        authMethod: env.UPSTREAM_CLIENT_AUTH_METHOD ?? "none",
      });
    } catch {
      throw new SignInError("configuration");
    }
  }
  async function decode(encrypted: string): Promise<UpstreamClient> {
    return signInStep("registration-binding", async () => {
      if (Buffer.byteLength(encrypted) > LIMIT)
        throw new SignInError("registration-binding");
      const { payload } = await jwtDecrypt(encrypted, key, {
        issuer,
        audience: callback,
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
        typ: "upstream-registration+jwt",
        requiredClaims: ["iat"],
      });
      if (payload.purpose !== "upstream-registration-v1")
        throw new SignInError("registration-binding");
      return validated(payload.client);
    });
  }
  async function resolve(
    allowCreate: boolean,
    register: () => Promise<UpstreamClient>,
  ): Promise<UpstreamClient> {
    const explicit = configured();
    if (explicit) return explicit;
    const cache =
      options.registrationCache ??
      (env.BLOB_READ_WRITE_TOKEN
        ? privateRegistrationCache(env.BLOB_READ_WRITE_TOKEN)
        : undefined);
    if (!cache) throw new SignInError("configuration");
    const existing = await signInStep("registration-read", () =>
      cache.read(path),
    );
    if (existing !== null) return decode(existing);
    if (!allowCreate) throw new SignInError("registration-read");
    const candidate = await signInStep("registration-create", async () =>
      validated(await register()),
    );
    const encrypted = await new EncryptJWT({
      purpose: "upstream-registration-v1",
      client: candidate,
    })
      .setProtectedHeader({
        alg: "dir",
        enc: "A256GCM",
        typ: "upstream-registration+jwt",
      })
      .setIssuer(issuer)
      .setAudience(callback)
      .setIssuedAt()
      .encrypt(key);
    try {
      await cache.create(path, encrypted);
    } catch {}
    const winner = await signInStep("registration-write", () =>
      cache.read(path),
    );
    if (winner === null) throw new SignInError("registration-write");
    return decode(winner);
  }
  return { resolve };
}
export function clientAuthentication(client: UpstreamClient): {
  headers: Record<string, string>;
  fields: Record<string, string>;
} {
  if (client.authMethod === "none")
    return { headers: {}, fields: { client_id: client.clientId } };
  if (!client.clientSecret) throw new SignInError("configuration");
  if (client.authMethod === "client_secret_post")
    return {
      headers: {},
      fields: {
        client_id: client.clientId,
        client_secret: client.clientSecret,
      },
    };
  const encode = (value: string) =>
    new URLSearchParams({ value }).toString().slice(6);
  return {
    headers: {
      Authorization: `Basic ${Buffer.from(`${encode(client.clientId)}:${encode(client.clientSecret)}`).toString("base64")}`,
    },
    fields: {},
  };
}
