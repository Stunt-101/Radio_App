# Audit findings (Nov 22, 2026)

Raw numbers: `audit/report.md`. Per-station probe results: `audit/results.json`. Re-run with `node tools/audit.mjs`.

## Verified on this Mac
- Radio Browser API accepts calls from a web page: `Access-Control-Allow-Origin: *`, preflight 204. Tested with real `fetch()` from https://example.com in a Chromium browser (server list, search, tags and click endpoints). Not yet tested in Safari, but CORS depends on the server's headers, so Safari should behave the same.
- The server list currently names only one server (de1). Shuffle and retry are built, but there is nothing to fail over to today.
- 608 of 650 probed streams (94%) returned real MP3, AAC or HLS audio.
- http-only stations are the biggest loss (9,920 sub-genre matches). When the http was changed to https, 54 of 98 sampled http-only streams played. The app should try that rewrite itself instead of relying on Safari's auto-upgrade, which is unverified.
- 566 of 608 working streams send CORS headers. Silence detection should still watch playback progress (stalls, time not advancing) rather than audio levels, because Safari mutes cross-origin audio routed through Web Audio.

## Thin spots
- **Finance (English):** about 7 real stations, almost all Bloomberg (Radio, 960 NY, Boston, 99.1, UK, Europe), plus CNBC Radio. The rest is foreign-language or noise. Needs a hand-picked list.
- **Live soccer in English:** the Soccer tag has almost none (1 UK, 2 US). English commentary stations are tagged only "sports", or even "news" in talkSPORT's case. So the language filter must cover Soccer plus General sports talk, with a hand-picked list on top: talkSPORT (https, playable), BBC 5 Live (http-only in the directory, and its commentary is likely geo-blocked outside the UK; unverified).
- **Italian:** 11 sports stations (Radio Sei, Radio Bianconera, Radio CRC). **French:** 14 (RMC). Thin but usable.
- **Strong:** Spanish 120, English US 90 (ESPN/Fox/CBS Sports affiliates), Portuguese 60, German 44 (including the ARD "Fußball-Bundesliga: Konferenz / Spiel N" live-match streams).
- **U.S. league sub-genres** (NFL, NBA, MLB, NHL): only 3–5 stations each by tag. Team networks are rare; local ESPN/Fox affiliates carry most of it. Online streams often replace live NFL/MLB play-by-play (unverified).
- **Cricket:** 2 (ABC Cricket, Sport Nation). **Basketball, Baseball:** 3 each.

## Mapping fixes to make in Step 2
- World: drop the `international` tag (pulls in music stations) and the name `deutsche welle` (matches "Neue Deutsche Welle", a music genre).
- Finance: drop generic names `money` and `business` from finance, or restrict them to news-tagged stations.
- Soccer: exclude stations tagged `party` or `hits` (e.g. "PartyHits ... Fussball Hits").
- Normalize language labels (portuguese / brazilian portuguese / português brasil → Portuguese, etc.).

## Not verified yet
- Anything in Safari or on iPhone. Shoutcast v1 servers ("ICY 200 OK", about 9 probes) fail in Node; Safari may or may not play them.
- Whether a stream carries actual sound rather than silence or an ad loop.
- Geo-blocking: all probes ran from a U.S. connection on this Mac.
