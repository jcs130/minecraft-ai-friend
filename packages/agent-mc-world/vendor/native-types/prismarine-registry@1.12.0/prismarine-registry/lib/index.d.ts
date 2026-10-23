import { IndexedData } from '../../../minecraft-data@3.117.0/minecraft-data/index.js'
import { NBT } from '../../../prismarine-nbt@2.8.0/prismarine-nbt/typings/index.js'

declare function loader(mcVersion: string): loader.Registry
declare namespace loader {
  export interface RegistryPc extends IndexedData {
    loadDimensionCodec(codec: NBT): void;
    writeDimensionCodec(): NBT;
  }
  
  export interface RegistryBedrock extends IndexedData {
    handleStartGame(packet: any): void;
    writeItemStates(): ItemState[];
  }
  
  export type Registry = RegistryBedrock | RegistryPc
  export type ItemState = {
    name: string
    runtime_id: number
    component_based: boolean
  }
}

export = loader