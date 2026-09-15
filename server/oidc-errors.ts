const stages = [
  "configuration",
  "discovery",
  "registration-read",
  "registration-create",
  "registration-write",
  "registration-binding",
  "authorization-start",
  "callback-parameters",
  "state-decrypt",
  "browser-binding",
  "upstream-authorization",
  "token-exchange",
  "id-token-response",
  "jwks",
  "id-token-verification",
  "nonce-validation",
  "subject-validation",
  "userinfo",
  "userinfo-subject",
  "missing-org-claim",
  "org-claim-validation",
  "profile-claims",
  "downstream-code",
  "callback-complete",
] as const;
export type SignInStage = (typeof stages)[number];
const codes = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "invalid_scope",
  "invalid_token",
  "unauthorized_client",
  "unsupported_grant_type",
  "access_denied",
  "login_required",
  "consent_required",
  "server_error",
  "temporarily_unavailable",
]);
const descriptions = new Set([
  "invalid code verifier",
  "invalid authorization code",
  "authorization code expired",
  "authorization code already used",
  "code has expired",
  "invalid redirect uri",
  "invalid client credentials",
  "invalid grant",
  "invalid nonce",
]);
export type CallbackContext = {
  cookiePresent: boolean;
  stateMatch: boolean;
  cookieMatch?: boolean;
  clientIdUsed?: string;
  redirectUriUsed?: string;
  redirectUriMatches: boolean;
};
export function callbackFields(
  context?: CallbackContext,
): Partial<CallbackContext> {
  if (!context) return {};
  const fingerprint = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  return {
    cookiePresent: context.cookiePresent === true,
    stateMatch: context.stateMatch === true,
    redirectUriMatches: context.redirectUriMatches === true,
    ...(context.cookiePresent === true &&
    typeof context.cookieMatch === "boolean"
      ? { cookieMatch: context.cookieMatch }
      : {}),
    ...(fingerprint(context.clientIdUsed)
      ? { clientIdUsed: context.clientIdUsed }
      : {}),
    ...(fingerprint(context.redirectUriUsed)
      ? { redirectUriUsed: context.redirectUriUsed }
      : {}),
  };
}
export type SignInDiagnostic = Partial<CallbackContext> & {
  stage: SignInStage;
  error: string;
  error_description: string;
  status?: number;
};
export class SignInError extends Error {
  readonly diagnostic: SignInDiagnostic;
  constructor(
    stage: SignInStage,
    code?: unknown,
    description?: unknown,
    status?: number,
  ) {
    super("Sign-in failed");
    const normalized =
      typeof description === "string" && description.length <= 256
        ? description.trim().toLowerCase()
        : "";
    this.diagnostic = {
      stage,
      error: typeof code === "string" && codes.has(code) ? code : "redacted",
      error_description:
        descriptions.has(normalized) &&
        typeof description === "string" &&
        !/[\r\n]/.test(description)
          ? normalized
          : "redacted",
      ...(Number.isInteger(status) &&
      status !== undefined &&
      status >= 100 &&
      status <= 599
        ? { status }
        : {}),
    };
  }
}
export function diagnosticFor(
  error: unknown,
  fallback: SignInStage,
): SignInDiagnostic {
  if (!(error instanceof SignInError))
    return new SignInError(fallback).diagnostic;
  const data = error.diagnostic;
  return new SignInError(
    stages.includes(data.stage) ? data.stage : fallback,
    data.error,
    data.error_description,
    data.status,
  ).diagnostic;
}
export async function signInStep<T>(
  stage: SignInStage,
  work: () => T | Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SignInError) throw error;
    throw new SignInError(stage);
  }
}
