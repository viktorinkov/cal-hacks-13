// Text on the 3D venue: canvas-drawn sprites that keep the same size on screen however far the camera is,
// for the floor's names, the incidents, the presenters' bands and the medic.

import * as THREE from 'three';

export type Line = { text: string; px: number; color: string; bold?: boolean };
export type Tag = {
  lines: Line[];
  /** A coloured word before the first line, like FALL or SOS. */
  pill?: { text: string; color: string };
  /** A rounded box behind the text; without it the text gets a soft shadow instead. */
  background?: string;
  border?: string;
};

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
/** Canvas pixels per CSS pixel, so the text stays sharp on retina screens. */
const RATIO = 2;
const PAD = 6;

/** Every tag sprite on the page, rescaled when the window changes size. */
const sized = new Set<THREE.Sprite>();
/** Sprite scale per CSS pixel of height, from the camera's field of view and the canvas height. */
let perPx = 0.001;

/** Rescales every tag so `px` CSS pixels on the canvas are `px` pixels on screen. */
export function fitTags(camera: THREE.PerspectiveCamera, heightPx: number) {
  perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, heightPx);
  for (const s of sized) scaleTag(s);
}

function scaleTag(s: THREE.Sprite) {
  const [w, h] = s.userData.px as [number, number];
  const k = (s.userData.zoom ?? 1) * perPx;
  s.scale.set(w * k, h * k, 1);
}

/** A tag that stands above its anchor point, drawn over the venue. */
export function tagSprite(tag: Tag, order = 10): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }));
  sprite.center.set(0.5, 0);
  sprite.renderOrder = order;
  drawTag(sprite, tag);
  sized.add(sprite);
  return sprite;
}

/** Shows the tag `zoom` times its size, for the incident in focus. */
export function zoomTag(sprite: THREE.Sprite, zoom: number) {
  if (sprite.userData.zoom === zoom) return;
  sprite.userData.zoom = zoom;
  scaleTag(sprite);
}

function font(l: Line) {
  return `${l.bold ? 600 : 400} ${l.px}px ${FONT}`;
}

/** Redraws the tag when its text changed. */
export function drawTag(sprite: THREE.Sprite, tag: Tag) {
  const key = JSON.stringify(tag);
  if (sprite.userData.key === key) return;
  sprite.userData.key = key;
  const g = document.createElement('canvas').getContext('2d')!;
  const pillPx = tag.lines[0]?.px ?? 12;
  const pillW = tag.pill ? (g.font = `700 ${Math.round(pillPx * 0.72)}px ${FONT}`, g.measureText(tag.pill.text).width + 12) : 0;
  const widths = tag.lines.map((l, i) => {
    g.font = font(l);
    return g.measureText(l.text).width + (i === 0 && tag.pill ? pillW + 6 : 0);
  });
  const pad = tag.background ? PAD + 2 : 3;
  const w = Math.ceil(Math.max(1, ...widths) + 2 * pad);
  const h = Math.ceil(tag.lines.reduce((s, l) => s + l.px * 1.3, 0) + 2 * (tag.background ? PAD : 3));
  const canvas = g.canvas;
  canvas.width = w * RATIO;
  canvas.height = h * RATIO;
  g.scale(RATIO, RATIO);
  if (tag.background) {
    g.fillStyle = tag.background;
    g.beginPath();
    g.roundRect(0.5, 0.5, w - 1, h - 1, 7);
    g.fill();
    if (tag.border) {
      g.strokeStyle = tag.border;
      g.lineWidth = 1.5;
      g.stroke();
    }
  } else {
    g.shadowColor = 'rgba(0, 0, 0, 0.85)';
    g.shadowBlur = 4;
  }
  let y = tag.background ? PAD : 3;
  tag.lines.forEach((l, i) => {
    let x = pad;
    const mid = y + (l.px * 1.3) / 2;
    if (i === 0 && tag.pill) {
      const ph = Math.round(pillPx * 1.1);
      g.fillStyle = tag.pill.color;
      g.beginPath();
      g.roundRect(x, mid - ph / 2, pillW, ph, ph / 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `700 ${Math.round(pillPx * 0.72)}px ${FONT}`;
      g.textBaseline = 'middle';
      g.fillText(tag.pill.text, x + 6, mid + 0.5);
      x += pillW + 6;
    }
    g.font = font(l);
    g.fillStyle = l.color;
    g.textBaseline = 'middle';
    g.fillText(l.text, x, mid + 0.5);
    y += l.px * 1.3;
  });
  // A canvas of a new size needs a new texture: WebGL keeps the old one's storage.
  const material = sprite.material;
  material.map?.dispose();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  material.map = texture;
  material.needsUpdate = true;
  sprite.userData.px = [w, h];
  scaleTag(sprite);
}

/** Frees a tag the page no longer shows. */
export function dropTag(sprite: THREE.Sprite) {
  sized.delete(sprite);
  sprite.material.map?.dispose();
  sprite.material.dispose();
  sprite.removeFromParent();
}
