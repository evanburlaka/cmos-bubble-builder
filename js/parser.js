/**
 * parser.js - Boolean Expression Parser
 *
 * Converts a user-provided Boolean expression string into an AST
 * used by the CMOS engine.
 *
 * Design choices:
 * - Recursive descent parser for simplicity and control over precedence
 * - Supports basic logic operators: OR (|), AND (&), NOT (~)
 * - Enforces explicit structure (no implicit precedence tricks)
 *
 * Output:
 * - Structured AST consumed by engine.js for CMOS network generation
 *
 * Grammar (precedence, low → high):
 *   expr     → or_expr
 *   or_expr  → and_expr ( '|' and_expr )*
 *   and_expr → not_expr ( '&' not_expr )*
 *   not_expr → '~' not_expr | atom
 *   atom     → '(' expr ')' | VAR
 */

class ParseError extends Error {}

// Stateful parser that walks the input string character-by-character
class Parser {
  constructor(src) {
    this.src = src.replace(/\s+/g, '');
    this.pos = 0;
  }
  peek()    { return this.src[this.pos]; }
  consume() { return this.src[this.pos++]; }
  expect(ch) {
    if (this.peek() !== ch)
      throw new ParseError(`Expected '${ch}' at position ${this.pos}, got '${this.peek() ?? 'end'}'`);
    this.consume();
  }
  // Entry point: parses full expression and ensures no trailing tokens
  parse() {
    const node = this.parseOr();
    if (this.pos < this.src.length)
      throw new ParseError(`Unexpected character '${this.peek()}' at position ${this.pos}`);
    return node;
  }
  parseOr() {
    const children = [this.parseAnd()];
    while (this.peek() === '|') { this.consume(); children.push(this.parseAnd()); }
    return children.length === 1 ? children[0] : { type: 'OR', children };
  }
  parseAnd() {
    const children = [this.parseNot()];
    while (this.peek() === '&') { this.consume(); children.push(this.parseNot()); }
    return children.length === 1 ? children[0] : { type: 'AND', children };
  }
  // Handles chained NOT (~ ~A) via recursion
  parseNot() {
    if (this.peek() === '~') { this.consume(); return { type: 'NOT', child: this.parseNot() }; }
    return this.parseAtom();
  }
  parseAtom() {
    const ch = this.peek();
    if (ch === '(') {
      this.consume();
      const node = this.parseOr();
      this.expect(')');
      return { type: 'GROUP', child: node };
    }
    if (ch && /[A-Za-z]/.test(ch)) {
      this.consume();
      return { type: 'VAR', name: ch.toUpperCase() };
    }
    throw new ParseError(`Unexpected token '${ch ?? 'end'}' at position ${this.pos}`);
  }
}

function parseExpression(src) {
  if (!src || !src.trim()) throw new ParseError('Empty expression');
  return new Parser(src.trim()).parse();
}

// Converts AST back into a normalized, readable Boolean expression
function astToString(node, parentPrec = 0) {
  switch (node.type) {
    case 'VAR': return node.name;
    case 'NOT': {
      const inner = astToString(node.child, 3);
      return `~${needsParens(node.child, 3) ? `(${inner})` : inner}`;
    }
    case 'AND': {
      const parts = node.children.map(c => {
        const s = astToString(c, 2);
        return needsParens(c, 2) ? `(${s})` : s;
      });
      const s = parts.join(' & ');
      return parentPrec > 2 ? `(${s})` : s;
    }
    case 'OR': {
      const parts = node.children.map(c => {
        const s = astToString(c, 1);
        return needsParens(c, 1) ? `(${s})` : s;
      });
      const s = parts.join(' | ');
      return parentPrec > 1 ? `(${s})` : s;
    }
    case 'GROUP': {
      const inner = astToString(node.child, 0);
      return `(${inner})`;
    }
    default: return '?';
  }
}

function needsParens(node, parentPrec) {
  if (node.type === 'OR'  && parentPrec > 1) return true;
  if (node.type === 'AND' && parentPrec > 2) return true;
  return false;
}

// Extracts and returns sorted list of unique variables in the expression
function collectVars(node) {
  const vars = new Set();
  function walk(n) {
    if (n.type === 'VAR') { vars.add(n.name); return; }
    if (n.child) walk(n.child);
    if (n.children) n.children.forEach(walk);
  }
  walk(node);
  return [...vars].sort();
}

// Evaluates a Boolean AST for one specific input assignment.
// Example:
//   ast = expression for ~(A & B)
//   values = { A: 1, B: 0 }
//   returns 1
function evaluateAst(node, values) {
  switch (node.type) {
    case 'VAR': {
      const val = values[node.name];
      if (val !== 0 && val !== 1) {
        throw new Error(`Missing or invalid value for variable "${node.name}"`);
      }
      return val;
    }

    case 'NOT':
      return evaluateAst(node.child, values) ? 0 : 1;

    case 'AND':
      return node.children.every(child => evaluateAst(child, values) === 1) ? 1 : 0;

    case 'OR':
      return node.children.some(child => evaluateAst(child, values) === 1) ? 1 : 0;

    case 'GROUP':
      return evaluateAst(node.child, values);

    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
}

// Generates all truth table rows for a parsed Boolean expression.
// Returns an object like:
// {
//   vars: ['A', 'B'],
//   rows: [
//     { inputs: { A: 0, B: 0 }, output: 1 },
//     ...
//   ]
// }
function generateTruthTableRows(ast) {
  const vars = collectVars(ast);
  const rows = [];
  const totalRows = Math.pow(2, vars.length);

  for (let i = 0; i < totalRows; i++) {
    const inputs = {};

    for (let j = 0; j < vars.length; j++) {
      const bitIndex = vars.length - 1 - j;
      inputs[vars[j]] = (i >> bitIndex) & 1;
    }

    const output = evaluateAst(ast, inputs);
    rows.push({ inputs, output });
  }

  return { vars, rows };
}