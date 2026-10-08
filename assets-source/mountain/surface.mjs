import { writeFileSync } from 'node:fs';
import {
  MOUNTAIN_GRID,
  MOUNTAIN_COLUMNS,
  MOUNTAIN_ROWS,
  MOUNTAIN_HEIGHTS,
} from '../../src/mountain-profile.js';
writeFileSync(
  new URL('./surface.json', import.meta.url),
  JSON.stringify({
    grid: MOUNTAIN_GRID,
    columns: MOUNTAIN_COLUMNS,
    rows: MOUNTAIN_ROWS,
    heights: MOUNTAIN_HEIGHTS,
  }),
);
