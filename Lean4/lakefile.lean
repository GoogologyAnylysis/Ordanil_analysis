import Lake
open Lake DSL

require mathlib from git
  "https://github.com/leanprover-community/mathlib4" @ "v4.30.0-rc2"

package googology where
  -- add package configuration here

@[default_target]
lean_lib Googology where
  -- add library configuration here
