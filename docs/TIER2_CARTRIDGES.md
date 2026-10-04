# Tier 2 cartridges (complexity level N+1): concepts

Tier 1 is the 8 launch cartridges: arcade games of about 900–2,000 lines with one core verb
each. Tier 2 cartridges are **genre games built from several interlocking systems**: data-driven
content, menus, stats, AI, persistence. A Tier 2 remix asks a model to merge *systems*, not just
mechanics. For example: a monster-collecting RPG × a tactics game means capture + party + type chart, fused with
grid tactics + permadeath + terrain.

They run on the same console (320×240, D-pad + A/B/START/SELECT, synth, save memory), so any
Tier 2 cartridge can also be remixed with any Tier 1 cartridge. Snake × Farming is a fair test too.

Target size: **3,000–8,000 lines each**. Remixing two Tier 2 games means roughly 15k lines of
input and a large, coherent output, which is the long-context stress test.

---

## 1. TACTICS (grid tactics RPG)

**Core loop:** turn-based grid combat. Player phase: move each unit, then attack, use an item or
wait. Then the enemy phase.

**Systems**
- Units with class, level, XP, HP, STR/MAG/SKL/SPD/DEF/RES, weapon ranks, and a 5-slot inventory.
- A rock-paper-scissors advantage cycle between three original weapon families, plus magic and bows. Weapons lose durability.
- Combat forecast (damage, hit %, crit %, double attacks) and a short battle animation.
- Terrain: forest gives defense and avoid, mountains cost more to move through, forts heal.
  Fog of war on some maps.
- Movement-range and attack-range flood fill, highlighted on the grid.
- Enemy AI profiles: aggressive, hold position, guard boss, target healers, retreat when low.
- Permadeath, recruitable enemies via a "talk" command, and support conversations between units.
- Win conditions per map: rout, seize, survive N turns, defend, escape.

**Content:** about 20 chapters on tile maps, 12 recruitable units, 8 classes with promotions,
and short story scenes in text boxes.

**Remix hooks:** the grid plus turn phases, unit stats and the combat formula, permadeath stakes.
**Estimated size:** 5,000–7,000 lines.

---

## 2. MONSTER QUEST (monster-collecting RPG)

**Core loop:** explore an overworld, get random or visible encounters, fight turn-based
1v1 battles, catch monsters, grow a party, beat regional masters.

**Systems**
- About 40 species with 2 evolution stages, a type chart (8–10 types), base stats, and move pools.
- Moves have power, accuracy, PP and type, plus status effects (burn, sleep, paralysis, poison)
  and stat stages.
- Battle menu (attack, items, swap, flee). Damage formula with a same-type bonus, type multipliers and
  crits, and a turn order decided by speed.
- Catching works by HP and status; a small active party plus a storage roster.
- Overworld: tile maps, NPCs with dialogue, trainers with line-of-sight challenges, items,
  shops, and a healing center.
- Procedural pixel-art sprites for each species (generated from a seed so they stay consistent).
- Save and load of the full game state.

**Content:** 8 regional masters plus a final rival (about 20 "levels"), 6–8 routes or towns, and a few
side quests.

**Remix hooks:** capture/collect, type advantage, the party, the overworld-to-battle transition.
**Estimated size:** 6,000–8,000 lines (most of it is data).

---

## 3. BRAWLERS (platform fighter)

**Core loop:** a platform fighter. Damage % rises with each hit, and so does knockback. You win
by knocking opponents off the stage.

**Systems**
- Fighter physics: ground and air states, double jump, fast-fall, ledge grab, shield and dodge,
  hitstun, and directional influence.
- Move sets for each fighter: jab, tilts, smashes (charged), aerials, specials (B plus a
  direction), and an up-special recovery move.
- Hitboxes and hurtboxes on animation frames, hit lag, and screen shake on strong hits.
- 6 fighters with distinct archetypes (rushdown, zoner, heavy, glass cannon, trickster, grappler).
- CPU AI with difficulty levels: spacing, edge-guarding and recovery logic.
- Stages with platforms, hazards and moving parts. Items such as bat, bomb and heart.

**Content:** a ladder of about 20 matches (1v1, 1v2, giant opponent, armored
opponent, team battle, a boss), plus an unlockable fighter.

**Remix hooks:** the percent-based knockback, real-time physics combat, fighter archetypes.
**Estimated size:** 4,000–6,000 lines.

**Console note:** this one benefits most from 2-player. It stays single-player vs CPU to keep
to the Tier 1 rule.

---

## 4. FIELD & FURROW (farming sim)

**Core loop:** a day/night calendar. Till, plant, water and harvest. Sell the crops, upgrade
tools, and build relationships.

**Systems**
- A time-of-day clock, an energy (stamina) meter, and 4 seasons of 28 days, each with its own crops.
- Tile-based farm: soil states (untilled, tilled, watered), crop growth stages, and
  sprinklers. Crops wither in the wrong season.
- An inventory hotbar with tools (hoe, can, axe, pickaxe, scythe) and tool upgrade tiers.
- Shops, shipping bin and prices. Animals (chickens, cows) that need feeding and give products.
- A town with about 6 villagers, each with a schedule, gift preferences and heart levels.
- Festivals as special days. Weather (rain waters the crops).
- Foraging, fishing (a timing mini-game) and a small mine with floors.
- Saving at the end of each day.

**Content:** "levels" become goals: a year-long list of about 20 milestone objectives that
unlock new areas (greenhouse, mine floors, bridge repair).

**Remix hooks:** the time/energy economy, growth over time, relationships, a cozy tone. These
are very different from the Tier 1 games, which makes it a great stress test.
**Estimated size:** 5,000–7,000 lines.

---

## What Tier 2 may need from the console

Probably nothing new: these can all be built on the v1 API. Worth considering:
- **Text boxes:** a built-in `api.dialog()` helper so dialogue-heavy games aren't 300 lines of
  text layout. Risk: it makes cartridges less self-contained.
- **More save space:** structured saves of a few KB to 100 KB are fine with `api.storage`.
- **Multi-file cartridges:** a cartridge could be a folder (`data.js`, `battle.js`, …). This
  would test models on real codebase structure, not one long file, which is a natural bridge
  toward the Level 2 (3D, N64-style) cartridges.
- **Longer boot test:** the smoke test should script menu navigation (for example, hold A
  through the dialogue) so it reaches gameplay.
