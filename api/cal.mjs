import { calEmbed } from "./_lib.mjs";

/** The booking link, split for the cal.com embed: `{ origin, link }`. The demo
 * page asks for this on first interaction with the form and frames it in a
 * modal once the enquiry is accepted. It exists so that CAL_LINK stays the one
 * place the calendar is named: the emails, /api/call and the modal all read it.
 * Public information (it is the same link every welcome email carries), cached
 * hard at the edge because it changes about once a year. */
export async function GET() {
  const { origin, link } = calEmbed();
  return new Response(JSON.stringify({ origin, link }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
