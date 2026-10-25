import {getViewer} from '@/app/_lib/viewer';
import {createServerSupabase} from '@/db/server';
import {HUB} from '@/lib/base';
const allowed=new Set(['home','guru','feedback','password','users','settings','feedback_admin','activity','apartments','knowledge','team','audit','apartment_detail','history','packing_history','status','entrances']);
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin&&origin!==HUB)return Response.json({ok:false},{status:403});
 const viewer=await getViewer();if(!viewer?.active||viewer.dev)return Response.json({ok:false},{status:403});
 const body=await request.json().catch(()=>null);if(!body||!allowed.has(body.page))return Response.json({ok:false},{status:400});
 const s=await createServerSupabase();if(!s)return Response.json({ok:false},{status:503});
 const {error}=await s.rpc('record_app_usage',{app_key:'pracovna',page_key:body.page});
 return Response.json({ok:!error},{status:error?503:200});
}
