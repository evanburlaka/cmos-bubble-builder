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

The tool supports both top-level inverting and top-level non-inverting Boolean expressions.

For top-level inverting expressions such as:

- `~A`
- `~(A & B)`
- `~(A | B)`
- `~((A & B) | C)`
- `~((A | B) & (C | D))`

the function is implemented as a single inverting static CMOS stage, and the final output is labeled `Y`.

For top-level non-inverting expressions such as:

- `A`
- `(A & B)`
- `(A | B)`
- `((A & B) | C)`
- `((A | B) & (C | D))`

the tool implements the requested logic using the correct two-stage static CMOS structure:

- first, an inverting CMOS complex gate produces the internal node `X`
- then, a final inverter stage produces the final output `Y`

Example:

- requested logic: `((A | B) & (C | D))`
- internal node: `X = ~((A | B) & (C | D))`
- final output: `Y = ~X`

This keeps the implementation honest to static CMOS behavior rather than treating a non-inverting expression as a single CMOS complex gate.

The truth table feature reflects this structure:
- inverting top-level expressions show inputs plus final output `Y`
- non-inverting top-level expressions show inputs, internal node `X`, and final output `Y`

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
- Static CMOS complex gates are inherently inverting
- Non-inverting top-level logic is implemented using an added output inverter stage
- Large truth tables are automatically limited to prevent excessive rendering

## Example expressions

```text
~A
A
~(A & B)
(A & B)
~(A | B)
(A | B)
~((A & B) | C)
((A & B) | C)
~((A | B) & (C | D))
((A | B) & (C | D))
```


Independent project by Evan Burlaka  
Developed alongside CPE 151 (CMOS and Digital VLSI Design)  
California State University, Sacramento