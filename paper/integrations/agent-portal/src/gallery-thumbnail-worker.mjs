import {parentPort, workerData} from 'node:worker_threads';
import {PNG} from 'pngjs';
import jpeg from 'jpeg-js';

// Decode off the HTTP event loop. Originals have already passed gallery size and digest checks.
const input = Buffer.from(workerData);
const width = input.readUInt32BE(16), height = input.readUInt32BE(20);
if (!width || !height || width > 4096 || height > 4096) throw Error('PHOTO_SIZE');
const source = PNG.sync.read(input);
const scale = Math.min(1, 512 / Math.max(width, height));
const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
const rgba = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) {
  const top = Math.floor(y * height / h), bottom = Math.floor((y + 1) * height / h);
  for (let x = 0; x < w; x++) {
    const left = Math.floor(x * width / w), right = Math.floor((x + 1) * width / w);
    const total = (right-left)*(bottom-top), dst = (y*w+x)*4;
    let red = 0, green = 0, blue = 0;
    for (let j=top; j<bottom; j++) for (let i=left; i<right; i++) {
      const idx=(j*width+i)*4, alpha=source.data[idx+3]/255, bg=255*(1-alpha);
      red+=source.data[idx]*alpha+bg; green+=source.data[idx+1]*alpha+bg; blue+=source.data[idx+2]*alpha+bg;
    }
    rgba[dst]=Math.round(red/total); rgba[dst+1]=Math.round(green/total); rgba[dst+2]=Math.round(blue/total); rgba[dst+3]=255;
  }
}
const encoded = jpeg.encode({data:rgba, width:w, height:h}, 80).data;
parentPort.postMessage(encoded);
