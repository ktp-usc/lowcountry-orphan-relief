import { createPrivateKey, sign } from "node:crypto";
import { isRecord, requestJson, SheetReadError } from "./errors.js";

const tokenUrl = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/spreadsheets";

/** OAuth service-account JWT flow. No delegated user, Drive scope, or write scope. */
export function createTokenProvider(request: typeof fetch) {
  let cached: { json: string; expiresAt: number; token: Promise<string> } | undefined;
  return async (json: string): Promise<string> => {
    if (!json.trim()) throw new SheetReadError("Set GOOGLE_SERVICE_ACCOUNT_JSON to the service-account JSON.");
    if (cached?.json === json && cached.expiresAt > Date.now() + 60_000) return cached.token;
    let credentials: unknown;
    try { credentials = JSON.parse(json); } catch { throw new SheetReadError("GOOGLE_SERVICE_ACCOUNT_JSON must contain valid JSON."); }
    if (!isRecord(credentials) || credentials.type !== "service_account"
      || typeof credentials.client_email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(credentials.client_email)
      || typeof credentials.private_key !== "string"
      || (credentials.token_uri !== undefined && credentials.token_uri !== tokenUrl)) {
      throw new SheetReadError("GOOGLE_SERVICE_ACCOUNT_JSON must contain a service account with client_email and private_key and Google's token URI.");
    }
    const now = Math.floor(Date.now() / 1_000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: credentials.client_email, scope, aud: tokenUrl, iat: now, exp: now + 3_600,
    })}`;
    let assertion: string;
    try {
      const key = createPrivateKey(credentials.private_key);
      if (key.asymmetricKeyType !== "rsa") throw new Error("Unsupported key type");
      assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
    } catch {
      throw new SheetReadError("GOOGLE_SERVICE_ACCOUNT_JSON contains an unusable RSA private_key.");
    }
    const entry = { json, expiresAt: Date.now() + 3_600_000, token: Promise.resolve("") };
    entry.token = (async () => {
      const body = await requestJson(request, tokenUrl, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      }, "Google authentication");
      if (!isRecord(body) || typeof body.access_token !== "string" || !body.access_token || /\s/.test(body.access_token)
        || body.token_type !== "Bearer" || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
        throw new SheetReadError("Google authentication: invalid access-token response.");
      }
      entry.expiresAt = Date.now() + Math.min(body.expires_in, 3_600) * 1_000;
      return body.access_token;
    })();
    cached = entry;
    try { return await entry.token; } catch (error) {
      if (cached === entry) cached = undefined;
      throw error;
    }
  };
}
