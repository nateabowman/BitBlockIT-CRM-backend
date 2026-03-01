/**
 * Vercel serverless entry. Re-exports the handler from the Nest build output
 * so Vercel finds a clear default export.
 */
const path = require('path');
const fromCwd = path.join(process.cwd(), 'dist', 'src', 'main');
const fromDir = path.join(__dirname, '..', 'dist', 'src', 'main');
let handler;
try {
  handler = require(fromCwd).default;
} catch (e) {
  handler = require(fromDir).default;
}
module.exports = handler;
