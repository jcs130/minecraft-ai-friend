// Bounded image legibility measurements. These do not claim to judge artistic beauty.
export function photoImageQuality({width,height,data}) {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||data.length!==width*height*4) throw Error('PHOTO_PIXELS_INVALID');
  let sum=0,squared=0,dark=0,bright=0,count=0;
  const stride=Math.max(1,Math.ceil(Math.max(width,height)/96));
  for(let y=0;y<height;y+=stride)for(let x=0;x<width;x+=stride){
    const i=(y*width+x)*4,alpha=data[i+3]/255;
    const l=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])*alpha;
    count++;sum+=l;squared+=l*l;if(l<12)dark++;if(l>248)bright++;
  }
  return {width,height,darkFraction:dark/count,brightFraction:bright/count,contrast:Math.sqrt(Math.max(0,squared/count-(sum/count)**2))};
}
