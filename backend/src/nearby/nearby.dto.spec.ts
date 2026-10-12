import {describe,it,expect} from 'vitest';
import {plainToInstance} from 'class-transformer';
import {validateSync} from 'class-validator';
import {NearbyQueryDto,NearbyVisibilityDto,nearbyResponseSchema,nearbyAdminSchema} from './nearby.dto.js';
describe('Nearby DTO and public/Admin response contracts',()=>{
 it('accepts page 20 with limit 1 so every capped item remains reachable',()=>{
  const query=plainToInstance(NearbyQueryDto,{group:'MARKETS',page:'20',limit:'1'});expect(validateSync(query)).toEqual([]);expect(query.page).toBe(20);
 });
 it.each([{page:'0'},{page:'21'},{page:'1.5'},{limit:'6'},{limit:'0'},{group:'UNKNOWN'},{snapshotVersion:'../other'}])('rejects invalid query %j',input=>{
  expect(validateSync(plainToInstance(NearbyQueryDto,input)).length).toBeGreaterThan(0);
 });
 it('trims reason, supports initial override version zero and rejects empty/oversized/type coercion',()=>{
  const body=plainToInstance(NearbyVisibilityDto,{hidden:true,reason:'  Wrong location  ',expectedVersion:0});expect(validateSync(body)).toEqual([]);expect(body.reason).toBe('Wrong location');
  for(const input of [{...body,reason:' '},{...body,reason:'x'.repeat(501)},{...body,hidden:'true'},{...body,expectedVersion:-1}])expect(validateSync(plainToInstance(NearbyVisibilityDto,input)).length).toBeGreaterThan(0);
 });
 it('Swagger declares the full public shape and hidden metadata separately without personal fields',()=>{
  expect(nearbyResponseSchema.required).toContain('snapshotVersion');expect(nearbyResponseSchema.required).toContain('center');
  expect((nearbyAdminSchema.items as {required:string[]}).required).toContain('hidden');
  expect(JSON.stringify([nearbyResponseSchema,nearbyAdminSchema])).not.toMatch(/phone|email|bank|guestName|hostName/iu);
 });
});
