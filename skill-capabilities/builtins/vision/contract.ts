import type { CapabilityToolV2 } from '../../../packages/capability-api/src/manifest';
export const VISION_TOOLS: CapabilityToolV2[] = [{
  id:'review-images',description:'Rank up to five host-prepared image candidates for the ORIGINAL user request using the selected vision model. Requires imageId handles from host.vision.prepareImages, never URLs, files or invented handles. May select none. Text-only or unverified models return vision_unavailable; use metadata ranking. Maximum three rounds shared per turn. Never claim inspection before a reviewed result.',
  inputSchema:{type:'object',properties:{request:{type:'string',minLength:1,maxLength:20000},candidates:{type:'array',minItems:1,maxItems:5,items:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:80},imageId:{type:'string',minLength:1,maxLength:80}},required:['id','imageId'],additionalProperties:false}}},required:['request','candidates'],additionalProperties:false},
  artifactTypes:[],concurrency:1,answerMode:'replace-block',metered:true,billing:'per-call',timeoutMs:30000,maxPerReply:3,
}];
