# Browser checks

The two suites in `tests/` run headless with stubs and cover the logic. These
drive the **real page in a real browser**, which is the only way to catch the
things the stubs cannot: WebGL texture handling, CSS layout, the art pack
actually decoding, and whether the room looks like a room.

They are not run by `node tests/*.js`. They need a browser and a server:

```sh
npm i playwright && npx playwright install chromium   # once, anywhere
python app.py                                         # in another terminal
node tests/browser/<file>.js
```

| file | what it checks | costs |
|---|---|---|
| `environments.js` | the generated-art fallback with the pack blocked, a phone viewport, and reduced motion | nothing |
| `routine.js` | the off-duty rotas: every activity, at its own spot | nothing |
| `work.js` | work happens at desks; the planner's rounds fire, cap and never interrupt its own work | nothing |
| `archive.js` | spine count matches the files on disk, the case opens the archive, the scribe files a report | nothing |
| `layout.js` | at seven window sizes (including wide-and-short ones): every control fully on screen, no dead bands, no page scroll | nothing |
| `deep-run.js` | a REAL deep run end to end: the countdown, deep handoffs, filing, the report chip | **real model quota, ~2-5 min** |

Only `deep-run.js` spends anything. The rest drive `GuildGame` directly and
never touch the pipeline.
