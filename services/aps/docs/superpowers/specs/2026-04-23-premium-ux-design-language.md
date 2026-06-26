# Premium UX — Design Language & Gantt Flagship

**Date:** 2026-04-23
**Branch:** `codex/premium-ux-foundation`
**Scope:** Design system foundation + one flagship surface (Gantt cockpit). Other surfaces are follow-up specs that *apply* the system.

## Problem

The current UI reads as a generic "AI admin dashboard": crammed topbar (brand + 7 nav + 4 badges + 2 pills + avatar), 10–13px type, pill-and-dot everywhere, and four near-duplicate hero variants (`product-hero`, `integration-console-hero`, `workspace-hero`, `login-intro`). `styles.css` is ~1900 lines of surface-specific CSS with no shared vocabulary. "Broken and ugly" — the user's words — is accurate. A planner has to stare at this 8 hours a day.

## Direction (locked with user)

| # | Decision | Value |
|---|---|---|
| 1 | Aesthetic | Nordic industrial / Linear-adjacent, light + dark mode |
| 2 | Brand accent | Deep cobalt `#1D4ED8` (light) / `#3B82F6` (dark) |
| 3 | Typography | Geist + Geist Mono, tabular-nums, self-hosted |
| 4 | Density | Contextual — `calm` on Home/Data/Admin/Settings/Login; `dense` on Scheduling/Gantt/Scenarios |

Dark mode is the **default on cockpit surfaces** (Scheduling, Gantt). User theme toggle (sun/moon/system) overrides for the rest.

## Section 1 — Design tokens

### Color — light mode

```
--canvas          #F8F9FA   warm off-white
--surface         #FFFFFF
--surface-subtle  #F1F2F4
--surface-sunken  #EEF0F2
--border-subtle   #EBEDF0
--border          #D4D7DC
--border-strong   #B4B8C0
--text            #0A0E17
--text-muted      #3B424D
--text-dim        #6B7280
--brand           #1D4ED8
--brand-hover     #1E40AF
--brand-soft      #DBEAFE
```

### Color — dark mode

```
--canvas          #0B0D10   warm-black, never pure
--surface         #14171C
--surface-subtle  #1A1E24
--surface-sunken  #0F1215
--border-subtle   #1F242B
--border          #2A3038
--border-strong   #3B424D
--text            #F2F3F0
--text-muted      #B4BAC3
--text-dim        #6B7280
--brand           #3B82F6
--brand-hover     #60A5FA
--brand-soft      rgba(59,130,246,0.10)
```

### Semantic signals (both modes, tuned per mode)

`ok` green, `warn` amber, `crit` red, `info` cyan, `frozen` neutral-500. Brand cobalt is **never** substituted for these.

### Typography

- Geist (400, 500, 600) for body + display; Geist Mono for IDs / timestamps / durations.
- Weight 700 reserved for the `PA` logo mark only.
- Scale: `11 / 12 / 13 / 14 / 16 / 20 / 24 / 32 / 44` px — named `xs, sm, body, body-lg, h3, h2, h1, display`.
- `font-variant-numeric: tabular-nums` globally on numeric contexts (KPIs, tables, Gantt axis).
- Self-hosted via `@fontsource/geist-sans` and `@fontsource/geist-mono`. Fallback chain `Geist, "Inter Display", Inter, system-ui`.

### Spacing, radii, motion

- Spacing (4px base): `4, 8, 12, 16, 24, 32, 48, 64` → `--space-1 … --space-8`.
- Radii: `xs 4 / sm 6 / md 10 / lg 14 / xl 20`. Cards `md`, heroes `lg`, pills full.
- Shadow: minimal on light (`0 1px 2px rgba(10,14,23,.06)`), none on dark (borders carry hierarchy).
- Motion: one curve `cubic-bezier(0.2, 0.8, 0.2, 1)`; three durations `120 / 200 / 320 ms`. No springs, no bounces.

### Density tokens

```
[data-density="calm"]   --row-h: 44px  --space-page: 32px  --body: 14px
[data-density="dense"]  --row-h: 32px  --space-page: 20px  --body: 13px
```

Applied at `PageFrame` level, chosen by route.

## Section 2 — Component kit

New rule: **one pattern per job, no surface-specific variants.** Everything lives under `ui/src/design/`. No page may author its own visual identity.

### Primitives (6)

| Component | Replaces | Notes |
|---|---|---|
| `Button` | `.btn` family | variants `primary/secondary/ghost/danger`, sizes `sm/md/lg`, loading state |
| `Field` | raw inputs | wraps label + hint + error; 2px cobalt focus ring |
| `Badge` | `.pill` + `.chip` | variants `neutral/brand/ok/warn/crit/info/frozen` |
| `StatusDot` | `.dot` | pure 6px indicator |
| `Skeleton` | ad-hoc loaders | shimmer for lists/tables/heroes |
| `Icon` | emoji + glyphs | Lucide, stroke 1.5, sizes 14/16/20 |

### Composites (8)

`Panel`, `DataTable`, `KPI`, `Toolbar`, `SectionHeader`, `EmptyState`, `Flash`, `Tabs` (two variants: `segmented` and `underline`).

### Surfaces (3)

`Hero` (slots: eyebrow/title/description/actions/aside; `tone = "default" | "cockpit"`), `PageFrame`, `Dialog`/`Drawer`.

### Deleted after migration

`product-hero-*`, `integration-console-*` (hero/stats/nav/ambient/loader), `workspace-hero-*`, `login-intro`, `module-nav`, `data-explorer-nav`, duplicate `.flash.*`, `.chip` (merged into Badge), every `*-hero` variant. Target net CSS delta ≈ **−60%**.

### File layout

```
ui/src/design/
  tokens.css            # light/dark + density CSS custom props
  typography.css        # @fontsource imports, global rules
  primitives/
  composites/
  surfaces/
  theme.ts              # useTheme(), toggles, persistence
  index.ts              # barrel
```

## Section 3 — AppShell

Replaces the current one-row-that-wraps-to-two topbar.

### Structure

- **Row 1 (chrome, 56px):** logo, breadcrumb `Organization › Workspace`, right: global search (⌘K placeholder), theme toggle (sun/moon/system tri-state), avatar menu.
- **Row 2 (nav, 44px):** underline tabs, left-aligned. Hidden on `/login` and Home hub.
- **Status strip:** discreet footer right, dots only, colored only when degraded (`API • DB`).
- **Baseline/Candidate schedule context:** removed from topbar; moves to Scheduling/Gantt page toolbar.

### Route → density & tone

| Route | Density | Tone |
|---|---|---|
| `/`, `/login`, `/data/*`, `/admin`, `/settings`, `/system` | calm | default |
| `/scheduling`, `/gantt` | dense | cockpit (dark default) |
| `/scenarios`, `/integration/*` | dense | default |

Theme toggle persists to `localStorage`; cockpit routes force dark regardless of user pref unless the user explicitly chose light.

## Section 4 — Gantt cockpit flagship

### Layout

```
┌─ Header (40px) ────────────────────────────────────────────────┐
│ Gantt · Plan 2026-04-23 · 127 ops · 8 machines  [⟨ 7d ⟩] [⌕]   │
├────────┬──────────────────────────────────────┬────────────────┤
│ Lanes  │  Gantt viewport (flex-1)             │  Inspector      │
│ 220px  │                                      │  (Drawer 320px) │
├────────┴──────────────────────────────────────┴────────────────┤
│ KPI footer: Makespan · Late · Utilization · Late-risk           │
└─────────────────────────────────────────────────────────────────┘
```

### Visual rules

- Dark cockpit by default (`--canvas: #0B0D10`); bars are the only color on screen.
- **Bar body color = priority group** (4 tones: neutral / brand / warn / crit).
- **Bar border = state** (solid firm, dashed review, hatched frozen).
- **Bar overlay = signal** (late/critical pulse on the left edge, not full outline).
- Lane head: machine name + short code (mono) + 2px utilization micro-bar; sticky on horizontal scroll.
- Time axis: two-tier (day label + 4h hour ticks); weekend 3% canvas darken; sticky top.
- Now-line: 1px cobalt, faint glow, `NOW` label at top only.
- Inspector is a `Drawer` with tabs: *Operation · Slot candidates · What-if* (replaces the current stacked-section inspector).
- Footer KPIs: 4 `KPI` tiles (Makespan, Late Orders, Avg Utilization, Late-Risk), with delta vs. baseline inline.

### Interactions

- Click bar → select + open drawer.
- Hover bar → small tooltip (WO code + duration); no transform/shadow pop (too much on a dense grid).
- Pan horizontal via trackpad; wheel zooms time; `[`/`]` jumps ±1 day; `F` fits horizon; `↑↓←→` navigates bars.

### Motion

Single mount reveal: lanes slide in from left (40ms stagger, cap 4), bars fade in (80ms stagger, cap 20). After mount: zero motion except micro-hover. Animating bars are unusable.

## Section 5 — Migration plan

Four phases on `codex/premium-ux-foundation`, each committed separately. Other surfaces (Scheduling outer, Scenarios, Integration, Data, Admin, Settings, System) are out of scope for this spec — each gets its own follow-up spec that applies the kit.

### Phase 1 — Tokens + typography

- Create `ui/src/design/tokens.css`, `typography.css`, `theme.ts`.
- Self-host Geist via `@fontsource/*`.
- Add theme toggle + localStorage persistence.
- Add `data-density` attribute at root; route-driven override.
- `styles.css` stays; new tokens reference existing values so nothing breaks.

### Phase 2 — Component kit

- Build all 6 primitives + 8 composites + 3 surfaces.
- Add a dev-only `/design/preview` route as a visual test harness.
- No page migrations yet.

### Phase 3 — AppShell + Home + Login

- New `AppShell` + `PageFrame` + `Hero`.
- Migrate Home (`CompanyHubPage`) and Login to the new system.
- Delete the superseded CSS: `product-hero-*`, `workspace-hero-*`, `login-intro-*`.

### Phase 4 — Gantt flagship

- Rebuild `GanttBoard.tsx` + `OperationInspector.tsx` + surrounding toolbar on the new system.
- Dark cockpit enforced; KPI footer; drawer inspector; keyboard nav.

### Testing strategy

- Manual visual review per phase; no Chromatic/Percy this round.
- Every component has a demo in `/design/preview`.
- Keyboard nav + focus rings verified on Gantt specifically.
- API / integration layer untouched — pure view-layer refactor.

### Risk & rollback

- Theme persistence is localStorage only; no server-side user pref this round.
- Geist FOUT fallback chain: `Geist, "Inter Display", Inter, system-ui`.
- Each phase is a standalone commit; revert any phase independently.
- Phase 3 only cuts over Home + Login; Phase 4 only cuts over Gantt. No other surface breaks.

## Out of scope

- Server-side user theme preference.
- Visual regression tooling.
- Migrating Scheduling outer, Scenarios, Integration, Data, Admin, Settings, System pages (each = follow-up spec).
- Re-architecting state / routing / API layer.
- i18n, a11y audit beyond focus rings + keyboard nav on the Gantt.
