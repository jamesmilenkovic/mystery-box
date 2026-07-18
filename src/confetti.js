// Hand-rolled canvas confetti burst — no library, per the stack rule of
// zero npm runtime dependencies. Not unit-tested (pure canvas/rAF visual
// effect); verified manually.

const COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9f1c'];

/**
 * Bursts confetti from roughly the center of `canvas` and fades it out
 * over ~1.6s. Sizes the canvas to fill its parent each call.
 *
 * @param {HTMLCanvasElement} canvas
 */
export function burstConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const originX = width / 2;
  const originY = height * 0.35;
  const particleCount = 120;
  const gravity = 900; // px/s^2
  const durationMs = 1600;

  const particles = Array.from({ length: particleCount }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 220 + Math.random() * 420;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 250,
      size: 6 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 10,
    };
  });

  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, width, height);

    const t = elapsed / 1000;
    const fade = Math.max(0, 1 - elapsed / durationMs);

    for (const p of particles) {
      const px = p.x + p.vx * t;
      const py = p.y + p.vy * t + 0.5 * gravity * t * t;
      const rotation = p.rotation + p.spin * t;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(px, py);
      ctx.rotate(rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }

    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
  }

  requestAnimationFrame(frame);
}
