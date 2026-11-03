// Cloudflare Web Analytics beacon injection for concept pages.
//
// Concept pages are static per-slug HTML files with no shared template, so
// the beacon is injected here at the Pages edge instead of editing every
// concept file. This middleware only runs for /concepts/* requests.
// Reversible: delete this file and concept pages stop sending beacon data.
//
// The token is the public Web Analytics site token for freightfolio.net
// (it is visible in the HTML of every page that carries the beacon).

const WA_SNIPPET =
  "<!-- Cloudflare Web Analytics -->" +
  "<script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' " +
  "data-cf-beacon='{\"token\": \"5701c2d563e94ead9607d04db61609ea\"}'></script>" +
  "<!-- End Cloudflare Web Analytics -->";

export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (response.status !== 200 || !contentType.includes("text/html")) {
    return response;
  }
  return new HTMLRewriter()
    .on("body", {
      element(element) {
        element.append(WA_SNIPPET, { html: true });
      },
    })
    .transform(response);
}
