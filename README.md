# CMOS Bubble Builder

CMOS Bubble Builder is an educational tool that converts Boolean expressions into a CMOS bubble diagram, transistor-level schematic, and truth table.

The goal is to make it easier to see how a Boolean expression maps into complementary PMOS and NMOS transistor networks in static CMOS design, while also validating the logic behavior of the expression.

## What it does

Given a valid Boolean expression, the tool:

- parses the expression
- normalizes the expression for display
- builds the NMOS pull-down network
- builds the PMOS pull-up network using CMOS duality
- identifies the general gate structure
- renders a CMOS bubble diagram
- renders a transistor-level schematic
- generates a truth table for the entered expression

## Current scope

The current implementation is designed around single-stage static CMOS logic, so the main CMOS rendering flow currently expects expressions with a top-level NOT, such as:

- `~(A & B)`
- `~(A | B)`
- `~((A & B) | C)`
- `~((A & B) | (C & D))`
- `~((A | B) & C)`

These map cleanly to inverting static CMOS gates.

The truth table feature evaluates the Boolean expression directly and is included as an additional validation aid.

## Supported syntax

- `~` for NOT
- `&` for AND
- `|` for OR
- parentheses `( )` for grouping

## Notes

- Operator precedence is:
  - `~` highest
  - `&` next
  - `|` lowest
- Use parentheses when grouping matters
- Large truth tables are automatically limited to prevent excessive rendering

## Example expressions

```text
~(A & B)
~(A | B)
~((A & B) | C)
~((A & B) | (C & D))
~((A | B) & C)
```


Independent project by Evan Burlaka  
Developed alongside CPE 151 (CMOS and Digital VLSI Design)  
California State University, Sacramento