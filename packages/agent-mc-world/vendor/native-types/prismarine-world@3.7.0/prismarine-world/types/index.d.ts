import { World } from "./world.js";

export * as iterators from "./iterators.js";

// Make public the types related to World, but not the classes
// (since they aren't exported in js)
import type * as world from "./world.js";
export { world };

export default function loader(mcVersion: string): typeof World;
