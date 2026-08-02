---
title: "Public website design references"
description: "The transferable interface principles used for Topo's public website without copying another product's identity."
public: false
order: 110
updated: 2026-08-02
---

# Public website design references

This record makes the public site's visual direction readable to maintainers and agents. It documents structural influence, not permission to copy source code, trademarks, assets, or brand identity.

## Reference principles

The current website draws from two public interface references:

- [v0](https://v0.app) for its compact utility navigation, centered product question, primary work surface, restrained neutral hierarchy, and direct action language.
- [shadcn/ui](https://ui.shadcn.com) for its composable bordered surfaces, small-radius controls, documentation hierarchy, quiet typography, and open-code framing.

Topo retains its own product signature: the connected application atlas is the central work surface, contour geometry is used only inside graph representations, and teal indicates graph evidence rather than acting as a general brand wash.

## Visual contract

| Role             | Decision                                                     |
| ---------------- | ------------------------------------------------------------ |
| Typeface         | Geist Variable with a system monospace utility face          |
| Canvas           | White with zinc-neutral surfaces and borders                 |
| Primary action   | Near-black filled button                                     |
| Product evidence | Teal, used sparingly for current graph state and connections |
| Findings         | Orange, reserved for diagnostic attention                    |
| Radius           | 6–14px based on control and surface scale                    |
| Shadow           | Low-contrast elevation only on primary product work surfaces |

## Layout contract

- Navigation stays compact and task-oriented.
- The homepage hero is centered around the product thesis and a working atlas preview.
- Documentation uses persistent navigation, bounded reading width, and canonical Markdown.
- Demo and pricing surfaces use the same primitive vocabulary as the homepage.
- The Demo destination embeds the production Studio artifact; it never introduces a visually similar second implementation that can drift from the product.
- Mobile preserves information order; the atlas can scroll internally without widening the document.

## Motion contract

- Page content enters through one depth-based reveal system with short sibling staggering.
- Graph edges may move slowly to communicate current, connected application state.
- The primary atlas receives one light sweep after entering the viewport; it does not loop.
- Cards use small elevation changes only when a pointer deliberately explores them.
- Continuous ambient effects are limited to graph connections. There is no autoplay video, scroll hijacking, or decorative parallax.
- `prefers-reduced-motion` removes staged reveals, sweeps, and moving graph edges.

## Non-goals

- Do not recreate v0 or shadcn branding, logos, page copy, or exact compositions.
- Do not make shadcn/ui a required runtime dependency; Topo owns its components and CSS.
- Do not remove Topo's graph, evidence, LLM, or local-first identity in favor of a generic SaaS shell.
