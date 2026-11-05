const name = { type: 'string', minLength: 1, maxLength: 512 };
const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const review = { type: 'object', additionalProperties: false, required: ['reportRevision','decision','text'], properties: {
  reportRevision: revision, decision: {enum:['continue','release']}, text: {type:'string',maxLength:64000},
} };
const execution = { type:'object', additionalProperties:false, required:['kind','id','terminal'], properties: {
  kind:name, id:name, terminal:{type:'boolean'},
} };
const ref = {type:'object',additionalProperties:false,required:['world','kind','id'],properties:{world:name,kind:name,id:name}};

/** Bounded MCP projection of caller-supplied evidence; not server observations. */
export const workEvidenceProperties = {
  reportRecord: {type:'object',additionalProperties:false,required:['assignmentId','reportRevision','report'],properties:{
    assignmentId:name, reportRevision:revision, ended:{type:'boolean'}, review,
    report:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['status','text','evidence'],properties:{
      status:name,text:{type:'string',maxLength:64000},evidence:{type:'array',maxItems:256,items:name},
    }}]},
  }},
  review: {type:'object',additionalProperties:false,required:['assignmentId','expectedReportRevision','decision','text'],properties:{
    assignmentId:name, expectedReportRevision:revision, reportReceipt:{type:'string',pattern:'^[a-f0-9]{64}$'},
    decision:{enum:['continue','release']},text:{type:'string',minLength:1,maxLength:64000},
  }},
  observations:{type:'array',maxItems:256,items:{type:'object',additionalProperties:false,required:['world','at','execution'],properties:{
    world:name,at:{type:'number'},execution,
  }}},
  waitOptions:{type:'object',additionalProperties:false,required:['world','after'],properties:{
    world:name,after:{type:'number'},settled:{type:'array',maxItems:256,items:ref},
  }},
};
