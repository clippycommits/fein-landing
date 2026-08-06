# Launch checklist — fein.vc

## 1. DNS cutover (blocks everything — needs Namecheap login)

As of 2026-08-06, fein.vc does **not** serve the site: the apex uses Namecheap's
URL-redirect to `www.fein.vc`, and `www` is a CNAME to `parkingpage.namecheap.com`
(a parking page). HTTPS on the apex times out. GitHub Pages is configured and built
(`CNAME` = fein.vc) — only DNS is wrong.

In Namecheap → Domain List → fein.vc → **Advanced DNS**:

1. **Delete** the "URL Redirect Record" on `@` and the CNAME on `www` pointing at
   `parkingpage.namecheap.com`.
2. **Add** four A records on host `@`:
   - `185.199.108.153`
   - `185.199.109.153`
   - `185.199.110.153`
   - `185.199.111.153`
3. **Add** CNAME on host `www` → `clippycommits.github.io.`
4. Leave the existing **MX (smtp.google.com)** and **TXT (google-site-verification)**
   records untouched — mail keeps working.

Then, once DNS propagates (minutes to ~1h):

5. GitHub → clippycommits/fein-site → Settings → Pages: confirm the fein.vc custom
   domain shows a green check, wait for the certificate, then tick **Enforce HTTPS**.
   (Or: `gh api -X PUT repos/clippycommits/fein-site/pages --field https_enforced=true`)

Verify: `curl -I https://fein.vc/` returns `200` with `server: GitHub.com`.

## 2. Lead delivery activation (one click, in team@commixcapital.com inbox)

The contact-sales flow posts leads to FormSubmit (formsubmit.co) addressed to
team@commixcapital.com (base64-encoded in `index.html` to keep it off scrapers).
A test submission has been sent to trigger FormSubmit's **activation email** —
open the inbox, click **Activate**, and every future lead arrives as an email
with a table of the answers. Until activation, submissions are not forwarded.

Optional hardening afterwards: FormSubmit's dashboard gives a random alias string
for the address — swap it into `ENDPOINT` in `index.html` (see the
`atob("…")` line) so the raw address never appears in page source, and consider
pointing it at hello@fein.vc instead.

## 3. Nice-to-haves (not blocking)

- Analytics: the page has no tracker. GoatCounter or Plausible are the
  restrained options; add the script tag before `</body>`.
- `hello@fein.vc` is advertised in the footer, JSON-LD, and the flow's
  fallback mailto — confirm the mailbox actually exists in Google Workspace.
