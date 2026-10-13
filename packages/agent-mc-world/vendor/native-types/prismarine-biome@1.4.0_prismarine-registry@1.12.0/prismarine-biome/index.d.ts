import Registry from '../../prismarine-registry@1.12.0/prismarine-registry/lib/index.js'

declare class Biome {
  id: number
  name: string
  category?: string
  precipitation?: string
  depth?: number
  dimension?: string
  displayName?: string
  color?: number
  rainfall: number
  temperature: number
  height?: number | null

  constructor(id: number)
}


/** @deprecated */
export default function loader(mcVersion: string): typeof Biome
export default function loader(registry: ReturnType<typeof Registry>): typeof Biome
