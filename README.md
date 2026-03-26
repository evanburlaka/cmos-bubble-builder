# CMOS Bubble Builder

CMOS Bubble Builder is an educational tool that converts Boolean expressions into a CMOS bubble diagram and transistor-level schematic.

The goal is to make it easier to see how a Boolean expression maps into complementary PMOS and NMOS transistor networks in static CMOS design.

## What it does

Given a valid Boolean expression, the tool:

- parses the expression
- builds the NMOS pull-down network
- builds the PMOS pull-up network using CMOS duality
- identifies the general gate structure
- renders both a bubble diagram and transistor-level schematic

## Supported syntax

- `~` for NOT
- `&` for AND
- `|` for OR
- parentheses `( )` for grouping

Examples:

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