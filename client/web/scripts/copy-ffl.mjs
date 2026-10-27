// Copies the prebuilt FFL Emscripten module (from the pinned FFL.js dependency) into public/.
// The .cjs is renamed .js so every static server serves it with a JavaScript MIME type.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/ffl', { recursive: true });
copyFileSync('node_modules/ffl.js/ffl-emscripten.cjs', 'public/ffl/ffl-emscripten.js');
copyFileSync('node_modules/ffl.js/ffl-emscripten.wasm', 'public/ffl/ffl-emscripten.wasm');
console.log('copied FFL emscripten module');
