/**
 * app.js - UI controller for CMOS Bubble Builder
 *
 * Responsibilities:
 * - Handles user input and UI events
 * - Runs the core pipeline (parse → CMOS network → render)
 * - Updates DOM with results (diagram, schematic, metadata)
 *
 * Note: All computation is handled in parser/engine/renderer modules.
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const exprInput    = document.getElementById('expr-input');
const parseBtn     = document.getElementById('parse-btn');
const errorBox     = document.getElementById('error-box');
const sectionParse = document.getElementById('section-parse');
const outputArea   = document.getElementById('output-area');
const normalizedEl = document.getElementById('normalized-expr');
const metaVars     = document.getElementById('meta-vars');
const metaCount    = document.getElementById('meta-count');
const metaGate     = document.getElementById('meta-gate');
const bubbleDiv    = document.getElementById('bubble-diagram');
const schDiv       = document.getElementById('schematic-diagram');
const warnDiv      = document.getElementById('schematic-warnings');

const bubbleWarnDiv = document.getElementById('bubble-warnings');
// ── Example chips ─────────────────────────────────────────────────────────────
document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    exprInput.value = btn.dataset.expr;
    run();
  });
});

// ── Parse button / Enter ──────────────────────────────────────────────────────
parseBtn.addEventListener('click', run);
exprInput.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ── Main execution pipeline (input → parse → CMOS → render) ───────────────────
// Executes full pipeline from user input to rendered output
function run() {
  const raw = exprInput.value.trim();
  hideError();
  hide(sectionParse);
  hide(outputArea);

  if (!raw) { showError('Please enter a Boolean expression.'); return; }

  // Step 1: Parse Boolean expression into AST
  let ast;
  try { ast = parseExpression(raw); }
  catch (e) { showError('Parse error: ' + e.message); return; }

  // Step 2: Convert AST to CMOS pull-up / pull-down networks
  let nmosNet, pmosNet, vars, warnings;
  try { ({ nmosNet, pmosNet, vars, warnings } = buildCmosNetworks(ast)); }
  catch (e) { showError(e.message); return; }

  // Step 3: Display normalized expression + metadata (parse result card)
  normalizedEl.textContent = astToString(ast);
  metaVars.textContent     = vars.join(', ');
  const nCount = countTransistors(nmosNet);
  metaCount.textContent    = `${nCount * 2} (${nCount}N + ${nCount}P)`;
  metaGate.textContent     = classifyGate(nmosNet, vars);
  show(sectionParse);

  // Step 4: Render bubble diagram (topology view)
  try {
    bubbleDiv.innerHTML = renderBubbleDiagram(pmosNet, nmosNet);
  } catch (e) {
    bubbleDiv.innerHTML = errMsg('Bubble diagram error: ' + e.message);
    console.error(e);
  }

  // Step 5: Render transistor schematic
  try {
    schDiv.innerHTML = renderSchematic(pmosNet, nmosNet);
  } catch (e) {
    schDiv.innerHTML = errMsg('Schematic error: ' + e.message);
    console.error(e);
  }

  // Step 6: Display warnings (e.g., inverted inputs
  bubbleWarnDiv.innerHTML = '';
  warnDiv.innerHTML = '';

  (warnings || []).forEach(w => {
    const bubbleItem = document.createElement('div');
    bubbleItem.className = 'warn-item';
    bubbleItem.textContent = '⚠  ' + w;
    bubbleWarnDiv.appendChild(bubbleItem);

    const schematicItem = document.createElement('div');
    schematicItem.className = 'warn-item';
    schematicItem.textContent = '⚠  ' + w;
    warnDiv.appendChild(schematicItem);
  });

  show(outputArea);
  if (window.innerWidth < 900) {
    setTimeout(() => outputArea.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}
function hideError() {
  errorBox.classList.add('hidden');
  errorBox.textContent = '';
}
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function errMsg(msg) {
  return `<span style="color:#dc2626;font-family:IBM Plex Mono,monospace;font-size:12px;padding:16px;display:block">${msg}</span>`;
}
