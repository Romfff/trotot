// Production route with isolated fixtures; unavailable map avoids any source tile traffic during width sweep.
import {fixtureFrontend} from './fixture-frontend.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve} from 'node:path';
const room={id:'isolated',title:'Fixture Nearby — không phải tin thật',slug:'nearby-fixture',addressDetail:'Địa chỉ test',monthlyPrice:3500000,depositAmount:3500000,areaSqm:25,electricityCost:0,waterCost:0,waterUnit:'M3',internetCost:0,garbageCost:0,parkingFee:0,images:[],amenities:[],isAvailable:true,host:{fullName:'Host fixture'},description:'Fixture kiểm thử cô lập.'};
const fixture=await fixtureFrontend('.',()=>({success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}),()=>room,()=>({status:'UNAVAILABLE',groups:[],updatedAt:null}));
try{
 const child=spawn(process.execPath,[resolve('../.agents/skills/ui-ux/scripts/probe.mjs'),`${fixture.baseUrl}/thue-phong-tro/nearby-fixture`,
  '--pw','C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node','--widths','375,1440','--sweep','1440,375,20','--out',resolve('../.tmp/nearby-probe-20261010')],{stdio:'inherit',windowsHide:true});
 const [code]=await once(child,'exit');if(code)process.exitCode=code;
}finally{await fixture.close();}
