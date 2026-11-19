import { privateObjectClient } from './private-object-client.mjs';
/** Private scene objects only. Credentials are short-lived ECS role tokens;
 * no access key, token or signed URL is stored in the gallery database. */
export function createSceneObjectStorage(config,{clientFactory}={}){
  if(!config?.enabled)return null;
  const client=privateObjectClient(config,{clientFactory});
  const key=value=>{if(!/^(?:scenes\/[a-f0-9]{64}\.mcscene\.gz|assets\/[a-f0-9]{64})$/.test(value))throw Error('SCENE_OBJECT_KEY');return config.prefix+value;};
  function photoKey(source,kind){
    if(!/^[a-f0-9]{64}$/.test(source)||!['thumbnail','original'].includes(kind))throw Error('GALLERY_OBJECT_KEY');
    return config.prefix+'gallery/v1/'+source+(kind==='thumbnail'?'.512.jpg':'.png');
  }
  async function storePhoto(oss,name,bytes,digest,type){
    async function check(){
      const result=await oss.head(name),h=result.res.headers;
      if(h['x-oss-meta-sha256']!==digest||Number(h['content-length'])!==bytes.length)throw Error('GALLERY_OBJECT_CONFLICT');
    }
    try{await check();return;}catch(e){if(e.code!=='NoSuchKey')throw e;}
    try{await oss.put(name,bytes,{headers:{'Content-Type':type,'Cache-Control':'private, no-cache','x-oss-object-acl':'private','x-oss-forbid-overwrite':'true','x-oss-meta-sha256':digest}});}
    catch(e){if(e.code!=='FileAlreadyExists')throw e;}
    await check();
  }
  return{
    origin:'https://'+config.bucket+'.'+config.region+'.aliyuncs.com',
    async publishPhotoMedia(source,png,jpeg,digest){
      const oss=await client();
      await storePhoto(oss,photoKey(source,'original'),png,source,'image/png');
      await storePhoto(oss,photoKey(source,'thumbnail'),jpeg,digest,'image/jpeg');
    },
    async photoLocation(source,kind){
      const oss=await client();
      return oss.asyncSignatureUrl(photoKey(source,kind),{expires:60,response:{'content-disposition':'inline','cache-control':'private, no-cache'}});
    },
    async readScene(source,bytes){
      if(!Number.isSafeInteger(bytes)||bytes<1||bytes>32*1024*1024)throw Error('SCENE_OBJECT_SIZE');
      const result=await (await client()).get(key('scenes/'+source+'.mcscene.gz'),{headers:{Range:'bytes=0-'+(bytes-1)}});
      if(!Buffer.isBuffer(result.content)||result.content.length!==bytes)throw Error('SCENE_OBJECT_SIZE');
      return result.content;
    },
    async put(object,bytes,{sha256,contentType}){
      if(!Buffer.isBuffer(bytes)||!['application/gzip','application/octet-stream'].includes(contentType))throw Error('SCENE_OBJECT_BODY');
      const oss=await client(),name=key(object);
      try{const old=await oss.head(name);if(old.res.headers['x-oss-meta-sha256']!==sha256||Number(old.res.headers['content-length'])!==bytes.length)throw Error('SCENE_OBJECT_CONFLICT');return;}catch(error){if(error.code!=='NoSuchKey')throw error;}
      await oss.put(name,bytes,{headers:{'x-oss-object-acl':'private','x-oss-forbid-overwrite':'true','x-oss-meta-sha256':sha256,'Content-Type':contentType,'Cache-Control':'private, max-age=31536000, immutable'}});
      const after=await oss.head(name);if(after.res.headers['x-oss-meta-sha256']!==sha256||Number(after.res.headers['content-length'])!==bytes.length)throw Error('SCENE_OBJECT_VERIFY');
    },
    async download(object,filename){const oss=await client();return oss.asyncSignatureUrl(key(object),{expires:60,response:{'content-disposition':'attachment; filename="'+filename+'"','cache-control':'private, no-store'}});}
    ,async assetUpload(sha256,bytes){
      const oss=await client(),name=key('assets/'+sha256);
      try{const row=await oss.head(name);if(row.res.headers['x-oss-meta-sha256']!==sha256||Number(row.res.headers['content-length'])!==bytes)throw Error('SCENE_OBJECT_CONFLICT');return{present:true};}catch(error){if(error.code!=='NoSuchKey')throw error;}
      const headers={'Content-Type':'application/octet-stream','x-oss-object-acl':'private','x-oss-forbid-overwrite':'true','x-oss-meta-sha256':sha256};
      return{present:false,uploadUrl:await oss.asyncSignatureUrl(name,{method:'PUT',expires:300,...headers}),headers};
    },async assetPresent(sha256,bytes){const oss=await client();try{const row=await oss.head(key('assets/'+sha256));return row.res.headers['x-oss-meta-sha256']===sha256&&Number(row.res.headers['content-length'])===bytes;}catch(error){if(error.code==='NoSuchKey')return false;throw error;}}
  };
}
