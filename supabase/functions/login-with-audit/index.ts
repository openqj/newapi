import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? null;
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isRateLimited(email: string, ipAddress: string | null) {
  const ip = ipAddress ?? "unknown";
  const keyHashes = await Promise.all([
    sha256(`ip:${ip}`),
    sha256(`email-ip:${email}:${ip}`),
  ]);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/relayhub_consume_login_rate_limit`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_key_hashes: keyHashes }),
  });
  if (!response.ok) throw new Error("Unable to apply the login rate limit");
  return !(await response.json() as boolean);
}

async function recordLoginEvent(event: {
  userId?: string;
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
  outcome: "success" | "failure";
  failureReason?: string;
}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/personal_center_login_events`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      user_id: event.userId ?? null,
      email: event.email,
      ip_address: event.ipAddress,
      user_agent: event.userAgent,
      outcome: event.outcome,
      failure_reason: event.failureReason ?? null,
    }),
  });
  if (!response.ok) throw new Error("Unable to record the login event");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const payload = await request.json().catch(() => ({})) as { email?: string; password?: string };
  const email = payload.email?.trim().toLowerCase() ?? "";
  if (!email || !payload.password) return Response.json({ message: "Email and password are required" }, { status: 400 });
  const ipAddress = clientIp(request);
  try {
    if (await isRateLimited(email, ipAddress)) {
      await recordLoginEvent({
        email,
        ipAddress,
        userAgent: request.headers.get("user-agent"),
        outcome: "failure",
        failureReason: "Rate limit exceeded",
      });
      return Response.json({ message: "Too many login attempts. Please try again later." }, { status: 429 });
    }
  } catch {
    return Response.json({ message: "Unable to process the login request" }, { status: 503 });
  }

  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: payload.password }),
  });
  const authBody = await authResponse.json().catch(() => ({})) as Record<string, unknown>;
  const user = authBody.user as { id?: string } | undefined;

  try {
    await recordLoginEvent({
      userId: user?.id,
      email,
      ipAddress,
      userAgent: request.headers.get("user-agent"),
      outcome: authResponse.ok ? "success" : "failure",
      failureReason: authResponse.ok ? undefined : String(authBody.message ?? authBody.error_description ?? "Authentication failed").slice(0, 500),
    });
  } catch {
    return Response.json({ message: "Unable to record the login event" }, { status: 503 });
  }

  return Response.json(authBody, { status: authResponse.status });
});
