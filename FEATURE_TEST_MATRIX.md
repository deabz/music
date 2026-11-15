# Feature verification matrix

Automated means the specified definitions, helpers or handlers have unit tests; it
does not imply end-to-end Discord coverage. Real means executed locally using real
modules without a Discord login. All actual Discord interactions/voice remain manual.

| Slash command | Automated coverage | Real smoke here | Needs live Discord |
| --- | --- | --- | --- |
| /help | Definition, help/category rendering | 30 definitions validate | Yes |
| /ping | Definition, wrapper | Schema only | Yes |
| /uptime | Definition, wrapper | Schema only | Yes |
| /stats | Definition, embed | Schema only | Yes |
| /join | Definition, connection/recovery methods | UDP hint and gateway HTTPS only | Yes |
| /247 | Definition, configured startup join | Schema only | Yes |
| /play | Definition, permissions, queue/start paths | Search and eight pipeline samples pass | Yes |
| /search | Definition, menu/ownership/selection | Five real search results | Yes |
| /pause | Definition, playback/panel methods | Schema only | Yes |
| /resume | Definition, playback/panel methods | Schema only | Yes |
| /forward | Definition, parsing/seek/rollback | Offset-60 audio samples pass | Yes |
| /skip | Definition, shared skip/races/prefetch | Schema only | Yes |
| /stop | Definition, cancellation/no resurrection | Schema only | Yes |
| /leave | Definition, disconnect cleanup | Schema only | Yes |
| /queue | Definition, titles/budgets/pagination | Schema only | Yes |
| /shuffle | Definition, queue/panel actions | Schema only | Yes |
| /remove | Definition, queue manipulation | Schema only | Yes |
| /move | Definition, queue manipulation | Schema only | Yes |
| /clear | Definition, queue manipulation | Schema only | Yes |
| /nowplaying | Definition, serialized panel move | Schema only | Yes |
| /volume | Definition, gain/base volume | Schema only | Yes |
| /volup | Definition, volume adjustment | Schema only | Yes |
| /voldown | Definition, volume adjustment | Schema only | Yes |
| /loop | Definition, off/track/queue methods | Schema only | Yes |
| /bassboost | Definition, defer/rollback/filter | 15-second sample passes | Yes |
| /eightd | Definition, defer/rollback/filter | 15-second sample passes | Yes |
| /nightcore | Definition, defer/rollback/filter/rate | 15-second sample passes | Yes |
| /echo | Definition, defer/rollback/filter | 15-second sample passes | Yes |
| /lyrics | Definition, lookup/modal/pagination | Exact/free-text found; nonsense not found | Yes |
| /set-notification-channel | Definition, permissions/persistence | Schema only | Yes |

| Panel control / flow | Automated coverage | Real smoke here | Needs live Discord |
| --- | --- | --- | --- |
| Play | State/dispatch | No interaction | Yes |
| Previous | History/seek/races | Seek pipeline sampled | Yes |
| Pause | State/dispatch | No interaction | Yes |
| Next | Acknowledgement/double-click/shared skip | No interaction | Yes |
| Loop | State/cycle/dispatch | No interaction | Yes |
| Volume down | Dispatch/base volume/fade gain | No interaction | Yes |
| Rewind | Dispatch/seek/rollback | Offset pipeline sampled | Yes |
| Favourite | Toggle/privacy/limit/store | No interaction | Yes |
| Forward | Dispatch/seek/rollback | Offset pipeline sampled | Yes |
| Volume up | Dispatch/base volume/fade gain | No interaction | Yes |
| Lyrics mic | Playing/idle/modal/privacy | Lyrics service exercised | Yes |
| Shuffle | Dispatch/minimum queue | No interaction | Yes |
| Stop | Dispatch/cancellation | No interaction | Yes |
| Effects menu | Exact selected set/defer/one restart | All-effects pipeline sampled | Yes |
| My favourites / selection | Store/ownership/selection | No interaction | Yes |
| Suggestions dropdown | Shared ranking/keys/limits/stale choices | Prior cookie-free Mix diagnostic succeeds | Yes |
| Repost / old buttons | Send-save-delete order/debounce/failure/races | No messages sent | Yes |
| Long titles | Unicode/escaping/cap/budget/queue pages | Payloads only | Appearance |
| Lyrics pages/popup | Owner/cooldown/expiry/not-found/instrumental | Three real lookups, no lyric text printed | Yes |
| Two-account permissions | Voice and admin checks/ownership | Mocked only | Yes |
| Transitions | Curves/off/pause/seek/volume/timer cleanup | Audio samples have no audible voice transport | Listening |
| Autoplay v2 | Identity/50-memory/Mix/search/scoring/variety/stale cancellation | Prior 25-entry Mix samples pass | Theme quality |
| Early end / 403 / short stream | Classification/two resumes/rollback/queue preservation | Intentional sample cancellation only | Recovery |
| Startup/restore/shutdown | Save ordering/voice recovery/panel reattach/cleanup | Selftest only, no bot startup | Yes |
| Spotify | Pagination/token refresh/matching/timeout | Not called | Credentials + Discord |
| Supabase | Mocked snapshots/strict failures/deletion | Not called | Credentials + host |
| JSON storage | Atomic writes/corruption/load failures | Temp round-trip passes | Host persistence |
| Read-only cookies | Real temp source on Windows; Linux filesystem mock | Actual protected cookies never read | Linux Secret File |
| Linux/Windows children | Group kill/taskkill/delayed exit mocks | Windows owned smoke children: zero survivors | Linux build |
| Proxy | Shared options/redaction mocks | No real proxy configured | Host/proxy |
| Command registration | Names/descriptions/options/choices/order/types | 30 definitions, zero offline rejections | Discord API acceptance |
| HTTP public pages/APIs | Route/schema/auth/assets tests | 200; unknown 404 | Render routing |
| Dashboard APIs | Auth/disabled/rate-limit/input tests | 503 disabled, 401 unauthenticated, 200 authorized/action | Real bot state |
| Diagnostics | Failure/timeout/disabled/once/redaction/UDP mocks | Tools/YouTube/gateway/DNS pass outside sandbox | Render network |
| Docker/Render | Configuration/LF/exclusion checks | Docker unavailable | Build/deploy/512 MB load |

Per-case audio timing, routes and standalone output are in RENDER_VERIFICATION.md.
Follow LIVE_TEST_CHECKLIST.md for the remaining interaction and listening checks.
