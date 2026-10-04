# Contributing to DIGI-FUZE

Thanks for wanting to share something! A few things up front:

> **Submissions may never be reviewed or merged.** DIGI-FUZE is a hobby project. There is no
> guarantee of a response, a timeline, or that anything will be added. Please only submit if
> you're fine with that.

## Submit a remix

Made a remix you like? Use the **Submit** button in the app. It downloads your remix as a
single `.vgremix.json` file and opens the
[remix submission form](https://github.com/flomerboy/digi-fuze/issues/new?template=remix-submission.yml)
with most fields already filled in. Attach the downloaded file and send it.

The file holds the game's source, its stats (model, time, tokens, cost) and the model's
transcript. It does **not** contain your API key. Never paste your key into an issue.

## Submit a cartridge

Hand-made cartridges are the ingredients that models remix. Read
[docs/AUTHORING_CARTRIDGES.md](docs/AUTHORING_CARTRIDGES.md) and
[docs/CARTRIDGE_API.md](docs/CARTRIDGE_API.md), and make sure `npm run smoke` passes. Then either:

- fork the repo, add `cartridges/<id>/` on a branch, and open a pull request, or
- use the [cartridge submission form](https://github.com/flomerboy/digi-fuze/issues/new?template=cartridge-submission.yml)
  and link your branch or attach the files.

## Report a bug

Use the [bug report form](https://github.com/flomerboy/digi-fuze/issues/new?template=bug-report.yml).
Say which cartridge or part of the app, what happened, and your browser. Glitches inside an
AI-made remix are usually the model's work, not a bug in the app.

## Licensing

By submitting a remix, cartridge or pull request, you agree it may be included in this
repository under the repository's license (see the [LICENSE](LICENSE) file).

## Original work only

Keep it yours. No ripped sprites, music or sounds, and no trademarked names, characters or
art from existing games. Classic *mechanics* (snake, paddles, falling blocks) are fine;
copying a specific game's characters, branding or assets is not.
