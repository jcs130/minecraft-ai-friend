/** JSON IPC preserves byte attachments for both tool replies and World events. */
import type { BlobInput } from './support/host-contract.ts';
import type { IpcBlob } from './engine-ipc.ts';

export function encodeBlobs(blobs: BlobInput[] | undefined): IpcBlob[] | undefined {
  return blobs?.map(b => 'bytes' in b ? { b64: Buffer.from(b.bytes).toString('base64'),
    mime: b.mime, fallbackText: b.fallbackText, ...(b.name ? { name: b.name } : {}) } : b);
}

export function decodeBlobs(blobs: IpcBlob[] | undefined): BlobInput[] | undefined {
  return blobs?.map(b => 'b64' in b ? { bytes: Buffer.from(b.b64, 'base64'),
    mime: b.mime, fallbackText: b.fallbackText, ...(b.name ? { name: b.name } : {}) } : b);
}
