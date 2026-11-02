import { privateObjectClient } from './private-object-client.mjs';
/** Private scene objects only. Credentials are short-lived ECS role tokens;
 * no access key, token or signed URL is stored in the gallery database. */
export function createSceneObjectStorage(config,{clientFactory}={}){
  if(!config?.enabled)return null;
  const client=privateObjectClient(config,{clientFactory});
  const key=value=>{if(!/^(?:scenes\/[a-f0-9]{64}\.mcscene\.gz|assets\/[a-f0-9]{64})$/.test(value))throw Error('SCENE_OBJECT_KEY');return config.prefix+value;};
  return{
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
