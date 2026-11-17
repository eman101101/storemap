/**
 * Local (in-browser) product-photo background removal — no server, no ML.
 * Flood-fills from the image borders, removing pixels close to the sampled
 * background colors (product photography is almost always shot on a plain
 * white/studio backdrop), then crops to the remaining subject.
 */
export async function removeBackground(src: string): Promise<Blob | null> {
  const img = await loadImage(src);
  const MAX = 1024; // process at a sane size; uploads are compressed anyway
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // sample the four corner patches as background reference colors
  const samples: [number, number, number][] = [];
  const patch = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  const corners: [number, number][] = [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]];
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + patch; y += 2) {
      for (let x = cx; x < cx + patch; x += 2) {
        const i = (y * w + x) * 4;
        samples.push([px[i], px[i + 1], px[i + 2]]);
      }
    }
  }
  // overall background guess = the average of the two most similar corner means
  const mean = (arr: [number, number, number][]) =>
    arr.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((v) => v / arr.length);
  const bg = mean(samples) as [number, number, number];
  const TOL = 38; // per-channel distance — plain studio backdrops sit well inside this
  const near = (i: number) =>
    Math.abs(px[i] - bg[0]) < TOL && Math.abs(px[i + 1] - bg[1]) < TOL && Math.abs(px[i + 2] - bg[2]) < TOL;

  // flood fill from every border pixel that matches the background
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, x + (h - 1) * w);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    if (p < 0 || p >= w * h || visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!near(i)) continue;
    px[i + 3] = 0; // transparent
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  // crop to the subject's bounding box (small pad), else keep full frame
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  let out = canvas;
  if (maxX >= 0) {
    const pad = Math.round(Math.min(w, h) * 0.02);
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);
    ctx.putImageData(data, 0, 0);
    const cw = maxX - minX + 1;
    const chh = maxY - minY + 1;
    const cropped = document.createElement('canvas');
    cropped.width = cw;
    cropped.height = chh;
    cropped.getContext('2d')!.drawImage(canvas, minX, minY, cw, chh, 0, 0, cw, chh);
    out = cropped;
  }

  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image'));
    img.src = src;
  });
}
