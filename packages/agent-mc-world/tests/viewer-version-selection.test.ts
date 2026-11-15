import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertViewerVersion, selectViewerAssets, viewerVersionOrderKey, viewerVersionTexture } from '../core/viewer-version.mjs';

describe('viewerVersionOrderKey', () => {
  it('places year-based 26.x after the 1.21 line so 1.21.11 is closer than 1.20.6', () => {
    expect(assertViewerVersion('26.1')).toBe('26.1');
    const target = viewerVersionOrderKey('26.1');
    const distance = (version: string) => Math.abs(target - viewerVersionOrderKey(version));
    expect(distance('1.21.11')).toBeLessThan(distance('1.21.5'));
    expect(distance('1.21.5')).toBeLessThan(distance('1.21.1'));
    expect(distance('1.21.1')).toBeLessThan(distance('1.20.6'));
  });
});

describe('selectViewerAssets for Java 26.1', () => {
  it('selects the newest 1.21 pack as compatible materials when 26.1 is not packaged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-viewer-26-'));
    try {
      const pack = async (directory: string, version: string) => {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'viewer-assets.json'), JSON.stringify({ minecraftVersion: version }));
        await writeFile(join(directory, 'viewer-client.json'), JSON.stringify({
          minecraftVersion: version, runtimeRegistryVersion: 1, preset: null,
        }));
      };
      await pack(root, '1.21.1');
      for (const version of ['1.20.6', '1.21.5', '1.21.11']) {
        await pack(join(root, 'versions', version), version);
      }
      await expect(selectViewerAssets(root, '26.1')).resolves.toEqual({
        directory: join(root, 'versions', '1.21.11'),
        requestedVersion: '26.1',
        assetVersion: '1.21.11',
        mode: 'compatible',
      });
      await expect(selectViewerAssets(root, '1.21.11')).resolves.toMatchObject({
        directory: join(root, 'versions', '1.21.11'), assetVersion: '1.21.11', mode: 'exact',
      });
    } finally {
      expect(dirname(root)).toBe(resolve(tmpdir()));
      expect(root.split(/[\\/]/).at(-1)).toMatch(/^mc-viewer-26-/);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prefers an exact 26.1 pack over the compatible 1.21.11 fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-viewer-26-exact-'));
    try {
      const pack = async (directory: string, version: string) => {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'viewer-assets.json'), JSON.stringify({ minecraftVersion: version }));
        await writeFile(join(directory, 'viewer-client.json'), JSON.stringify({
          minecraftVersion: version, runtimeRegistryVersion: 1, preset: null,
        }));
      };
      await pack(root, '1.21.1');
      for (const version of ['1.20.6', '1.21.5', '1.21.11', '26.1']) {
        await pack(join(root, 'versions', version), version);
      }
      await expect(selectViewerAssets(root, '26.1')).resolves.toEqual({
        directory: join(root, 'versions', '26.1'),
        requestedVersion: '26.1',
        assetVersion: '26.1',
        mode: 'exact',
      });
      await expect(selectViewerAssets(root, '1.21.11')).resolves.toMatchObject({
        directory: join(root, 'versions', '1.21.11'), assetVersion: '1.21.11', mode: 'exact',
      });
    } finally {
      expect(dirname(root)).toBe(resolve(tmpdir()));
      expect(root.split(/[\\/]/).at(-1)).toMatch(/^mc-viewer-26-exact-/);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('viewerVersionTexture for Java 26.1', () => {
  it('remaps official 26.1 projectile names and leaves 1.21.11 names unchanged', () => {
    expect(viewerVersionTexture('textures/entity/projectiles/spectral_arrow.png', '26.1'))
      .toBe('textures/26.1/entity/projectiles/arrow_spectral.png');
    expect(viewerVersionTexture('textures/entity/projectiles/tipped_arrow.png', '26.1'))
      .toBe('textures/26.1/entity/projectiles/arrow_tipped.png');
    expect(viewerVersionTexture('textures/entity/projectiles/arrow.png', '26.1'))
      .toBe('textures/26.1/entity/projectiles/arrow.png');
    expect(viewerVersionTexture('textures/entity/projectiles/spectral_arrow.png', '1.21.11'))
      .toBe('textures/1.21.11/entity/projectiles/spectral_arrow.png');
    expect(viewerVersionTexture('textures/entity/projectiles/tipped_arrow.png', '1.21.11'))
      .toBe('textures/1.21.11/entity/projectiles/tipped_arrow.png');
  });
});

it('resolves genuine named 26.1 llama-spit and trident resources',()=>{
 expect(viewerVersionTexture('textures/26.1/entity/llama/spit.png','26.1')).toBe('textures/26.1/entity/llama/llama_spit.png');
 expect(viewerVersionTexture('textures/1.16.4/entity/trident.png','26.1')).toBe('textures/26.1/entity/trident/trident.png');
});
