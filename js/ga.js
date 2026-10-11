window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
// Privacy: never send auth/upload tokens to Google Analytics.
// login.html uses ?token= (magic link), upload.html uses ?t= (upload token).
// We do NOT strip the real URL (app scripts need the token); we only tell
// GA to record the pathname, so the query string never leaves the browser.
gtag('config', 'G-DFGYQ0XKBV', { page_location: window.location.origin + window.location.pathname });
