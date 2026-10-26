# Web app structure

The web app uses Next.js 16 App Router, React 19, TypeScript and Tailwind CSS 4.

## Styling

`app/globals.css` is the only stylesheet imported by a React entry point. It loads
the Tailwind theme and utilities, the notation library's stylesheet, and the app's
base and component layers in a fixed order. Navigation no longer determines CSS order.

`app/theme.css` maps the existing light/dark colors and fonts to Tailwind tokens:
`bg-paper`, `bg-panel`, `text-ink`, `text-muted`, `text-accent`, and the `hub-*`
colors. Prefer utility classes in JSX for new layouts and controls. Reusable music
widgets also compose Tailwind utilities with `@apply` in the component layer.
Those files use `@reference` to share the same theme when Next compiles them separately.

Custom CSS remains for gradients, keyframes, browser media controls, print output,
and the specialized notation and waveform widgets. Geometry driven by audio,
notes or pointer movement stays in runtime CSS variables, SVG or canvas.
Tailwind Preflight is deliberately omitted: the existing base reset preserves the
notation library and editor controls. Tailwind utilities still take precedence
over component styles. Reduced-motion rules continue to apply.

## Routing and state

`app/(hub)/layout.tsx` owns the shared `AppShell` for Explore, Home, Generate,
Library and individual song pages. Route groups keep their public URLs unchanged.
Next `Link` and `router.push` handle navigation within this group. The sidebar,
player, in-progress song jobs and local audio URLs persist between those pages.
Each protected view has a client presentation gate; private API handlers still
authorize every request independently.

The server root layout reads the encrypted HttpOnly session and passes only the
public user profile into one `SessionProvider`. Access tokens never enter that
profile or the Server Component payload. Popup sign-in, account permissions,
focus refreshes and sign-out update the shared session. Signing out unmounts the
private song store and stops the player.

Sign-in buttons start OAuth immediately through `lib/sign-in.ts`, without an
intermediate dialog. Standalone pages redirect in the same tab; the embedded
Hugging Face Space uses a popup. Both preserve the requested return page.

Main pages are Server Component entry points with route metadata. Dynamic route params
and Studio/Score query parameters are read through Next's asynchronous page
props. Interactive views live under `components/`; Web Audio editors keep their
client-only dynamic imports. Route `loading.tsx`, `error.tsx` and `not-found.tsx`
provide skeletons and recovery UI.

Studio and Score are intentional document-navigation boundaries. Their existing
`beforeunload` protections cover recordings, browser-only jobs and unsaved edits,
including Back navigation. Authentication, downloads, external links and new tabs
also retain ordinary document navigation.

## Manual review

After dependency or PostCSS changes, restart the local development server.
Review sign-in and sign-out, play a song while moving between hub pages, switch
Generate modes, submit both cover harmony choices, and reopen a saved Studio
project and Score. Compare desktop and mobile layouts and reduced-motion mode.
The migration was checked with CSS compilation, declaration comparison and a
production build; browser interaction is left for manual testing.
