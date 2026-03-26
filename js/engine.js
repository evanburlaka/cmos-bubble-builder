/**
 * engine.js - CMOS Logic Engine
 *
 * Converts a parsed Boolean expression (AST) into a static CMOS implementation.
 *
 * Responsibilities:
 * - Build NMOS pull-down network from Boolean logic
 * - Generate PMOS pull-up network via duality (De Morgan)
 * - Identify structural patterns (NAND, NOR, AOI, OAI, etc.)
 * - Surface design constraints (e.g., inverted inputs requiring pre-inversion)
 *
 * Notes:
 * - Assumes a single-stage static CMOS gate (must be wrapped in NOT)
 * - Deep nested inversions are intentionally restricted for clarity
 *
 * Network representation:
 *   TRANSISTOR → leaf device
 *   SERIES     → AND (NMOS)
 *   PARALLEL   → OR  (NMOS)
 */

class EngineError extends Error {}

function buildNmosNetwork(node) {
  switch (node.type) {
    case 'VAR':
      return { type: 'TRANSISTOR', var: node.name, inverted: false };

    case 'AND':
      return {
        type: 'SERIES',
        children: node.children.map(buildNmosNetwork)
      };

    case 'OR':
      return {
        type: 'PARALLEL',
        children: node.children.map(buildNmosNetwork)
      };

    case 'GROUP': {
      const inner = buildNmosNetwork(node.child);
      return {
        ...inner,
        explicitGroup: true
      };
    }

    case 'NOT':
      if (node.child.type === 'VAR') {
        return { type: 'TRANSISTOR', var: node.child.name, inverted: true };
      }
      throw new EngineError(
        `Deep nested inversion ~(${astToString(node.child)}) is not supported. Use a single outer NOT (e.g., ~(A & B)).`
      );
        
    default:
      throw new EngineError(`Unexpected node type: ${node.type}`);
  }
}

// Applies CMOS duality:
// - NMOS series ↔ PMOS parallel
// - NMOS parallel ↔ PMOS series
// (Implements De Morgan transformation at network level)
function dualNetwork(net) {
  switch (net.type) {
    case 'TRANSISTOR':
      return { ...net };

    case 'SERIES':
      return {
        type: 'PARALLEL',
        children: net.children.map(dualNetwork),
        explicitGroup: net.explicitGroup === true
      };

    case 'PARALLEL':
      return {
        type: 'SERIES',
        children: net.children.map(dualNetwork),
        explicitGroup: net.explicitGroup === true
      };

    default:
      throw new EngineError(`Unknown network type: ${net.type}`);
  }
}

function buildCmosNetworks(ast) {
  const warnings = [];

  if (ast.type !== 'NOT') {
    throw new EngineError(
      `Expression must start with NOT (~) for a single static CMOS gate.\n` +
      `Got top-level: "${ast.type}".\n` +
      `Hint: wrap your expression, e.g. ~(A & B)`
    );
  }

  const inner = ast.child;
  collectNestedNotWarnings(inner, warnings);

  const nmosNet = buildNmosNetwork(inner);
  const pmosNet = dualNetwork(nmosNet);
  const vars    = collectVars(ast);

  return { nmosNet, pmosNet, vars, warnings };
}

// Detects inverted inputs (~A) inside the expression.
// In CMOS, these require an upstream inverter (not implemented here).
function collectNestedNotWarnings(node, warnings) {
  if (node.type === 'NOT') {
    const varName = node.child && node.child.type === 'VAR' ? node.child.name : '?';
    warnings.push(`Inverted input detected: ~${varName}, transistor highlighted in orange. In a full implementation this requires an upstream inverter.`);
    return;
  }
  if (node.child) collectNestedNotWarnings(node.child, warnings);
  if (node.children) node.children.forEach(c => collectNestedNotWarnings(c, warnings));
}

function countTransistors(net) {
  if (net.type === 'TRANSISTOR') return 1;
  return net.children.reduce((s, c) => s + countTransistors(c), 0);
}

function isLeafTransistor(net) {
  return net.type === 'TRANSISTOR';
}

function isFlatGroup(net, type) {
  return net.type === type && net.children.every(isLeafTransistor);
}

function isTwoLevelAOI(net) {
  // NMOS parallel of terms, where each term is either:
  // - a single transistor
  // - a flat SERIES group of transistors
  if (net.type !== 'PARALLEL') return false;

  return net.children.every(child =>
    isLeafTransistor(child) || isFlatGroup(child, 'SERIES')
  );
}

function isTwoLevelOAI(net) {
  // NMOS series of terms, where each term is either:
  // - a single transistor
  // - a flat PARALLEL group of transistors
  if (net.type !== 'SERIES') return false;

  return net.children.every(child =>
    isLeafTransistor(child) || isFlatGroup(child, 'PARALLEL')
  );
}

function maxDepth(net) {
  if (net.type === 'TRANSISTOR') return 1;
  return 1 + Math.max(...net.children.map(maxDepth));
}

// Classifies NMOS network structure into common CMOS gate types.
// Used for educational labeling (not synthesis-grade classification).
function classifyGate(nmosNet, vars) {
  const n = vars.length;

  if (nmosNet.type === 'TRANSISTOR') {
    return 'Inverter (NOT)';
  }

  if (nmosNet.type === 'SERIES' && nmosNet.children.every(isLeafTransistor)) {
    return `${n}-input NAND`;
  }

  if (nmosNet.type === 'PARALLEL' && nmosNet.children.every(isLeafTransistor)) {
    return `${n}-input NOR`;
  }

  if (isTwoLevelAOI(nmosNet) && maxDepth(nmosNet) <= 3) {
    return 'AOI (AND-OR-Invert)';
  }

  if (isTwoLevelOAI(nmosNet) && maxDepth(nmosNet) <= 3) {
    return 'OAI (OR-AND-Invert)';
  }

  if (maxDepth(nmosNet) > 3) {
    return 'Nested compound CMOS gate';
  }

  return 'Complex CMOS gate';
}
