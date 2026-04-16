# Noesis Graph

MCP server with a React + Vite UI for visualizing the knowledge graph.

## Stack

- **Backend**: Bun, NestJS, MCP server (`server.ts`)
- **Frontend**: React 19, Vite, Mantine 7, React Flow (`@xyflow/react`)

## UI Design Guidelines

Take visual inspiration from [EventCatalog](https://www.eventcatalog.dev) — a clean, modern, enterprise-grade catalog UI.

### Visual Tone

- **Minimal and crisp**: generous whitespace, restrained color usage, neutral gray foundation.
- **Professional, not playful**: structured, information-dense but never cluttered.
- **Soft color accents**: pastel-tinted backgrounds for categorization; strong accent only for interactive elements.
- **Subtle depth**: `shadow-sm` as default, elevated shadows (`shadow-lg`) sparingly. Blur backdrop on fixed headers.

### Color Palette

- Use the Mantine theme defined in `ui/src/theme.ts` (noesisBlue, noesisIndigo, noesisGreen).
- **Surfaces**: white cards on `gray.0` page background (light mode); `dark.6` / `dark.7` in dark mode.
- **Borders**: `gray.2` (light), `dark.4` (dark) — thin and subtle.
- **Text hierarchy**: `gray.9` for headings, `gray.7` for body, `gray.5` for muted/secondary.
- **Graph nodes**: soft pastel washes per entity type (e.g. light pink for services, light blue for commands, light green for queries). Keep tints very light — the color should whisper, not shout.

### Typography

- Use `Raleway` (already in theme) for headings; system font stack for body text.
- **Weights**: `600` / `700` for headings, `500` for labels/badges, `400` for body.
- **Scale**: keep it tight — `sm` for metadata, `md` for body, `lg` for section headings. Avoid oversized text.

### Layout

- **Spacing rhythm**: stick to Mantine's 4px base scale. Prefer `gap="md"`, `p="lg"`, `py="xl"` for sections.
- **Container**: max-width `80rem` (1280px) for content areas.
- **Cards**: `radius="md"`, `shadow="sm"`, white background. On hover: `shadow-md` transition.
- **Badges / Pills**: `radius="xl"` (fully rounded), `size="sm"`, color-coded by entity type, `variant="light"`.

### Graph Visualization (React Flow)

- **Background**: dot grid pattern (subtle, not lines).
- **Nodes**: rounded rectangles with soft pastel background per type. Include an icon and label.
- **Edges**: gray strokes (`gray.5`). Highlight connected nodes/edges on hover.
- **Groups**: translucent tinted overlay with a visible header bar and soft border.
- **Minimap**: always present, theme-aware.
- **Interaction**: hover highlights connections; clean transitions (150ms ease-in-out).

### Dark Mode

- Support dark mode as first-class via Mantine's `ColorSchemeProvider`.
- All custom colors must define both light and dark variants.
- Graph node backgrounds flatten to a uniform dark surface in dark mode (`dark.5`).

### General Rules

- No decorative gradients or glowing effects unless serving a functional purpose.
- Animations: subtle and fast (150ms). No bouncing, no slow fades.
- Icons: use a consistent icon set (e.g. Tabler Icons via `@tabler/icons-react`, already compatible with Mantine).
- Every interactive element must have a visible hover/focus state.
