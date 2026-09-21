/** Catalog loading + custom garment ingestion. */

const imageCache = new Map();

export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

export async function loadCatalog(url = 'assets/catalog.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
  const { items } = await res.json();
  return items;
}

/**
 * Turn a user-supplied transparent PNG/WebP/SVG into a catalog item.
 * We trim transparent borders and assume the proportions of a typical flat-lay
 * T-shirt; the Fit sliders let the user fine-tune from there.
 */
export async function garmentFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const MAX = 1000;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const probe = document.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0, w, h);
    const { data } = pctx.getImageData(0, 0, w, h);

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error('The image looks fully transparent.');

    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d').drawImage(probe, minX, minY, cw, ch, 0, 0, cw, ch);

    const dataUrl = out.toDataURL('image/png');
    return {
      id: `custom-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Custom',
      category: 'Custom',
      swatch: '#7c5cff',
      src: dataUrl,
      size: [cw, ch],
      // proportions measured from the built-in tee (see tools/generate_shirts.py)
      anchors: { sl: [cw * 0.217, ch * 0.139], sr: [cw * 0.783, ch * 0.139], hipY: ch * 0.79 },
      custom: true,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
