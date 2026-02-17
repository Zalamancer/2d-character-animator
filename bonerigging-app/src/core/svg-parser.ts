import type { Vec2 } from '../types/math';
import type { ViewBox, ControlPoint, PathData, BBox, ParsedCharacter } from '../types/parsed';
import { V2 } from './math';

export class SVGParser {
  static parse(svgText: string): ParsedCharacter {
    const container = document.createElement('div');
    container.innerHTML = svgText.trim();
    const svgEl = container.querySelector('svg');
    if (!svgEl) throw new Error('No SVG element found');

    // Get viewBox
    const vb = svgEl.getAttribute('viewBox');
    let vbRect: ViewBox;
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number);
      vbRect = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    } else {
      const w = parseFloat(svgEl.getAttribute('width') || '') || 300;
      const h = parseFloat(svgEl.getAttribute('height') || '') || 300;
      vbRect = { x: 0, y: 0, w, h };
      svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    // Clone SVG into an offscreen container to use native methods
    const offscreen = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    offscreen.setAttribute('viewBox', `${vbRect.x} ${vbRect.y} ${vbRect.w} ${vbRect.h}`);
    offscreen.style.position = 'absolute';
    offscreen.style.left = '-9999px';
    offscreen.style.width = vbRect.w + 'px';
    offscreen.style.height = vbRect.h + 'px';
    document.body.appendChild(offscreen);

    const paths: PathData[] = [];
    const allControlPoints: ControlPoint[] = [];

    // Collect all shape elements
    const shapeEls = svgEl.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line');

    shapeEls.forEach((el: Element, idx: number) => {
      let pathEl: SVGPathElement | null;
      if (el.tagName === 'path') {
        pathEl = el.cloneNode(true) as SVGPathElement;
      } else {
        pathEl = SVGParser._convertToPath(el);
      }
      if (!pathEl) return;

      // Apply accumulated transforms
      const transform = SVGParser._getAccumulatedTransform(el);
      if (transform) pathEl.setAttribute('transform', transform);

      offscreen.appendChild(pathEl);

      try {
        const totalLen = pathEl.getTotalLength();
        if (totalLen < 1) return;

        const numSamples = Math.max(30, Math.ceil(totalLen / 3));
        const sampledPoints: Vec2[] = [];
        for (let i = 0; i <= numSamples; i++) {
          const pt = pathEl.getPointAtLength((i / numSamples) * totalLen);
          sampledPoints.push(V2(pt.x, pt.y));
        }

        // Parse d attribute for control points
        const d = pathEl.getAttribute('d') || '';
        const controlPoints = SVGParser._parsePathControlPoints(d);

        paths.push({
          index: idx,
          element: el as SVGElement,
          sampledPoints,
          controlPoints,
          totalLength: totalLen,
          d: d,
        });

        controlPoints.forEach((cp: ControlPoint) => allControlPoints.push(cp));
      } catch (e) {
        // Skip unparseable paths
      }
    });

    document.body.removeChild(offscreen);

    // Compute bounding box from all sampled points
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const path of paths) {
      for (const p of path.sampledPoints) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }

    const bbox: BBox = {
      minX, minY, maxX, maxY,
      w: maxX - minX,
      h: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };

    return {
      svgElement: svgEl,
      viewBox: vbRect,
      paths,
      allControlPoints,
      bbox,
    };
  }

  static _getAccumulatedTransform(el: Element): string | null {
    const transforms: string[] = [];
    let node: Element | null = el;
    while (node && node.tagName !== 'svg') {
      const t = node.getAttribute('transform');
      if (t) transforms.unshift(t);
      node = node.parentElement;
    }
    return transforms.length > 0 ? transforms.join(' ') : null;
  }

  static _convertToPath(el: Element): SVGPathElement | null {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const tag = el.tagName.toLowerCase();
    let d = '';

    if (tag === 'rect') {
      const x = parseFloat(el.getAttribute('x') || '') || 0;
      const y = parseFloat(el.getAttribute('y') || '') || 0;
      const w = parseFloat(el.getAttribute('width') || '') || 0;
      const h = parseFloat(el.getAttribute('height') || '') || 0;
      d = `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
    } else if (tag === 'circle') {
      const cx = parseFloat(el.getAttribute('cx') || '') || 0;
      const cy = parseFloat(el.getAttribute('cy') || '') || 0;
      const r = parseFloat(el.getAttribute('r') || '') || 0;
      const k = r * 0.5522847498;
      d = `M${cx - r},${cy} C${cx - r},${cy - k} ${cx - k},${cy - r} ${cx},${cy - r} C${cx + k},${cy - r} ${cx + r},${cy - k} ${cx + r},${cy} C${cx + r},${cy + k} ${cx + k},${cy + r} ${cx},${cy + r} C${cx - k},${cy + r} ${cx - r},${cy + k} ${cx - r},${cy} Z`;
    } else if (tag === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx') || '') || 0;
      const cy = parseFloat(el.getAttribute('cy') || '') || 0;
      const rx = parseFloat(el.getAttribute('rx') || '') || 0;
      const ry = parseFloat(el.getAttribute('ry') || '') || 0;
      const kx = rx * 0.5522847498, ky = ry * 0.5522847498;
      d = `M${cx - rx},${cy} C${cx - rx},${cy - ky} ${cx - kx},${cy - ry} ${cx},${cy - ry} C${cx + kx},${cy - ry} ${cx + rx},${cy - ky} ${cx + rx},${cy} C${cx + rx},${cy + ky} ${cx + kx},${cy + ry} ${cx},${cy + ry} C${cx - kx},${cy + ry} ${cx - rx},${cy + ky} ${cx - rx},${cy} Z`;
    } else if (tag === 'polygon' || tag === 'polyline') {
      const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      if (pts.length >= 4) {
        d = `M${pts[0]},${pts[1]}`;
        for (let i = 2; i < pts.length; i += 2) {
          d += ` L${pts[i]},${pts[i + 1]}`;
        }
        if (tag === 'polygon') d += ' Z';
      }
    } else if (tag === 'line') {
      const x1 = parseFloat(el.getAttribute('x1') || '') || 0;
      const y1 = parseFloat(el.getAttribute('y1') || '') || 0;
      const x2 = parseFloat(el.getAttribute('x2') || '') || 0;
      const y2 = parseFloat(el.getAttribute('y2') || '') || 0;
      d = `M${x1},${y1} L${x2},${y2}`;
    }

    if (!d) return null;
    path.setAttribute('d', d);
    return path;
  }

  static _parsePathControlPoints(d: string): ControlPoint[] {
    const points: ControlPoint[] = [];
    // Simple extraction: find all coordinate pairs in the d string
    // For deformation we need all anchor points and bezier control points
    const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];
    let cx = 0, cy = 0;
    let startX = 0, startY = 0;

    for (const cmd of commands) {
      const type = cmd[0];
      const nums = (cmd.slice(1).match(/-?[\d]*\.?\d+(?:e[+-]?\d+)?/gi) || []).map(Number);
      const isRel = type === type.toLowerCase();
      const T = type.toUpperCase();

      if (T === 'M') {
        for (let i = 0; i < nums.length; i += 2) {
          const x = isRel ? cx + nums[i] : nums[i];
          const y = isRel ? cy + nums[i + 1] : nums[i + 1];
          points.push({ point: V2(x, y), type: 'anchor' });
          cx = x; cy = y;
          if (i === 0) { startX = x; startY = y; }
        }
      } else if (T === 'L') {
        for (let i = 0; i < nums.length; i += 2) {
          const x = isRel ? cx + nums[i] : nums[i];
          const y = isRel ? cy + nums[i + 1] : nums[i + 1];
          points.push({ point: V2(x, y), type: 'anchor' });
          cx = x; cy = y;
        }
      } else if (T === 'H') {
        for (let i = 0; i < nums.length; i++) {
          cx = isRel ? cx + nums[i] : nums[i];
          points.push({ point: V2(cx, cy), type: 'anchor' });
        }
      } else if (T === 'V') {
        for (let i = 0; i < nums.length; i++) {
          cy = isRel ? cy + nums[i] : nums[i];
          points.push({ point: V2(cx, cy), type: 'anchor' });
        }
      } else if (T === 'C') {
        for (let i = 0; i < nums.length; i += 6) {
          const x1 = isRel ? cx + nums[i] : nums[i];
          const y1 = isRel ? cy + nums[i + 1] : nums[i + 1];
          const x2 = isRel ? cx + nums[i + 2] : nums[i + 2];
          const y2 = isRel ? cy + nums[i + 3] : nums[i + 3];
          const x = isRel ? cx + nums[i + 4] : nums[i + 4];
          const y = isRel ? cy + nums[i + 5] : nums[i + 5];
          points.push({ point: V2(x1, y1), type: 'control' });
          points.push({ point: V2(x2, y2), type: 'control' });
          points.push({ point: V2(x, y), type: 'anchor' });
          cx = x; cy = y;
        }
      } else if (T === 'S') {
        for (let i = 0; i < nums.length; i += 4) {
          const x2 = isRel ? cx + nums[i] : nums[i];
          const y2 = isRel ? cy + nums[i + 1] : nums[i + 1];
          const x = isRel ? cx + nums[i + 2] : nums[i + 2];
          const y = isRel ? cy + nums[i + 3] : nums[i + 3];
          points.push({ point: V2(x2, y2), type: 'control' });
          points.push({ point: V2(x, y), type: 'anchor' });
          cx = x; cy = y;
        }
      } else if (T === 'Q') {
        for (let i = 0; i < nums.length; i += 4) {
          const x1 = isRel ? cx + nums[i] : nums[i];
          const y1 = isRel ? cy + nums[i + 1] : nums[i + 1];
          const x = isRel ? cx + nums[i + 2] : nums[i + 2];
          const y = isRel ? cy + nums[i + 3] : nums[i + 3];
          points.push({ point: V2(x1, y1), type: 'control' });
          points.push({ point: V2(x, y), type: 'anchor' });
          cx = x; cy = y;
        }
      } else if (T === 'T') {
        for (let i = 0; i < nums.length; i += 2) {
          const x = isRel ? cx + nums[i] : nums[i];
          const y = isRel ? cy + nums[i + 1] : nums[i + 1];
          points.push({ point: V2(x, y), type: 'anchor' });
          cx = x; cy = y;
        }
      } else if (T === 'A') {
        for (let i = 0; i < nums.length; i += 7) {
          const x = isRel ? cx + nums[i + 5] : nums[i + 5];
          const y = isRel ? cy + nums[i + 6] : nums[i + 6];
          points.push({ point: V2(x, y), type: 'anchor' });
          cx = x; cy = y;
        }
      } else if (T === 'Z') {
        cx = startX; cy = startY;
      }
    }

    return points;
  }
}
