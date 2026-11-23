# Station audit

Run: 2026-11-23T03:38:16.011Z · directory: 53484 stations · servers listed: de1.api.radio-browser.info

**Raw** = stations whose tags map to the sub-genre. **Working** = directory says its last check passed. **Playable** = working + https + domain name (not an IP) + MP3/AAC/HLS, de-duplicated by stream URL. **Verified** = of the top 30 playable (by votes and recent clicks), how many actually returned audio bytes from this Mac.

| Category | Sub-genre | Raw | Working | Playable | Verified / probed | Median kbps | Codecs (verified) |
|---|---|--:|--:|--:|--:|--:|---|
| Sports | Soccer | 99 | 97 | 91 | 27 / 30 | 128 | MP3 14, AAC-LC/HE 9, HLS 4 |
| Sports | American football | 11 | 11 | 5 | 4 / 5 | 64 | AAC-LC/HE 2, MP3 2 |
| Sports | Basketball | 3 | 3 | 3 | 3 / 3 | 56 | MP3 1, HLS 1, AAC-LC/HE 1 |
| Sports | Baseball | 4 | 4 | 3 | 3 / 3 | 32 | MP3 1, AAC-LC/HE 1, HLS 1 |
| Sports | Hockey | 5 | 5 | 4 | 3 / 4 | 128 | MP3 3 |
| Sports | Cricket | 2 | 2 | 2 | 2 / 2 | 82 | HLS 2 |
| Sports | Motorsport | 11 | 11 | 10 | 9 / 10 | 66 | HLS 5, MP3 3, AAC-LC/HE 1 |
| Sports | Sports talk | 669 | 661 | 506 | 28 / 30 | 50 | AAC-LC/HE 14, MP3 9, HLS 5 |
| News | World | 94 | 94 | 63 | 28 / 30 | 128 | HLS 13, MP3 10, AAC-LC/HE 5 |
| News | U.S. | 331 | 330 | 226 | 30 / 30 | 63 | AAC-LC/HE 19, MP3 10, HLS 1 |
| News | Finance | 70 | 70 | 47 | 22 / 30 | 128 | HLS 10, MP3 7, AAC-LC/HE 5 |
| News | Politics | 164 | 161 | 100 | 29 / 30 | 128 | MP3 23, AAC-LC/HE 5, HLS 1 |
| News | Local | 53 | 52 | 40 | 28 / 30 | 97 | AAC-LC/HE 13, MP3 13, HLS 2 |
| Music | Pop | 6936 | 6914 | 4246 | 30 / 30 | 128 | MP3 22, AAC-LC/HE 6, HLS 2 |
| Music | Rock | 3644 | 3630 | 2271 | 29 / 30 | 128 | MP3 23, AAC-LC/HE 3, HLS 3 |
| Music | Hip-hop | 1094 | 1085 | 772 | 30 / 30 | 128 | MP3 20, AAC-LC/HE 10 |
| Music | Country | 779 | 778 | 477 | 29 / 30 | 128 | MP3 23, HLS 3, AAC-LC/HE 3 |
| Music | Jazz | 1232 | 1228 | 810 | 29 / 30 | 128 | MP3 25, AAC-LC/HE 3, HLS 1 |
| Music | Classical | 1288 | 1286 | 693 | 27 / 30 | 128 | MP3 21, AAC-LC/HE 4, HLS 2 |
| Music | Electronic | 3391 | 3373 | 2140 | 30 / 30 | 128 | MP3 24, AAC-LC/HE 5, HLS 1 |
| Music | Latin | 1035 | 1030 | 842 | 30 / 30 | 128 | MP3 20, AAC-LC/HE 10 |
| Music | Oldies | 2149 | 2140 | 1321 | 29 / 30 | 128 | MP3 23, AAC-LC/HE 5, HLS 1 |
| Talk | Public radio | 920 | 916 | 473 | 30 / 30 | 128 | MP3 23, HLS 5, AAC-LC/HE 2 |
| Talk | Comedy | 121 | 120 | 83 | 30 / 30 | 128 | MP3 28, HLS 1, AAC-LC/HE 1 |
| Talk | Culture | 502 | 500 | 354 | 30 / 30 | 128 | MP3 21, AAC-LC/HE 5, HLS 4 |
| Talk | Religion | 1844 | 1829 | 1257 | 30 / 30 | 128 | MP3 16, AAC-LC/HE 14 |
| Talk | Business talk | 22 | 22 | 18 | 18 / 18 | 128 | MP3 13, AAC-LC/HE 4, HLS 1 |

## Why stations were dropped (summed across sub-genres)

ok 16877, http-only 9304, codec-OGG 135, not-working 121, codec-UNKNOWN 13, bare-ip 13, codec-FLV 7, codec-FLAC 3

Safari auto-upgrade test: 54 of 100 http-only streams (top 5 per sub-genre) answered with audio when switched to https.

## Probe failures by sub-genre

| Sub-genre | Failures |
|---|---|
| Soccer | not audio 3 |
| American football | Response does not match the HTTP/1.1 protocol (Missing expected CR after respons 1 |
| Basketball | — |
| Baseball | — |
| Hockey | Response does not match the HTTP/1.1 protocol (Missing expected CR after respons 1 |
| Cricket | — |
| Motorsport | Response does not match the HTTP/1.1 protocol (Missing expected CR after respons 1 |
| Sports talk | UND_ERR_SOCKET 1, not audio 1 |
| World | not audio 2 |
| U.S. | — |
| Finance | timeout 7, not audio 1 |
| Politics | not audio 1 |
| Local | HTTP 404 1, redirects to http 1 |
| Pop | — |
| Rock | Response does not match the HTTP/1.1 protocol (Missing expected CR after respons 1 |
| Hip-hop | — |
| Country | Response does not match the HTTP/1.1 protocol (Missing expected CR after respons 1 |
| Jazz | CERT_HAS_EXPIRED 1 |
| Classical | Response does not match the HTTP/1.1 protocol (Missing expected CR after respons 2, redirects to http 1 |
| Electronic | — |
| Latin | — |
| Oldies | redirects to http 1 |
| Public radio | — |
| Comedy | — |
| Culture | — |
| Religion | — |
| Business talk | — |

## Soccer by language (all playable soccer stations probed)

| Language | Playable | Verified | Examples |
|---|--:|--:|---|
| German | 48 | 43 | Fußball-Bundesliga: Konferenz; Fußball-Bundesliga 2: Konferenz; Fußball-Bundesliga: Spiel 1; Fußball-Bundesliga: Spiel 3 |
| Portuguese | 12 | 12 | TSF Rádio Notícias; Rádio Gaúcha 93.7 FM; Rádio Bandeirantes 90.9 FM; Rádio Bandeirantes 85.7 FM |
| Unknown | 8 | 7 | 970 Universal; radio Caravana 750 am Guayaquil; radio pitusas; deportes rcn |
| Spanish | 5 | 5 | RPP Mundial (Perú); Radio RPP Mundial; RPP Mundial (Check 25/11/2022); Estelar Fm |
| Brazilian portuguese | 5 | 5 | Sintonia Esportiva; Rádio Hospício Tricolor; Rádio HT; NBC FM - Rádio Comunitária de Nova Brasília - Imbituba/SC |
| English (US) | 2 | 2 | La Jefa 99.3; WHBE ESPN Louisville |
| Swahili | 1 | 1 | East Africa Radio FM |
| Amharic | 1 | 1 | Amharic Live Sport የኳስ  ኮሜኔታተር |
| Italian | 1 | 1 | Radio Sei |
| Slovenian | 1 | 1 | Toti Radio |
| Norwegian | 1 | 1 | Radio 3 Bodø |
| English (UK) | 1 | 1 | Time Football Academy |
| English (other) | 1 | 1 | Iraklis Radio |
| Español - latinoamerica | 1 | 1 | la super estación latina 104.1 armenia |
| Português  brasil | 1 | 1 | Rádio Inconfidência 880 AM |
| Español uruguay | 1 | 1 | Sport 890 |
| Português (brasil) | 1 | 1 | Rádio Estádio |

## Directory CORS

```json
[
  {
    "host": "de1.api.radio-browser.info",
    "getAllowOrigin": "*",
    "preflightStatus": 204,
    "preflightAllowOrigin": "*"
  }
]
```

Streams that sent an Access-Control-Allow-Origin header (needed only if we ever analyse audio levels): 575 of 617 verified probes.
