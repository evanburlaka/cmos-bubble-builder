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
const truthTableWrap = document.getElementById('truth-table-wrap');

const parseNoteEl   = document.getElementById('parse-note');
const implAlertEl   = document.getElementById('impl-alert');
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

  // Step 2: Convert AST to CMOS implementation
  let implementation;
  try {
    implementation = buildCmosNetworks(ast);
  } catch (e) {
    showError(e.message);
    return;
  }

  const {
    nmosNet,
    pmosNet,
    vars,
    warnings,
    needsOutputInverter,
    internalAst,
    requestedAst,
    gateType,
    coreTransistorCount,
    totalTransistorCount
  } = implementation;

  // Step 3: Generate truth table data
  let truthTable;
  try {
    truthTable = generateTruthTableRows(ast, {
      needsOutputInverter,
      internalAst
    });
  } catch (e) {
    showError('Truth table error: ' + e.message);
    return;
  }

  // Step 3: Display normalized expression + metadata (parse result card)
  normalizedEl.textContent = astToString(requestedAst);
  metaVars.textContent = vars.join(', ');

  if (needsOutputInverter) {
    metaCount.textContent = `${totalTransistorCount} (${coreTransistorCount}N + ${coreTransistorCount}P + 1 inverter)`;
    metaGate.textContent = `${gateType} + output inverter`;
  } else {
    metaCount.textContent = `${totalTransistorCount} (${coreTransistorCount}N + ${coreTransistorCount}P)`;
    metaGate.textContent = gateType;
  }

  parseNoteEl.textContent = needsOutputInverter
    ? 'This non-inverting Boolean expression is implemented in static CMOS as an inverting complex gate that produces X, followed by an output inverter that produces Y.'
    : 'This expression maps directly to a single inverting static CMOS gate, so Y is produced in one stage.';

  show(sectionParse);

  // Step 4: Render bubble diagram (topology view)
  try {
    bubbleDiv.innerHTML = renderBubbleDiagram(pmosNet, nmosNet, {
      needsOutputInverter
    });
  } catch (e) {
    bubbleDiv.innerHTML = errMsg('Bubble diagram error: ' + e.message);
    console.error(e);
  }

  // Step 5: Render transistor schematic
  try {
    schDiv.innerHTML = renderSchematic(pmosNet, nmosNet, {
      needsOutputInverter
    });
  } catch (e) {
    schDiv.innerHTML = errMsg('Schematic error: ' + e.message);
    console.error(e);
  }

  // Step 5b: Render truth table
  try {
    truthTableWrap.innerHTML = renderTruthTable(truthTable);
  } catch (e) {
    truthTableWrap.innerHTML = errMsg('Truth table render error: ' + e.message);
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

  if (needsOutputInverter) {
    implAlertEl.innerHTML = `
      <div class="impl-alert-box">
        <div class="impl-alert-title">Two-stage static CMOS implementation</div>
        <div class="impl-alert-line">Requested logic: Y = ${escapeHtml(astToString(requestedAst))}</div>
        <div class="impl-alert-line">Internal CMOS gate output: X = ${escapeHtml(astToString(internalAst))}</div>
        <div class="impl-alert-line">Final output: Y = ~X</div>
      </div>
    `;
    implAlertEl.classList.remove('hidden');
  } else {
    implAlertEl.innerHTML = '';
    implAlertEl.classList.add('hidden');
  }  

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
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function renderTruthTable(truthTable) {
  if (!truthTable || !truthTable.vars) {
    return '<div class="truth-empty">No truth table data available.</div>';
  }

  if (truthTable.tooLarge) {
    return `
      <div class="warn-item">
        ⚠  Truth table not shown: this expression has ${truthTable.vars.length} variables
        (${truthTable.totalRows.toLocaleString()} rows). Full truth table rendering is disabled for large inputs.
      </div>
    `;
  }

  if (!truthTable.rows) {
    return '<div class="truth-empty">No truth table data available.</div>';
  }

  const vars = truthTable.vars;
  const rows = truthTable.rows;
  const showInternalX = truthTable.needsOutputInverter === true;

  const headerHtml =
    vars.map(v => `<th>${v}</th>`).join('') +
    (showInternalX ? `<th class="output-cell">X (internal)</th>` : '') +
    `<th class="output-cell">Y (output)</th>`;

  const rowsHtml = rows.map(row => {
    const inputCells = vars.map(v => `<td>${row.inputs[v]}</td>`).join('');
    const xCell = showInternalX ? `<td class="output-cell">${row.internalX}</td>` : '';
    return `<tr>${inputCells}${xCell}<td class="output-cell">${row.output}</td></tr>`;
  }).join('');

  return `
    <table class="truth-table">
      <thead>
        <tr>${headerHtml}</tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}