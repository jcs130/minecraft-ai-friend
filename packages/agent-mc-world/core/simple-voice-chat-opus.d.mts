export const SVC_SAMPLE_RATE: 48000;
export const SVC_FRAME_SAMPLES: 960;
export const SVC_MAX_OPUS_BYTES: 4096;
export function pcm16Mono48kFromWav(wav: Buffer): Int16Array;
export function pcmFrames(pcm: Int16Array): Int16Array[];
export function createOfficialOpusCodec(options?: { jar?: string; javaPath?: string; classDir?: string; sourcePath?: string }): {
  kind?: string;
  encode(frame: Int16Array): Promise<Buffer> | Buffer;
  decode?(frame: Buffer): Promise<Int16Array> | Int16Array;
  close?(): void;
};

export function programFrames(wav:Buffer):{total:number; stream(offset:number):ReadableStream<Int16Array>};
