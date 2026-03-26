/**
 * schematic.js - Transistor-Level CMOS Schematic Renderer
 *
 * Converts CMOS network structures into a physically interpretable
 * transistor-level schematic.
 *
 * Design goals:
 * - Preserve electrical topology (true conduction paths)
 * - Align devices along a shared vertical "spine" for readability
 * - Clearly distinguish series (stacked) vs parallel (branched) behavior
 *
 * Rendering model:
 * - SERIES   → devices aligned on a single vertical conduction path
 * - PARALLEL → branches split horizontally and reconnect via shared rails
 *
 * Conventions:
 * - PMOS: source at top, drain at bottom, gate bubble shown
 * - NMOS: drain at top, source at bottom, no bubble
 * - VDD above PMOS, GND below NMOS, output node between networks
 *
 * Note:
 * This renderer prioritizes structural correctness over compactness.
 */

// ─── Dimensions ───────────────────────────────────────────────────────────────
const S = {
  // MOSFET symbol
  GATE_BAR_H:  34,   // height of vertical gate bar
  BODY_GAP:     5,   // horizontal gap between gate bar right edge and SD stubs
  SD_STUB:     22,   // horizontal length of source/drain stub (rightward to spineX)
  GATE_WIRE:   24,   // gate wire length left of gate bar (to gate contact)
  BUBBLE_R:     5,   // PMOS bubble radius

  // Cell dimensions — transistor occupies this box
  CELL_W:      90,   // total cell width (gate label + wire + bubble + bar + gap + stub)
  CELL_H:      72,   // total cell height

  // Parallel branch spacing
  BRANCH_GAP:  12,   // horizontal gap between parallel branches

  // Series: no explicit gap — transistor stubs extend to cell top/bottom creating continuity
  SER_EXTRA:    0,   // extra vertical space between series cells (0 = flush/continuous)

  // Colors
  PMOS:  '#2d3542',
  NMOS:  '#2d3542',
  WIRE:  '#2d3542',
  VDD:   '#2d3542',
  GND:   '#2d3542',
  OUT:   '#2d3542',
  WARN:  '#ea580c',
  FONT:  'IBM Plex Mono, monospace',
};

// spineX offset within a single transistor cell (right edge of SD stub)
// This is the x at which the continuous vertical wire runs.
const CELL_SPINE_OX = S.CELL_W - 1;  // right side of cell, just inside right edge

// ─── Grid dot background ─────────────────────────────────────────────────────
function schGridDots(w, h) {
  const id = `sd${Math.random().toString(36).slice(2, 7)}`;
  return `<defs>
    <pattern id="${id}" width="18" height="18" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#cbd5e1" opacity="0.6"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="#f8fafc"/>
  <rect width="${w}" height="${h}" fill="url(#${id})"/>`;
}

// ─── Layout measurement ───────────────────────────────────────────────────────
/**
 * Returns { w, h, spineOx }
 *   w, h      = bounding box dimensions
 *   spineOx   = spine x RELATIVE to this node's ox (left edge of bbox)
 *
 * For a TRANSISTOR: spine is at CELL_SPINE_OX from the left.
 *
 * For SERIES: all children must share the same spineOx.
 *   w = max child w, with each child's left edge offset so its spineOx aligns.
 *   h = sum of child heights (no gap — series is flush).
 *
 * For PARALLEL: children side by side.
 *   Each child is placed at its own x. Spine = center of the group.
 *   w = sum of child widths + gaps, h = max child height.
 *   spineOx = w/2 (center).
 */
// Computes layout dimensions and spine alignment for a network subtree
function measureNet(net) {
  if (net.type === 'TRANSISTOR') {
    return { w: S.CELL_W, h: S.CELL_H, spineOx: CELL_SPINE_OX };
  }

  if (net.type === 'SERIES') {
    const kids = net.children.map(measureNet);
    // SERIES: all devices share one conduction path (same spine),
    // creating a continuous vertical current path
    // Each child may have a different spineOx; must left-pad them uniformly.
    const maxSpine = Math.max(...kids.map(k => k.spineOx));
    // Each child is offset left so its spineOx aligns with maxSpine.
    const childW   = kids.map(k => k.w + (maxSpine - k.spineOx));
    const totalW   = Math.max(...childW);
    const totalH   = kids.reduce((s, k) => s + k.h, 0);  // flush, no gap
    return { w: totalW, h: totalH, spineOx: maxSpine, _kids: kids, _childW: childW };
  }

  if (net.type === 'PARALLEL') {
  const kids = net.children.map(measureNet);
  // PARALLEL: branches represent alternative conduction paths,
  // splitting current between multiple paths and recombining at shared nodes
  let curX = 0;
  const childSpines = [];

  kids.forEach((k, i) => {
    childSpines.push(curX + k.spineOx);
    curX += k.w;
    if (i < kids.length - 1) curX += S.BRANCH_GAP;
  });

  const totalW = curX;
  const totalH = Math.max(...kids.map(k => k.h));

  const minSpine = Math.min(...childSpines);
  const maxSpine = Math.max(...childSpines);

  return {
    w: totalW,
    h: totalH,
    spineOx: (minSpine + maxSpine) / 2,
    _kids: kids
  };
}

  return { w: S.CELL_W, h: S.CELL_H, spineOx: CELL_SPINE_OX };
}

// ─── PMOS transistor symbol ───────────────────────────────────────────────────
/**
 * Draw PMOS at (ox, oy) with spineX = ox + spineOx.
 * Source stub (top) and drain stub (bottom) both land on spineX.
 * Vertical source wire from srcY up to oy (cell top).
 * Vertical drain wire from drnY down to oy + CELL_H (cell bottom).
 * Returns { parts, spineX, topY: oy, botY: oy+CELL_H }
 */
// Draws a PMOS transistor aligned to the shared vertical spine
function drawPmos(ox, oy, label, isWarn, spineOx) {
  const parts  = [];
  const col    = isWarn ? S.WARN : S.PMOS;
  const spineX = ox + spineOx;

  // Gate bar x: gate bar sits SD_STUB + BODY_GAP to the left of spineX
  const gateBarX  = spineX - S.SD_STUB - S.BODY_GAP - 1;
  const midY      = oy + S.CELL_H / 2;
  const halfH     = S.GATE_BAR_H / 2;
  const srcY      = midY - halfH * 0.52;
  const drnY      = midY + halfH * 0.52;

  // Vertical gate bar
  parts.push(`<line x1="${gateBarX}" y1="${midY - halfH}" x2="${gateBarX}" y2="${midY + halfH}"
    stroke="${col}" stroke-width="3" stroke-linecap="round"/>`);

  // Horizontal source stub (top): from right of gate bar → spineX
  parts.push(`<line x1="${gateBarX + S.BODY_GAP}" y1="${srcY}" x2="${spineX}" y2="${srcY}"
    stroke="${col}" stroke-width="2"/>`);

  // Horizontal drain stub (bottom): from right of gate bar → spineX
  parts.push(`<line x1="${gateBarX + S.BODY_GAP}" y1="${drnY}" x2="${spineX}" y2="${drnY}"
    stroke="${col}" stroke-width="2"/>`);

  // Gate wire + PMOS inversion bubble (left of gate bar)
  const bubbleCx     = gateBarX - S.BUBBLE_R - 1;
  const gateWireEndX = bubbleCx - S.BUBBLE_R;
  const gateContactX = gateWireEndX - S.GATE_WIRE;
  parts.push(
    `<line x1="${gateContactX}" y1="${midY}" x2="${gateWireEndX}" y2="${midY}"
      stroke="${col}" stroke-width="2"/>`,
    `<circle cx="${bubbleCx}" cy="${midY}" r="${S.BUBBLE_R}"
      fill="none" stroke="${col}" stroke-width="1.8"/>`
  );

  // Gate label
  const lbl = isWarn ? `~${label}` : label;
  parts.push(`<text x="${gateContactX - 4}" y="${midY}" text-anchor="end"
    dominant-baseline="central" font-family="${S.FONT}"
    font-size="12" font-weight="600" fill="${col}">${lbl}</text>`);

  // Continuous vertical spine wire: oy (cell top) → srcY → drnY → oy+CELL_H
  // This is THREE segments that together form one unbroken vertical line:
  const channelX = gateBarX + S.BODY_GAP + 1;
  parts.push(
    // Top segment: cell top → source terminal
    `<line x1="${spineX}" y1="${oy}" x2="${spineX}" y2="${srcY}"
      stroke="${col}" stroke-width="2"/>`,
    // Middle segment: source → drain (the active channel region, drawn same color)
    `<line x1="${channelX}" y1="${srcY}" x2="${channelX}" y2="${drnY}"
      stroke="${col}" stroke-width="2"/>`,
    // Bottom segment: drain terminal → cell bottom
    `<line x1="${spineX}" y1="${drnY}" x2="${spineX}" y2="${oy + S.CELL_H}"
      stroke="${col}" stroke-width="2"/>`
  );

  return { parts, spineX, topY: oy, botY: oy + S.CELL_H };
}

// ─── NMOS transistor symbol ───────────────────────────────────────────────────
// Draws an NMOS transistor aligned to the shared vertical spine
function drawNmos(ox, oy, label, isWarn, spineOx) {
  const parts  = [];
  const col    = isWarn ? S.WARN : S.NMOS;
  const spineX = ox + spineOx;

  const gateBarX  = spineX - S.SD_STUB - S.BODY_GAP - 1;
  const midY      = oy + S.CELL_H / 2;
  const halfH     = S.GATE_BAR_H / 2;
  const drnY      = midY - halfH * 0.52;  // drain at top
  const srcY      = midY + halfH * 0.52;  // source at bottom

  // Gate bar
  parts.push(`<line x1="${gateBarX}" y1="${midY - halfH}" x2="${gateBarX}" y2="${midY + halfH}"
    stroke="${col}" stroke-width="3" stroke-linecap="round"/>`);

  // Drain stub (top), source stub (bottom)
  parts.push(
    `<line x1="${gateBarX + S.BODY_GAP}" y1="${drnY}" x2="${spineX}" y2="${drnY}"
      stroke="${col}" stroke-width="2"/>`,
    `<line x1="${gateBarX + S.BODY_GAP}" y1="${srcY}" x2="${spineX}" y2="${srcY}"
      stroke="${col}" stroke-width="2"/>`
  );

  // Gate wire (no bubble for NMOS)
  const gateContactX = gateBarX - S.GATE_WIRE - 2;
  parts.push(`<line x1="${gateContactX}" y1="${midY}" x2="${gateBarX - 1}" y2="${midY}"
    stroke="${col}" stroke-width="2"/>`);

  // Gate label
  const lbl = isWarn ? `~${label}` : label;
  parts.push(`<text x="${gateContactX - 4}" y="${midY}" text-anchor="end"
    dominant-baseline="central" font-family="${S.FONT}"
    font-size="12" font-weight="600" fill="${col}">${lbl}</text>`);

  // Continuous vertical spine wire
  const channelX = gateBarX + S.BODY_GAP + 1;
  parts.push(
    `<line x1="${spineX}" y1="${oy}" x2="${spineX}" y2="${drnY}"
      stroke="${col}" stroke-width="2"/>`,
    `<line x1="${channelX}" y1="${drnY}" x2="${channelX}" y2="${srcY}"
      stroke="${col}" stroke-width="2"/>`,
    `<line x1="${spineX}" y1="${srcY}" x2="${spineX}" y2="${oy + S.CELL_H}"
      stroke="${col}" stroke-width="2"/>`
  );

  return { parts, spineX, topY: oy, botY: oy + S.CELL_H };
}

// ─── Network renderer ─────────────────────────────────────────────────────────
/**
 * Render network at (ox, oy).
 * m = measureNet(net) must be pre-computed and passed in.
 *
 * Returns { parts, spineX, topY, botY }
 *   spineX = absolute x of the spine wire
 *   topY   = y where the spine exits the top of this block
 *   botY   = y where the spine exits the bottom of this block
 */
// Recursively renders network while maintaining a continuous vertical conduction spine
function renderNet(net, ox, oy, mos, m) {
  if (!m) m = measureNet(net);
  const parts  = [];
  const col    = mos === 'PMOS' ? S.PMOS : S.NMOS;
  const spineX = ox + m.spineOx;

  // ── Single transistor ──────────────────────────────────────────────────────
  if (net.type === 'TRANSISTOR') {
    const draw = mos === 'PMOS' ? drawPmos : drawNmos;
    const res  = draw(ox, oy, net.var, net.inverted === true, m.spineOx);
    return { parts: res.parts, spineX: res.spineX, topY: res.topY, botY: res.botY };
  }

  // ── SERIES: stacked flush, shared spine ────────────────────────────────────
  //
  // All children are left-padded so their spineOx aligns with m.spineOx.
  // They are stacked with zero gap (SER_EXTRA = 0).
  // The spine wire runs continuously through all of them — no bridging needed
  // because each transistor already draws its spine wire all the way to cell top/bottom.
  //
  if (net.type === 'SERIES') {
    const kids   = m._kids || net.children.map(measureNet);
    let curY     = oy;
    const results = [];

    net.children.forEach((child, i) => {
      const km     = kids[i];
      // Left-pad so child's spine aligns with parent's spine
      const leftPad = m.spineOx - km.spineOx;
      const childOx = ox + leftPad;
      const res = renderNet(child, childOx, curY, mos, km);
      parts.push(...res.parts);
      results.push(res);
      curY += km.h + S.SER_EXTRA;
    });

    // The spine wire is already drawn by each child.
    // Must bridge any SER_EXTRA gap between adjacent cells.
    // (With SER_EXTRA=0 there is no gap, so the spine is truly continuous.)
    for (let i = 0; i < results.length - 1; i++) {
      const upper = results[i];
      const lower = results[i + 1];
      if (lower.topY > upper.botY) {
        parts.push(`<line x1="${spineX}" y1="${upper.botY}" x2="${spineX}" y2="${lower.topY}"
          stroke="${col}" stroke-width="2"/>`);
      }
    }

    return {
      parts,
      spineX,
      topY: results[0].topY,
      botY: results[results.length - 1].botY
    };
  }

  // ── PARALLEL: branches side-by-side, shared top + bottom bus ───────────────
  //
  // Each branch is placed at its own x.
  // Shared top bus Y = oy.
  // Shared bottom bus Y = oy + totalH.
  // Spine of the group = center (spineX = ox + m.spineOx).
  //
  // Internal backbone wires:
  //   From top bus down to spine → each branch's topY (vertical stubs)
  //   From each branch's botY up to bottom bus
  //   From spineCx on top bus → upward to group topY (entry stub)
  //   From spineCx on bot bus → downward to group botY (exit stub)
  //
  if (net.type === 'PARALLEL') {
    const kids   = m._kids || net.children.map(measureNet);
    const totalH = m.h;
    const totalW = m.w;
    let curX     = ox;
    const results = [];

    net.children.forEach((child, i) => {
      const km      = kids[i];
      const childOy = oy + (totalH - km.h) / 2;
      const res = renderNet(child, curX, childOy, mos, km);
      parts.push(...res.parts);
      results.push(res);
      curX += km.w + S.BRANCH_GAP;
    });

    const allSpineX = results.map(r => r.spineX);
    const busTopY   = oy;
    const busBotY   = oy + totalH;

    // The bus rails must span from the leftmost branch to the rightmost branch,
    // AND must include spineX (the center of the group bbox) so the vertical
    // entry/exit connection wire always lands on a real rail segment.
    const busLeft  = Math.min(...allSpineX, spineX);
    const busRight = Math.max(...allSpineX, spineX);

    // Top horizontal bus rail
    parts.push(`<line x1="${busLeft}" y1="${busTopY}" x2="${busRight}" y2="${busTopY}"
      stroke="${col}" stroke-width="2.5"/>`);
    // Bottom horizontal bus rail
    parts.push(`<line x1="${busLeft}" y1="${busBotY}" x2="${busRight}" y2="${busBotY}"
      stroke="${col}" stroke-width="2.5"/>`);

    // Vertical stubs: each branch's spine connects from its topY to the top bus
    // and from its botY to the bottom bus
    results.forEach(r => {
      if (r.topY > busTopY)
        parts.push(`<line x1="${r.spineX}" y1="${busTopY}" x2="${r.spineX}" y2="${r.topY}"
          stroke="${S.WIRE}" stroke-width="2"/>`);
      if (r.botY < busBotY)
        parts.push(`<line x1="${r.spineX}" y1="${r.botY}" x2="${r.spineX}" y2="${busBotY}"
          stroke="${S.WIRE}" stroke-width="2"/>`);
    });

    // Center stub ensures a clear entry/exit connection at the group spine
    return {
      parts,
      spineX,
      topY: busTopY,
      botY: busBotY
    };
  }

  return { parts, spineX, topY: oy, botY: oy + m.h };
}

// ─── Signal GND symbol ───────────────────────────────────────────────────────
function sigGnd(cx, y, col, font) {
  const w = 20, h = 22;
  const tip = y + h;
  return [
    `<line x1="${cx-w}" y1="${y}" x2="${cx+w}" y2="${y}" stroke="${col}" stroke-width="3"/>`,
    `<line x1="${cx-w}" y1="${y}" x2="${cx}" y2="${tip}" stroke="${col}" stroke-width="2.5"/>`,
    `<line x1="${cx+w}" y1="${y}" x2="${cx}" y2="${tip}" stroke="${col}" stroke-width="2.5"/>`,
    `<text x="${cx}" y="${tip+8}" text-anchor="middle" dominant-baseline="hanging"
      font-family="${font}" font-size="12" font-weight="700" fill="${col}">GND / VSS</text>`
  ].join('\n');
}

// ─── Main entry builds full CMOS schematic including VDD, output node, and GND
function renderSchematic(pmosNet, nmosNet) {
  const MIN_LABEL_LEFT = 10;   // minimum left margin (must fit gate labels)
  const Y_LABEL_RIGHT  = 80;   // right margin reserved for "Y" label
  const PAD_TOP        = 60;   // top padding for VDD symbol
  const OUT_GAP        = 32;   // vertical gap between PMOS botY and NMOS topY
  const OUT_R          =  5;

  // Pre-measure both networks
  const pm = measureNet(pmosNet);
  const nm = measureNet(nmosNet);

  // Force both networks to share the same spineOx (left-pad the narrower one)
  const sharedSpineOx = Math.max(pm.spineOx, nm.spineOx);

  const pmAdj = { ...pm, spineOx: sharedSpineOx, w: pm.w + (sharedSpineOx - pm.spineOx) };
  const nmAdj = { ...nm, spineOx: sharedSpineOx, w: nm.w + (sharedSpineOx - nm.spineOx) };
  const contentW = Math.max(pmAdj.w, nmAdj.w);

  // ── Place the junction at the visual center of the network content ───────────
  //
  // The junction (orange dot + black vertical wire) must sit at the horizontal
  // center of the overall network bounding box, not at the leftmost available
  // branch connection.
  //
  // Strategy:
  //   1. contentW = widest of the two networks (as measured).
  //   2. targetSpineOx = contentW / 2  — the center of the content block.
  //   3. Each network is shifted RIGHT so its internal spine (sharedSpineOx)
  //      aligns with targetSpineOx. The shift adds right-padding to the
  //      content area: rightPad = targetSpineOx - sharedSpineOx.
  //      (If sharedSpineOx is already past center, no shift needed.)
  //   4. paddedContentW = contentW + rightPad  (wider to accommodate shift).
  //   5. LABEL_LEFT = MIN_LABEL_LEFT  (gate labels always get at least 90px left).
  //   6. spineX = LABEL_LEFT + targetSpineOx  — sits at center of paddedContentW.
  //
  const targetSpineOx  = Math.max(contentW / 2, sharedSpineOx); // center, never less than current spine
  const rightPad       = targetSpineOx - sharedSpineOx;          // extra space added to right of networks
  const paddedContentW = contentW + rightPad;
  const LABEL_LEFT     = MIN_LABEL_LEFT;
  const svgW           = LABEL_LEFT + paddedContentW + Y_LABEL_RIGHT;
  const spineX         = LABEL_LEFT + targetSpineOx;   // centered on paddedContentW

  // Y positions
  const vddSymY   = PAD_TOP - 36;
  const vddLineY  = vddSymY + 18;
  const pmosOy    = vddLineY + 10;
  const pmosH     = pm.h;
  const pmosEndY  = pmosOy + pmosH;
  const outY      = pmosEndY + OUT_GAP / 2;
  const nmosOy    = pmosEndY + OUT_GAP;
  const nmosH     = nm.h;
  const nmosEndY  = nmosOy + nmosH;
  const gndSymY   = nmosEndY + 10;
  const svgH      = gndSymY + 50 + 20;

  // Horizontal placement: shift networks right by rightPad so their spines hit spineX
  // Each network is also left-padded to align its own spineOx with sharedSpineOx.
  const pmosOx = LABEL_LEFT + rightPad + (sharedSpineOx - pm.spineOx);
  const nmosOx = LABEL_LEFT + rightPad + (sharedSpineOx - nm.spineOx);

  const parts = [];
  parts.push(schGridDots(svgW, svgH));

  // ── Render PMOS and NMOS networks ──────────────────────────────────────────
  const pmosRes = renderNet(pmosNet, pmosOx, pmosOy, 'PMOS', pm);
  const nmosRes = renderNet(nmosNet, nmosOx, nmosOy, 'NMOS', nm);
  parts.push(...pmosRes.parts);
  parts.push(...nmosRes.parts);

  // ── VDD symbol: connects DIRECTLY to pmosRes.topY ─────────────────────────
  //
  //        VDD            ← text label
  //     ───┬───           ← horizontal bar (inverted-T)
  //        │              ← short vertical stem down to PMOS top
  //  ══════════════       ← horizontal rail spanning PMOS columns (drawn in blue)
  //     |  |  |  |        ← (the PMOS transistors — already rendered above)
  //
  // The horizontal rail IS pmosRes.topY.  VDD symbol vertical wire goes from
  // vddLineY straight down to pmosRes.topY with no gap.
  //
  const pmTopY = pmosRes.topY;   // = pmosOy (top of PMOS block)

  // VDD rail: horizontal line at pmTopY spanning PMOS spine ± 12
  // For parallel PMOS: spans all branch spines.  For series: just the single spine.
  // Use spineX ± half the PMOS content width as a safe estimate.
  const pmHalfW = pmAdj.w / 2;
  const railLeft  = spineX - pmHalfW + S.SD_STUB;
  const railRight = spineX + 12;

  parts.push(
    // VDD label
    `<text x="${spineX}" y="${vddSymY}" text-anchor="middle" dominant-baseline="hanging"
      font-family="${S.FONT}" font-size="12" font-weight="700" fill="${S.VDD}">VDD</text>`,
    // Inverted-T cap lines
    `<line x1="${spineX-14}" y1="${vddLineY-3}" x2="${spineX+14}" y2="${vddLineY-3}"
      stroke="${S.VDD}" stroke-width="3"/>`,
    `<line x1="${spineX}" y1="${vddSymY+14}" x2="${spineX}" y2="${vddLineY}"
      stroke="${S.VDD}" stroke-width="2.5"/>`,
    // Vertical wire: VDD bar → PMOS top (NO GAP)
    `<line x1="${spineX}" y1="${vddLineY}" x2="${spineX}" y2="${pmTopY}"
      stroke="${S.VDD}" stroke-width="2.5"/>`
  );

  // ── Internal backbone wire: from PMOS top into network ────────────────────
  // For parallel PMOS, draw horizontal top-bus from spineX to all branches
  // (this is already drawn by renderNet for PARALLEL).
  // For series PMOS, the spine wire is already continuous through the chain.
  // Extra: draw spine wire from pmTopY down to pmosRes.topY if they differ
  if (pmosRes.topY > pmTopY) {
    parts.push(`<line x1="${spineX}" y1="${pmTopY}" x2="${spineX}" y2="${pmosRes.topY}"
      stroke="${S.VDD}" stroke-width="2.5"/>`);
  }

  // ── Continuous spine from PMOS botY to output node ──────────────────────
  parts.push(`<line x1="${spineX}" y1="${pmosRes.botY}" x2="${spineX}" y2="${outY}"
    stroke="${S.WIRE}" stroke-width="2.5"/>`);

  // ── Output node: T-junction (dot + horizontal branch right toward Y label) ──
  // The dot sits on spineX (now at content center). Branch extends a fixed length rightward.
  const yBranchEnd = spineX + 48;
  parts.push(
    `<circle cx="${spineX}" cy="${outY}" r="${OUT_R}" fill="${S.OUT}"/>`,
    `<line x1="${spineX+OUT_R}" y1="${outY}" x2="${yBranchEnd}" y2="${outY}"
      stroke="${S.OUT}" stroke-width="2"/>`,
    `<text x="${yBranchEnd+5}" y="${outY}" text-anchor="start" dominant-baseline="central"
      font-family="${S.FONT}" font-size="13" font-weight="700" fill="${S.OUT}">Y</text>`
  );

  // ── Continuous spine from output node to NMOS topY ──────────────────────
  parts.push(`<line x1="${spineX}" y1="${outY+OUT_R}" x2="${spineX}" y2="${nmosRes.topY}"
    stroke="${S.WIRE}" stroke-width="2.5"/>`);

  // ── Internal backbone wire: from NMOS bottom out to GND ─────────────────
  // nmosRes.botY is the bottom of the NMOS block. GND symbol sits directly below.
  parts.push(`<line x1="${spineX}" y1="${nmosRes.botY}" x2="${spineX}" y2="${gndSymY}"
    stroke="${S.GND}" stroke-width="2.5"/>`);

  // ── GND signal symbol: connects DIRECTLY to nmosRes.botY ────────────────
  parts.push(sigGnd(spineX, gndSymY, S.GND, S.FONT));

  return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}"
    xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto">
    ${parts.join('\n    ')}
  </svg>`;
}
