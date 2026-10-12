// Scoped OpenAPI code generation; no dependency, no handwritten duplicate DTO contract.
import { readFile,writeFile } from 'node:fs/promises';
const names=['CreateAppointmentDto','AppointmentActionDto','AppointmentResponseDto','HostAppointmentResponseDto','NotificationResponseDto','CostEstimateLineDto','CostEstimateDto'];
const api=process.env.OPENAPI_URL||'http://localhost:5000/api/docs-json';
const response=await fetch(api,{redirect:'error',signal:AbortSignal.timeout(10000)});
if(!response.ok) throw new Error(`OpenAPI unavailable (${response.status})`);
const document=await response.json();
function type(schema) {
  if(schema.$ref) return schema.$ref.split('/').at(-1);
  let result;
  if(schema.enum) result=schema.enum.map(value=>JSON.stringify(value)).join(' | ');
  else if(schema.type==='string') result='string';
  else if(schema.type==='number'||schema.type==='integer') result='number';
  else if(schema.type==='boolean') result='boolean';
  else if(schema.type==='array') result=`(${type(schema.items)})[]`;
  else throw new Error('Unsupported schema; update generator explicitly rather than generate unsafe any');
  return result+(schema.nullable?' | null':'');
}
const declarations=names.map(name=>{
  const schema=document.components?.schemas?.[name];
  if(!schema?.properties) throw new Error(`Missing OpenAPI schema ${name}`);
  return `export type ${name} = {\n${Object.entries(schema.properties).map(([key,value])=>`  ${key}${schema.required?.includes(key)?'':'?'}: ${type(value)};`).join('\n')}\n};`;
});
const output='// Generated from backend OpenAPI. Run node scripts/generate-appointment-types.mjs; do not hand-edit.\n'+declarations.join('\n\n')+'\n';
const destination=new URL('../src/lib/api/appointment-types.generated.ts',import.meta.url);
if(process.argv.includes('--check')) {
  if(await readFile(destination,'utf8')!==output) throw new Error('Appointment types differ from current OpenAPI; regenerate them.');
} else await writeFile(destination,output);
console.log(`Appointment OpenAPI types ${process.argv.includes('--check')?'verified':'generated'} (${names.length} schemas).`);
