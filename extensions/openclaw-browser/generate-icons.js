/**
 * Generates PNG icons for the OpenClaw browser extension.
 * Run: node generate-icons.js
 * Requires: npm install canvas
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 128];

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size;

  // Background
  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#6c63ff');
  grad.addColorStop(1, '#a78bfa');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, s, s, s * 0.18);
  ctx.fill();

  // Draw layered hexagon / stack icon
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.lineJoin = 'round';

  const cx = s / 2;
  const pad = s * 0.14;
  const w = s - pad * 2;
  const row = w * 0.32;

  // Top layer
  drawRow(ctx, cx, pad + row * 0.1, w * 0.7, row * 0.38);
  // Middle layer
  drawRow(ctx, cx, pad + row * 0.85, w * 0.85, row * 0.38);
  // Bottom layer
  drawRow(ctx, cx, pad + row * 1.6, w, row * 0.38);

  return canvas.toBuffer('image/png');
}

function drawRow(ctx, cx, y, w, h) {
  const x = cx - w / 2;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

sizes.forEach((size) => {
  const buf = drawIcon(size);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated: ${outPath}`);
});

console.log('Done.');
