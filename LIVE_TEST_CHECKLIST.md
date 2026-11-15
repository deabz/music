# Live Discord / Render checklist

Run with only one bot instance. These items remain manual; passing unit/smoke tests
does not establish live Discord delivery, voice connectivity or host capacity.

1. [Server admin] Invite with application commands and required text/voice permissions; confirm all 30 commands register.
2. [Text channel] `/help` all/categories, `/ping`, `/uptime`, `/stats`: readable results and correct counts.
3. [Voice] `/join` connects; configured `/247` joins the intended channel; inspect voice-ready diagnostics.
4. [Voice] `/play` search and direct YouTube URL start one track; confirmation is public and panel is unique.
5. [Voice, Spotify credentials] `/play` Spotify track, album and playlist; verify matching, order and duration refusal.
6. [Voice] `/play` a YouTube playlist; verify order, queue cap and overlong/unknown-duration refusals.
7. [Voice] `/search` opens choices; only the invoker selects; added title is full; no duplicate starts.
8. [Voice] `/pause`, `/resume`, panel Pause and Play: immediate acknowledgement, correct state and position.
9. [Voice] `/forward` default/seconds/m:ss and invalid input; panel Rewind/Forward; position and gain remain correct.
10. [Voice, history] Panel Previous restarts after five seconds and otherwise returns to the previous song.
11. [Voice] `/skip` and panel Next; rapid clicks politely refuse overlapping restarts and do not skip two songs.
12. [Voice] `/volume`, `/volup`, `/voldown`, panel volume buttons; check zero and maximum during fades.
13. [Voice] `/bassboost`, `/eightd`, `/nightcore`, `/echo` at 20 seconds, while paused and near the end; enable before playback too.
14. [Voice] Panel Effects opens privately; select exactly two, all, then none; one restart and accurate result/flags.
15. [Voice, failure fixture] Failed effect/seek restores previous filters/position; double failure preserves the queue.
16. [Voice] `/loop` off/track/queue and panel Loop; track repeats stay in place, queue wrap preserves order.
17. [Queue] `/queue` multiple pages with long/Unicode/escaped titles; invoker-only buttons and expiry cleanup.
18. [Queue] `/shuffle`, panel Shuffle, `/remove`, `/move`, `/clear`; no missing/duplicated waiting entries.
19. [Text/voice] `/nowplaying` moves the panel; chat between songs and verify send-new/delete-old repost after 1.5 seconds.
20. [Voice] Natural transitions fade; manual skip cuts; pause freezes a fade; change volume mid-fade; test mode off.
21. [Voice, time] Let autoplay run ten songs for rap, pop and a non-English seed; inspect repeats, artist streaks and theme drift.
22. [Voice] Suggestions dropdown excludes current/queued/recent songs; selecting queues as you; stale choices fail safely.
23. [Voice, two users] Panel Favourite, My favourites and saved-song selection; private ownership, toggles, limit and persistence.
24. [Playing/idle, two users] `/lyrics`, explicit song, idle popup, panel mic, pagination/expiry, instrumental and not-found results.
25. [Two accounts, roles] Outside-voice listener and outside-voice admin cannot mutate playback; read-only controls work; temporary menus reject another user.
26. [Admin] `/set-notification-channel`; test text/voice permission removal and restored access; refusal details never expose credentials.
27. [Voice] `/stop`, panel Stop, `/leave`, empty-channel pause/leave: queued lookups cancel and cannot restart later.
28. [Render, restart] Restart mid-song/paused; saved queue, effects policy, volume, panel IDs and position restore; test voice drop/recovery and early-end resumes.
29. [Render logs] Inspect diagnostics, YouTube 403 handling, UDP hint, memory under load, and confirm no secret values/paths in logs.
