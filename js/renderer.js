/**
 * renderer.js - Bubble Diagram SVG Renderer
 *
 * Converts CMOS network structures into SVG bubble diagrams.
 *
 * Design goals:
 * - Preserve actual CMOS topology (series vs parallel structure)
 * - Visually match classroom bubble-diagram conventions
 * - Maintain consistent mapping between PMOS and NMOS dual networks
 *
 * Rendering model:
 * - TRANSISTOR → individual bubble
 * - SERIES     → vertical stacking (AND behavior)
 * - PARALLEL   → horizontal branching (OR behavior)
 * - Explicit groups → enclosed colored ovals for visual correspondence
 *
 * Notes:
 * - PMOS and NMOS are rendered as dual structures with matching group colors
 * - Outer rings represent full pull-up / pull-down networks
 * - Inner ovals highlight meaningful sub-networks only
 */

// ─── Layout constants ─────────────────────────────────────────────────────────
const R_BUB     = 22;    // transistor bubble radius
const PAR_GAP   = 12;    // horizontal gap between parallel children
const SER_GAP   = 24;    // vertical gap between series children
const OV_PAD_X  = 16;    // oval horizontal padding
const OV_PAD_Y  = 14;    // oval vertical padding
const RING_PAD  = 30;    // outer PMOS/NMOS ring padding
const LABEL_W   = 80;    // left margin for PMOS/NMOS labels
const RIGHT_PAD = 120;   // right margin for Y (output) label
const V_PAD     = 52;    // top/bottom SVG padding
const VGAP_NET  = 40;    // pmos bottom ring → output node
const VGAP_OUT  = 40;    // output node → nmos top ring
const VDD_H     = 32;
const GND_H     = 42;
const OUT_R     = 7;
const WIRE_W    = 2;
const BUS_W     = 2.5;

// ─── Colors ───────────────────────────────────────────────────────────────────
const C_BUBBLE    = '#4b6380';
const C_BUB_STK   = '#182533';
const C_WARN      = '#ea580c';
const C_WARN_STK  = '#7c2d12';
const C_WIRE      = '#2d3542';
const C_VDD       = '#2d3542';
const C_GND       = '#2d3542';
const C_OUT       = '#2d3542';
const C_WHITE     = '#ffffff';
const C_PMOS_RING = '#fff000';   // gold
const C_NMOS_RING = '#c80815';   // red
const FONT        = 'IBM Plex Mono, monospace';

// Group oval colors: index 0=blue, 1=green, 2=amber, 3=purple, 4=pink, 5=teal
const GROUP_COLS = ['#3b82f6','#22c55e','#f59e0b','#a855f7','#ec4899','#14b8a6'];

// ─── Color index assignment ───────────────────────────────────────────────────
/**
 * Assign a colorIdx to every non-TRANSISTOR node that is a direct child
 * of the top-level network node.  Deeper nodes get a derived index.
 *
 * Rule: child i of the top level → colorIdx = i
 *       child j of colorIdx=i   → colorIdx = i*10 + j
 *
 * PMOS and NMOS are structural duals — child i of PMOS corresponds to child i
 * of NMOS — so they receive the same colorIdx and thus the same oval color.
 */
// Assigns consistent color IDs across PMOS/NMOS dual networks
// so equivalent logical groups are visually linked in the diagram
function assignColorIdx(net, next = { value: 0 }, isRoot = false) {
  if (net.type === 'TRANSISTOR') return;

  const shouldColorThisGroup =
    net.explicitGroup === true && !isRoot;

  if (shouldColorThisGroup) {
    net.colorIdx = next.value++;
  } else {
    delete net.colorIdx;
  }

  if (net.children) {
    net.children.forEach(c => assignColorIdx(c, next, false));
  }
}

function assignBothNetworks(nmos, pmos) {
  clearColorIdx(nmos);
  clearColorIdx(pmos);

  assignColorIdx(nmos, { value: 0 }, true);
  assignColorIdx(pmos, { value: 0 }, true);
}

function clearColorIdx(net) {
  delete net.colorIdx;
  if (net.children) net.children.forEach(clearColorIdx);
}

function groupColor(net) {
  if (net.colorIdx === undefined) return GROUP_COLS[0];
  return GROUP_COLS[net.colorIdx % GROUP_COLS.length];
}

// ─── BBox computation ─────────────────────────────────────────────────────────
/**
 * Computes layout bounding box for a network node.
 *
 * This drives all positioning in the renderer:
 * - Determines spacing for series/parallel composition
 * - Expands dimensions when group ovals are applied
 *
 * For a node WITH colorIdx (gets an oval wrapper):
 *   bbox = inner content bbox + OV_PAD on all sides
 *
 * For a node WITHOUT colorIdx (top-level series/parallel, no extra oval):
 *   bbox = raw stacked/side-by-side children
 *
 * TRANSISTOR: 2R × 2R
 */
function bboxOf(net) {
  if (net.type === 'TRANSISTOR') return { w: R_BUB * 2, h: R_BUB * 2 };

  const kids = net.children.map(bboxOf);
  const hasOval = net.colorIdx !== undefined;

  let innerW, innerH;

  if (net.type === 'PARALLEL') {
    innerW = kids.reduce((s, b) => s + b.w, 0) + PAR_GAP * (net.children.length - 1);
    innerH = Math.max(...kids.map(b => b.h));
  } else { // SERIES
    innerW = Math.max(...kids.map(b => b.w));
    innerH = kids.reduce((s, b) => s + b.h, 0) + SER_GAP * (net.children.length - 1);
  }

  if (hasOval) {
    return { w: innerW + OV_PAD_X * 2, h: innerH + OV_PAD_Y * 2 };
  }
  return { w: innerW, h: innerH };
}

// ─── Node renderer ────────────────────────────────────────────────────────────
/**
 * Recursively renders a CMOS network node into SVG elements.
 *
 * Returns:
 * - parts[]  → SVG fragments
 * - cx       → center x-coordinate (used for vertical wiring)
 * - topBusY  → connection point for incoming wire
 * - botBusY  → connection point for outgoing wire
 */
function renderNode(net, ox, oy) {
  const parts = [];
  const bb    = bboxOf(net);
  const cx    = ox + bb.w / 2;

  // ── TRANSISTOR ──────────────────────────────────────────────────────────────
  if (net.type === 'TRANSISTOR') {
    const bcx  = ox + R_BUB;
    const bcy  = oy + R_BUB;
    const fill = net.inverted ? C_WARN    : C_BUBBLE;
    const stk  = net.inverted ? C_WARN_STK : C_BUB_STK;
    const lbl  = net.inverted ? `~${net.var}` : net.var;
    const fs   = net.inverted ? 10 : 13;
    parts.push(
      `<circle cx="${bcx}" cy="${bcy}" r="${R_BUB}" fill="${fill}" stroke="${stk}" stroke-width="2"/>`,
      `<text x="${bcx}" y="${bcy}" text-anchor="middle" dominant-baseline="central"
        font-family="${FONT}" font-size="${fs}" font-weight="700" fill="${C_WHITE}">${lbl}</text>`
    );
    return { parts, cx: bcx, topBusY: bcy - R_BUB, botBusY: bcy + R_BUB };
  }

  const hasOval  = net.colorIdx !== undefined;
  const ovalCol  = hasOval ? groupColor(net) : null;

  // Compute inner content origin (offset inward if there's an oval)
  const innerOx = ox + (hasOval ? OV_PAD_X : 0);
  const innerOy = oy + (hasOval ? OV_PAD_Y : 0);

  // Inner content dimensions (same as bbox minus oval padding)
  const kids = net.children.map(bboxOf);

  // ── PARALLEL ────────────────────────────────────────────────────────────────
  if (net.type === 'PARALLEL') {
    const innerW = kids.reduce((s, b) => s + b.w, 0) + PAR_GAP * (net.children.length - 1);
    const innerH = Math.max(...kids.map(b => b.h));

    // Render children side-by-side first
    let curX = innerOx;
    const childRes = net.children.map((child, i) => {
      const kb      = kids[i];
      const childOy = innerOy + (innerH - kb.h) / 2;
      const res     = renderNode(child, curX, childOy);
      parts.push(...res.parts);
      curX += kb.w + PAR_GAP;
      return res;
    });

    // Special case: pure leaf parallel groups get offset buses
    // to match standard bubble diagram spacing conventions
    const allLeaf = net.children.every(c => c.type === 'TRANSISTOR');

    const minTop = Math.min(...childRes.map(r => r.topBusY));
    const maxBot = Math.max(...childRes.map(r => r.botBusY));

    const LEAF_BUS_OFFSET = 10;

    // Only offset pure leaf parallel groups.
    // For non-leaf parallel groups, keep the original bus placement.
    const topBus = allLeaf ? (minTop - LEAF_BUS_OFFSET) : innerOy;
    const botBus = allLeaf ? (maxBot + LEAF_BUS_OFFSET) : (innerOy + innerH);

    // Horizontal top/bottom bus
    const busLeft  = childRes[0].cx;
    const busRight = childRes[childRes.length - 1].cx;
    parts.push(
      `<line x1="${busLeft}" y1="${topBus}" x2="${busRight}" y2="${topBus}"
        stroke="${C_WIRE}" stroke-width="${BUS_W}"/>`,
      `<line x1="${busLeft}" y1="${botBus}" x2="${busRight}" y2="${botBus}"
        stroke="${C_WIRE}" stroke-width="${BUS_W}"/>`
    );

    // Vertical stubs from each child to top/bottom bus
    childRes.forEach(res => {
      if (res.topBusY > topBus)
        parts.push(`<line x1="${res.cx}" y1="${topBus}" x2="${res.cx}" y2="${res.topBusY}"
          stroke="${C_WIRE}" stroke-width="${WIRE_W}"/>`);
      if (res.botBusY < botBus)
        parts.push(`<line x1="${res.cx}" y1="${res.botBusY}" x2="${res.cx}" y2="${botBus}"
          stroke="${C_WIRE}" stroke-width="${WIRE_W}"/>`);
    });

    // Entry / exit stub for oval
    if (hasOval && topBus > oy)
      parts.push(`<line x1="${cx}" y1="${oy}" x2="${cx}" y2="${topBus}"
        stroke="${C_WIRE}" stroke-width="${WIRE_W}"/>`);

    if (hasOval && botBus < oy + bb.h)
      parts.push(`<line x1="${cx}" y1="${botBus}" x2="${cx}" y2="${oy + bb.h}"
        stroke="${C_WIRE}" stroke-width="${WIRE_W}"/>`);

    if (hasOval) {
      parts.unshift(
        `<ellipse cx="${cx}" cy="${oy + bb.h / 2}" rx="${bb.w / 2}" ry="${bb.h / 2}"
          fill="${ovalCol}22" stroke="${ovalCol}" stroke-width="2.5"/>`
      );
    }

    return { parts, cx, topBusY: oy, botBusY: oy + bb.h };
  }

  // ── SERIES ──────────────────────────────────────────────────────────────────
  if (net.type === 'SERIES') {
    const innerW = Math.max(...kids.map(b => b.w));
    let curY     = innerOy;

    const childRes = net.children.map((child, i) => {
      const kb      = kids[i];
      const childOx = innerOx + (innerW - kb.w) / 2;
      const res     = renderNode(child, childOx, curY);
      parts.push(...res.parts);
      curY += kb.h + SER_GAP;
      return res;
    });

    // Vertical wires connecting bottom of each child to top of next
    const midX = innerOx + innerW / 2;
    for (let i = 0; i < childRes.length - 1; i++) {
      parts.push(
        `<line x1="${midX}" y1="${childRes[i].botBusY}" x2="${midX}" y2="${childRes[i+1].topBusY}"
          stroke="${C_WIRE}" stroke-width="${WIRE_W}"/>`
      );
    }

    // Oval drawn behind children
    if (hasOval) {
      parts.unshift(
        `<ellipse cx="${cx}" cy="${oy + bb.h / 2}" rx="${bb.w / 2}" ry="${bb.h / 2}"
          fill="${ovalCol}22" stroke="${ovalCol}" stroke-width="2.5"/>`
      );
    }

    return {
      parts,
      cx:      cx,
      topBusY: childRes[0].topBusY,
      botBusY: childRes[childRes.length - 1].botBusY
    };
  }

  return { parts, cx, topBusY: oy, botBusY: oy + bb.h };
}

// Determines where external wires connect to the top of a network
function topAttachY(net, oy) {
  const bb = bboxOf(net);

  if (net.type === 'TRANSISTOR') {
    return oy; // top of transistor bubble
  }

  const hasOval = net.colorIdx !== undefined;
  const innerOy = oy + (hasOval ? OV_PAD_Y : 0);
  const kids = net.children.map(bboxOf);

  if (net.type === 'SERIES') {
    // first actual thing in a series chain
    return topAttachY(net.children[0], innerOy);
  }

  if (net.type === 'PARALLEL') {
    const innerH = Math.max(...kids.map(b => b.h));

    // renderNode() logic: pure leaf parallel groups have lifted top bus
    const allLeaf = net.children.every(c => c.type === 'TRANSISTOR');
    const LEAF_BUS_OFFSET = 10;

    if (allLeaf) {
      return innerOy - LEAF_BUS_OFFSET;
    }

    // non-leaf parallel groups use the normal inner top bus
    return innerOy;
  }

  return oy;
}

// Determines where external wires connect to the bottom of a network
function bottomAttachY(net, oy) {
  const bb = bboxOf(net);

  if (net.type === 'TRANSISTOR') {
    return oy + bb.h; // bottom of transistor bubble
  }

  const hasOval = net.colorIdx !== undefined;
  const innerOy = oy + (hasOval ? OV_PAD_Y : 0);
  const kids = net.children.map(bboxOf);

  if (net.type === 'SERIES') {
    // last actual thing in a series chain
    let curY = innerOy;
    for (let i = 0; i < kids.length - 1; i++) {
      curY += kids[i].h + SER_GAP;
    }
    return bottomAttachY(net.children[net.children.length - 1], curY);
  }

  if (net.type === 'PARALLEL') {
    const innerH = Math.max(...kids.map(b => b.h));

    const allLeaf = net.children.every(c => c.type === 'TRANSISTOR');
    const LEAF_BUS_OFFSET = 10;

    if (allLeaf) {
      return innerOy + innerH + LEAF_BUS_OFFSET;
    }

    return innerOy + innerH;
  }

  return oy + bb.h;
}

// ─── Grid dot background ──────────────────────────────────────────────────────
function gridDots(w, h) {
  const id = `gd${Math.random().toString(36).slice(2, 7)}`;
  return `<defs>
    <pattern id="${id}" width="18" height="18" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#cbd5e1" opacity="0.5"/>
    </pattern>
  </defs>
  <rect width="${w-30}" height="${h-30}" fill="#f8fafc"/>
  <rect width="${w-30}" height="${h-30}" fill="url(#${id})"/>`;
}

// ─── Color legend ─────────────────────────────────────────────────────────────
function collectGroups(net, map = new Map()) {
  if (net.colorIdx !== undefined && net.type !== 'TRANSISTOR') {
    const k = net.colorIdx;
    if (!map.has(k)) map.set(k, GROUP_COLS[k % GROUP_COLS.length]);
  }
  if (net.children) net.children.forEach(c => collectGroups(c, map));
  return map;
}

function buildLegend(nmos, pmos, cx, svgH) {
  const groups = collectGroups(nmos);
  collectGroups(pmos, groups);
  if (groups.size < 2) return '';

  const legendY = svgH - 50;
  const itemW   = 86;
  const startX  = cx - (groups.size * itemW) / 2;
  const parts   = [];

  parts.push(
    `<text x="${cx}" y="${legendY - 14}" text-anchor="middle"
      font-family="${FONT}" font-size="9" font-weight="600" fill="#0f1011"
      letter-spacing="0.12em">COLOR CORRESPONDENCE  (PMOS ↔ NMOS)</text>`
  );

  let x = startX;
  [...groups.entries()].sort((a, b) => a[0] - b[0]).forEach(([k, col]) => {
    parts.push(
      `<rect x="${x}" y="${legendY - 4}" width="12" height="12" rx="6" fill="${col}"/>`,
      `<text x="${x + 16}" y="${legendY + 6}" font-family="${FONT}" font-size="10"
        fill="#0f1011">Group ${k + 1}</text>`
    );
    x += itemW;
  });
  return parts.join('\n');
}

// ─── Main entry: generates full CMOS bubble diagram (PMOS + NMOS + wiring) ─────
function renderBubbleDiagram(pmosNet, nmosNet, options = {}) {
  const needsOutputInverter = options.needsOutputInverter === true;
  // Assign matching color indices: PMOS child i ↔ NMOS child i → same color
  assignBothNetworks(nmosNet, pmosNet);

  const pmosBox = bboxOf(pmosNet);
  const nmosBox = bboxOf(nmosNet);

  const netW   = Math.max(pmosBox.w, nmosBox.w, 60);
  const ringW  = netW + RING_PAD * 2;
  const extraInvW = needsOutputInverter ? 0 : 0;
  const svgW   = LABEL_W + ringW + RIGHT_PAD + extraInvW;
  const netOx  = LABEL_W + RING_PAD;
  const diagCx = LABEL_W + ringW / 2;

  // ── Y layout ──
  const vddTopY     = V_PAD;
  const vddLineY    = vddTopY + 20;
  const pmosNetOy   = vddLineY + 18;
  const pmosNetBotY = pmosNetOy + pmosBox.h;
  const outNodeY    = pmosNetBotY + VGAP_NET;
  const nmosNetOy   = outNodeY   + VGAP_OUT;
  const nmosNetBotY = nmosNetOy  + nmosBox.h;
  const gndTopY     = nmosNetBotY + VGAP_NET;

  const needsLegend = (pmosNet.children && pmosNet.children.length > 1) ||
                      (nmosNet.children && nmosNet.children.length > 1);
  const svgH = gndTopY + GND_H + V_PAD + (needsLegend ? 52 : 0);

  const pmosOx = netOx + (netW - pmosBox.w) / 2;
  const nmosOx = netOx + (netW - nmosBox.w) / 2;

  // ── Ring geometry ──
  const pRingCy  = pmosNetOy + pmosBox.h / 2;
  const pRingRx  = ringW / 2;
  const pRingRy  = pmosBox.h / 2 + RING_PAD;
  const pRingTop = pRingCy - pRingRy;
  const pRingBot = pRingCy + pRingRy;

  const nRingCy  = nmosNetOy + nmosBox.h / 2;
  const nRingRx  = ringW / 2;
  const nRingRy  = nmosBox.h / 2 + RING_PAD;
  const nRingTop = nRingCy - nRingRy;
  const nRingBot = nRingCy + nRingRy;

  const vddSymbolLineY = pRingTop;
  const vddSymbolTopY  = vddSymbolLineY - 20;

  const parts = [];

  // Background
  parts.push(gridDots(svgW, svgH));

  // PMOS ring (gold) — drawn first so it's behind everything
  parts.push(
    `<ellipse cx="${diagCx}" cy="${pRingCy}" rx="${pRingRx}" ry="${pRingRy}"
      fill="${C_PMOS_RING}18" stroke="${C_PMOS_RING}" stroke-width="3"/>`,
    `<text x="${LABEL_W - 10}" y="${pRingCy}" text-anchor="end" dominant-baseline="central"
      font-family="${FONT}" font-size="14" font-weight="700" fill="${'#eed202'}">PMOS</text>`
  );

  // NMOS ring (red)
  parts.push(
    `<ellipse cx="${diagCx}" cy="${nRingCy}" rx="${nRingRx}" ry="${nRingRy}"
      fill="${C_NMOS_RING}18" stroke="${C_NMOS_RING}" stroke-width="3"/>`,
    `<text x="${LABEL_W - 10}" y="${nRingCy}" text-anchor="end" dominant-baseline="central"
      font-family="${FONT}" font-size="14" font-weight="700" fill="${'#9b111e'}">NMOS</text>`
  );

  // VDD symbol
  parts.push(
    `<text x="${diagCx}" y="${vddSymbolTopY-1}" text-anchor="middle" dominant-baseline="hanging"
      font-family="${FONT}" font-size="13" font-weight="700" fill="${C_VDD}">VDD</text>`,
    `<line x1="${diagCx - 18}" y1="${vddSymbolLineY-5}" x2="${diagCx + 18}" y2="${vddSymbolLineY-5}"
      stroke="${C_VDD}" stroke-width="3"/>`,
    `<line x1="${diagCx}" y1="${vddSymbolTopY + 14}" x2="${diagCx}" y2="${vddSymbolLineY}"
      stroke="${C_VDD}" stroke-width="2.5"/>`,
    `<line x1="${diagCx}" y1="${vddSymbolLineY}" x2="${diagCx}" y2="${pRingTop}"
      stroke="${C_VDD}" stroke-width="2"/>`
  );

  // PMOS network
  const pmosRes = renderNode(pmosNet, pmosOx, pmosNetOy);
  parts.push(...pmosRes.parts);

  // NMOS network
  const nmosRes = renderNode(nmosNet, nmosOx, nmosNetOy);
  parts.push(...nmosRes.parts);

  // Attach points
  const pmosAttachTopY = topAttachY(pmosNet, pmosNetOy);
  const pmosAttachBotY = bottomAttachY(pmosNet, pmosNetOy);
  const nmosAttachTopY = topAttachY(nmosNet, nmosNetOy);
  const nmosAttachBotY = bottomAttachY(nmosNet, nmosNetOy);

  // PMOS ring top down to actual PMOS top attach point
  parts.push(
    `<line x1="${diagCx}" y1="${pRingTop}" x2="${diagCx}" y2="${pmosAttachTopY}"
      stroke="${C_WIRE}" stroke-width="${WIRE_W}"/>`
  );

  // PMOS bottom attach point down to output node
  parts.push(
    `<line x1="${diagCx}" y1="${pmosAttachBotY}" x2="${diagCx}" y2="${outNodeY}"
      stroke="${C_WIRE}" stroke-width="${WIRE_W}"/>`
  );

  // Output node(s)
  const coreWireStartX = diagCx + OUT_R;

  if (!needsOutputInverter) {
    const yWireLen = 44;
    parts.push(
      `<circle cx="${diagCx}" cy="${outNodeY}" r="${OUT_R}" fill="${C_OUT}"/>`,
      `<line x1="${coreWireStartX}" y1="${outNodeY}" x2="${coreWireStartX + yWireLen}" y2="${outNodeY}"
        stroke="${C_OUT}" stroke-width="2"/>`,
      `<text x="${coreWireStartX + yWireLen + 6}" y="${outNodeY}" text-anchor="start" dominant-baseline="central"
        font-family="${FONT}" font-size="12" font-weight="700" fill="${C_OUT}">Y</text>`
    );
  } else {
    const xTapLen = 26;
    const invInX = coreWireStartX + xTapLen + 10;
    const triW = 26;
    const triH = 20;
    const bubbleR = 4;
    const invOutStartX = invInX + triW + bubbleR * 2 + 4;
    const yWireLen = 34;

    parts.push(
      // X node
      `<circle cx="${diagCx}" cy="${outNodeY}" r="${OUT_R}" fill="${C_OUT}"/>`,
      `<line x1="${coreWireStartX}" y1="${outNodeY}" x2="${invInX}" y2="${outNodeY}"
        stroke="${C_OUT}" stroke-width="2"/>`,
      `<text x="${invInX - 6}" y="${outNodeY - 4}" text-anchor="end"
        font-family="${FONT}" font-size="12" font-weight="700" fill="${C_OUT}">X</text>`,

      // Inverter triangle
      `<polygon points="${invInX},${outNodeY - triH/2} ${invInX},${outNodeY + triH/2} ${invInX + triW},${outNodeY}"
        fill="none" stroke="${C_OUT}" stroke-width="2"/>`,
      `<circle cx="${invInX + triW + bubbleR + 1}" cy="${outNodeY}" r="${bubbleR}"
        fill="none" stroke="${C_OUT}" stroke-width="2"/>`,

      // Y output
      `<line x1="${invOutStartX-3}" y1="${outNodeY}" x2="${invOutStartX + yWireLen}" y2="${outNodeY}"
        stroke="${C_OUT}" stroke-width="2"/>`,
      `<text x="${invOutStartX + yWireLen + 6}" y="${outNodeY}" text-anchor="start" dominant-baseline="central"
        font-family="${FONT}" font-size="12" font-weight="700" fill="${C_OUT}">Y</text>`
    );
  }

  // Output node down to actual NMOS top attach point
  parts.push(
    `<line x1="${diagCx}" y1="${outNodeY + OUT_R}" x2="${diagCx}" y2="${nmosAttachTopY}"
      stroke="${C_WIRE}" stroke-width="${WIRE_W}"/>`
  );

  // Actual NMOS bottom attach point down to GND
  parts.push(
    `<line x1="${diagCx}" y1="${nmosAttachBotY}" x2="${diagCx}" y2="${gndTopY}"
      stroke="${C_GND}" stroke-width="${WIRE_W}"/>`
  );

  // Signal GND (downward triangle)
  const gndTip = gndTopY + 22;
  parts.push(
    `<line x1="${diagCx - 20}" y1="${gndTopY}" x2="${diagCx + 20}" y2="${gndTopY}"
      stroke="${C_GND}" stroke-width="3"/>`,
    `<line x1="${diagCx - 20}" y1="${gndTopY}" x2="${diagCx}" y2="${gndTip}"
      stroke="${C_GND}" stroke-width="2.5"/>`,
    `<line x1="${diagCx + 20}" y1="${gndTopY}" x2="${diagCx}" y2="${gndTip}"
      stroke="${C_GND}" stroke-width="2.5"/>`,
    `<text x="${diagCx}" y="${gndTip + 8}" text-anchor="middle" dominant-baseline="hanging"
      font-family="${FONT}" font-size="13" font-weight="700" fill="${C_GND}">GND / VSS</text>`
  );

  // Legend
  if (needsLegend) parts.push(buildLegend(nmosNet, pmosNet, diagCx, svgH));

  return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}"
    xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto">
    ${parts.join('\n    ')}
  </svg>`;
}
