import { callUrl, logEvent } from "./_lib.mjs";

/** The site and both emails link here, so the cal.com link can change in the
 * Vercel env without touching anything else. 302s with name/email prefilled. */
export async function GET(request) {
  const q = new URL(request.url).searchParams;
  await logEvent({ type: "call-click", email: q.get("email") ?? null });
  const dest = callUrl({ first: q.get("name"), email: q.get("email") });
  return new Response(null, { status: 302, headers: { location: dest } });
}
