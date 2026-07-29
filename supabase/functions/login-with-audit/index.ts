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

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const payload = await request.json().catch(() => ({})) as { email?: string; password?: string };
  const email = payload.email?.trim().toLowerCase() ?? "";
  if (!email || !payload.password) return Response.json({ message: "Email and password are required" }, { status: 400 });

  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: payload.password }),
  });
  const authBody = await authResponse.json().catch(() => ({})) as Record<string, unknown>;
  const user = authBody.user as { id?: string } | undefined;

  const auditResponse = await fetch(`${SUPABASE_URL}/rest/v1/personal_center_login_events`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      user_id: user?.id ?? null,
      email,
      ip_address: clientIp(request),
      user_agent: request.headers.get("user-agent"),
      outcome: authResponse.ok ? "success" : "failure",
      failure_reason: authResponse.ok ? null : String(authBody.message ?? authBody.error_description ?? "Authentication failed").slice(0, 500),
    }),
  });

  if (!auditResponse.ok) {
    return Response.json({ message: "Unable to record the login event" }, { status: 503 });
  }

  return Response.json(authBody, { status: authResponse.status });
});
