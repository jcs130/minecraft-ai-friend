/** Parse the three doubles returned by `data get entity <name> Pos`. */
export function parseNbtPosition(text: string): [number, number, number] | null {
  const number = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`
  const component = `(${number})[dD]?`
  const match = new RegExp(`\\[\\s*${component}\\s*,\\s*${component}\\s*,\\s*${component}\\s*\\]\\s*$`).exec(text)
  if (!match) return null
  const values = match.slice(1).map(Number)
  return values.every(Number.isFinite) ? values as [number, number, number] : null
}
