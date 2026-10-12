import 'reflect-metadata';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder,SwaggerModule,type OpenAPIObject,type SchemaObject,type ResponseObject } from '@nestjs/swagger';
import { ComplaintsController } from './complaints.controller.js';
import { ComplaintsService } from './complaints.service.js';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';

describe('S4 complaint OpenAPI response contract (no DB or Auth execution)',()=>{
  let app:INestApplication,document:OpenAPIObject;
  beforeAll(async()=>{
    const builder=Test.createTestingModule({controllers:[ComplaintsController],providers:[{provide:ComplaintsService,useValue:{}}]});
    for(const guard of [AccessTokenGuard,RolesGuard,Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard]) builder.overrideGuard(guard).useValue({canActivate:()=>true});
    app=(await builder.compile()).createNestApplication();
    app.setGlobalPrefix('api/v1');
    document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
  });
  afterAll(async()=>{await app?.close();});
  const schema=(name:string)=>document.components!.schemas![name] as SchemaObject;
  function response(path:string,method:'get'|'post',status=200) {
    const result=document.paths[`/api/v1/${path}`][method]!.responses[status] as ResponseObject;
    return result.content!['application/json'].schema as SchemaObject;
  }
  it.each([
    ['bookings/{id}/complaints','post',201,'ComplaintRowDto'],
    ['host/finance/complaints/{id}','get',200,'ComplaintDetailDto'],
    ['admin/finance/complaints/{id}','get',200,'AdminComplaintDetailDto'],
    ['host/finance/complaints/{id}/respond','post',200,'ComplaintRowDto'],
    ['admin/finance/complaints/{id}/assign','post',200,'ComplaintRowDto'],
    ['admin/finance/complaints/{id}/resolve','post',200,'ComplaintResolvedDto'],
  ] as const)('documents %s %s status %s with %s',(path,method,status,name)=>{
    const envelope=response(path,method,status);
    expect(envelope.required).toEqual(['success','message','data']);
    expect(envelope.properties!.data).toEqual({allOf:[{$ref:`#/components/schemas/${name}`}]});
    const operation=document.paths[`/api/v1/${path}`][method]!;
    expect(operation.security).toEqual([{bearer:[]}]);
    expect(operation.responses[404]).toBeDefined();
    if(method==='post') {
      expect(operation.parameters).toContainEqual(expect.objectContaining({in:'header',name:'Idempotency-Key',required:true}));
      expect(operation.responses[409]).toBeDefined();
    }
  });
  it.each(['host/finance/complaints','admin/finance/complaints'])('keeps list metadata outside data at %s',path=>{
    const envelope=response(path,'get');
    expect(envelope.required).toContain('meta');
    expect(envelope.properties!.data).toEqual({type:'array',items:{$ref:'#/components/schemas/ComplaintRowDto'}});
    expect((envelope.properties!.meta as SchemaObject).required).toEqual(['page','limit','total','totalPages']);
    expect(schema('ComplaintRowDto').properties).not.toHaveProperty('events');
    expect(schema('ComplaintRowDto').properties).not.toHaveProperty('resolution');
  });
  it('documents Guest booking complaints as public-to-participants detail array, not pagination',()=>{
    const envelope=response('bookings/{id}/complaints','get');
    expect(envelope.properties!.data).toEqual({type:'array',items:{$ref:'#/components/schemas/ComplaintDetailDto'}});
    expect(envelope.properties).not.toHaveProperty('meta');
  });
  it('keeps evidence and actor IDs only in the Admin resolution schema',()=>{
    const publicResolution=schema('ComplaintResolutionDto');
    expect(publicResolution.required).toEqual(['decision','reason','resolvedAt']);
    expect(Object.keys(publicResolution.properties!)).toEqual(['decision','reason','resolvedAt','refundObligation','holdUntil']);
    expect(publicResolution.properties!.decision).toMatchObject({enum:['HOST','FULL_REFUND','PARTIAL_REFUND']});
    expect(publicResolution.properties).not.toHaveProperty('evidenceNote');expect(publicResolution.properties).not.toHaveProperty('actorId');
    expect(schema('AdminComplaintResolutionDto').required).toEqual(expect.arrayContaining(['actorId','evidenceNote']));
    expect(schema('ComplaintDetailDto').properties!.resolution).toMatchObject({nullable:true,allOf:[{$ref:'#/components/schemas/ComplaintResolutionDto'}]});
    expect(schema('AdminComplaintDetailDto').properties!.resolution).toMatchObject({nullable:true,allOf:[{$ref:'#/components/schemas/AdminComplaintResolutionDto'}]});
    expect(schema('ComplaintEventDto').properties).not.toHaveProperty('actorId');
    expect(schema('ComplaintEventDto').properties).not.toHaveProperty('evidenceNote');
  });
  it('describes old HOST and approved refund decisions without claiming bank transfer',()=>{
    expect(schema('ComplaintRowDto').properties!.assigneeId).toMatchObject({type:'string',format:'uuid',nullable:true});
    expect(schema('ComplaintRowDto').properties!.version).toMatchObject({type:'integer',minimum:1,maximum:2147483647});
    expect(schema('ComplaintResolvedDto').properties!.status).toMatchObject({enum:['RESOLVED']});
    expect(schema('ComplaintResolvedDto').properties!.overdue).toMatchObject({enum:[false]});
    expect(schema('ComplaintResolvedDto').properties!.version).toMatchObject({minimum:2});
    expect(schema('ComplaintResolvedDto').properties!.resolution).toMatchObject({$ref:'#/components/schemas/ComplaintResolutionDto'});
    expect(schema('ResolveComplaintDto').properties!.decision).toMatchObject({enum:['HOST','FULL_REFUND','PARTIAL_REFUND']});
    expect(schema('ResolveComplaintDto').properties).toHaveProperty('allocation');
    expect(schema('ResolveComplaintDto').properties).toHaveProperty('expectedBookingVersion');
  });
  it('documents separate Admin late intake with required private evidence and idempotency without changing participant schemas',()=>{
    const path='admin/finance/bookings/{id}/late-refund-cases',operation=document.paths[`/api/v1/${path}`].post!;
    expect(operation.security).toEqual([{bearer:[]}]);
    expect(operation.parameters).toContainEqual(expect.objectContaining({in:'header',name:'Idempotency-Key',required:true}));
    expect(schema('CreateAdminLateRefundCaseDto').required).toEqual(expect.arrayContaining(['expectedVersion','reason','evidenceNote']));
    expect(response(path,'post',201).properties!.data).toMatchObject({allOf:expect.arrayContaining([expect.objectContaining({required:['caseType','caseLabel']})])});
    expect(schema('AdminComplaintDetailDto').properties).toHaveProperty('lateCase');
    expect(schema('ComplaintDetailDto').properties).not.toHaveProperty('lateCase');
    expect(schema('ComplaintRowDto').properties).not.toHaveProperty('lateCase');
  });
});
