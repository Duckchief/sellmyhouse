# Spec: Remove Cover Photo Indicator from Seller Photos Page

**Date:** 2026-03-24
**Status:** Approved

## Problem

The seller photos page displayed a "Cover" badge on the first photo and a hint "The first photo will be the cover image." This implied sellers should decide which photo is the cover — but cover selection is a marketing decision best left to the agent.

## Decision

Remove the cover indicator from the seller view. Keep drag-to-reorder so sellers can still sequence their photos. Replace the cover hint with a neutral drag hint.

## Changes

Single file: `src/views/partials/seller/photo-grid.njk`

1. **Remove** the `{% if loop.first %}` block containing the yellow "Cover" badge.
2. **Replace** the `{% if photos.length > 1 %}` hint block text from `"The first photo will be the cover image."` to `"Drag to reorder your photos."` (wrapped in `| t` filter).

## Out of Scope

- No backend changes
- No data model changes
- The system continues to treat photo order (first = cover) internally for the agent portal — this is not changed
- Drag-to-reorder (SortableJS) remains in place
