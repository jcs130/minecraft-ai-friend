/// <reference types="node" />

import {EventEmitter} from 'events';
import { Vec3 } from '../../vec3@0.2.0/vec3/index.js';
import { Item } from '../../prismarine-item@1.18.0/prismarine-item/index.js';
import { ChatMessage } from '../../prismarine-chat@1.13.0/prismarine-chat/index.js';

declare module './index.js' {
    export interface Effect {
        id: number;
        amplifier: number;
        duration: number;
    }

    export class Entity extends EventEmitter {
        constructor(id: number);
        id: number;
        type: EntityType;
        uuid?: string;
        username?: string;
        mobType?: string;
        displayName?: string;
        entityType?: number;
        kind?: string;
        name?: string;
        objectType?: string;
        count?: number;
        position: Vec3;
        velocity: Vec3;
        yaw: number;
        pitch: number;
        height: number;
        width: number;
        onGround: boolean;
        equipment: Array<Item>;
        get heldItem(): Item;
        metadata: Array<object>;
        isValid: boolean;
        health?: number;
        food?: number;
        foodSaturation?: number;
        elytraFlying?: boolean
        player?: object;
        effects: Effect[];
        vehicle: Entity;
        passengers: Entity[];
        setEquipment(index: number, item: Item): void;
        getCustomName(): ChatMessage | null;
        getDroppedItem(): Item | null;
    }

    export type EntityType = 'player' | 'mob' | 'object' | 'global' | 'orb' | 'projectile'| 'hostile' | 'other';
}
