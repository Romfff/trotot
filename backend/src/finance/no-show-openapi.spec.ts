import 'reflect-metadata';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {DocumentBuilder,SwaggerModule,type OpenAPIObject,type SchemaObject,type ResponseObject} from '@nestjs/swagger';
import {NoShowController} from './no-show.controller.js';
import {NoShowService} from './no-show.service.js';
import {AccessTokenGuard} from '../auth/access-token.guard.js';
import {RolesGuard} from '../auth/roles.guard.js';
import {Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard} from '../common/sprint2-rate-limit.guard.js';

describe('S4 no-show OpenAPI (metadata only, no Auth or DB execution)',()=>{
  let app:INestApplication,document:OpenAPIObject;
  beforeAll(async()=>{
    const builder=Test.createTestingModule({controllers:[NoShowController],providers:[{provide:NoShowService,useValue:{}}]});
    for(const guard of [AccessTokenGuard,RolesGuard,Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard])builder.overrideGuard(guard).useValue({canActivate:()=>true});
    app=(await builder.compile()).createNestApplication();app.setGlobalPrefix('api/v1');
    document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
  });
  afterAll(async()=>{await app?.close();});
  const schema=(name:string)=>document.components!.schemas![name] as SchemaObject;
  const response=(path:string,method:'get'|'post',status:number)=>((document.paths[`/api/v1/${path}`][method]!.responses[status] as ResponseObject).content!['application/json'].schema as SchemaObject);
  it.each([
    ['host/bookings/{id}/no-show-report','post',201,'NoShowReportCreatedDto'],
    ['admin/finance/bookings/{id}/resolve-stay','post',200,'NoShowResolvedDto'],
    ['admin/finance/no-show-reports/{id}','get',200,'NoShowReportDetailDto'],
  ] as const)('documents %s %s with exact envelope/response',(path,method,status,name)=>{
    const envelope=response(path,method,status);expect(envelope.required).toEqual(['success','message','data']);
    expect(envelope.properties!.data).toEqual({allOf:[{$ref:`#/components/schemas/${name}`}]});
    const operation=document.paths[`/api/v1/${path}`][method]!;expect(operation.security).toEqual([{bearer:[]}]);
    for(const code of [400,401,403,404,429,503])expect(operation.responses[code]).toBeDefined();
    if(method==='post'){expect(operation.responses[409]).toBeDefined();expect(operation.parameters).toContainEqual(expect.objectContaining({in:'header',name:'Idempotency-Key',required:true}));}
  });
  it('documents pagination outside list data, with resolved flag only on list rows',()=>{
    const envelope=response('admin/finance/no-show-reports','get',200);
    expect(envelope.required).toContain('meta');expect(envelope.properties!.data).toEqual({type:'array',items:{$ref:'#/components/schemas/NoShowReportRowDto'}});
    expect((envelope.properties!.meta as SchemaObject).required).toEqual(['page','limit','total','totalPages']);
    expect(schema('NoShowReportRowDto').properties!.resolved).toMatchObject({type:'boolean'});
    expect(schema('NoShowReportDetailDto').properties).not.toHaveProperty('resolved');
  });
  it('keeps private resolution evidence in Admin detail, absent from report/list/write result',()=>{
    expect(schema('NoShowReportDetailDto').properties!.resolution).toMatchObject({nullable:true,allOf:[{$ref:'#/components/schemas/NoShowResolutionDto'}]});
    expect(Object.keys(schema('NoShowResolutionDto').properties!)).toEqual(['actorId','reason','evidenceNote','resolvedAt']);
    for(const name of ['NoShowReportCreatedDto','NoShowReportRowDto','NoShowResolvedDto']){
      const props=schema(name).properties!;for(const privateField of ['actorId','evidenceNote','guestPhone','guestName','bankAccount'])expect(props).not.toHaveProperty(privateField);
    }
  });
  it('describes only NO_SHOW and zero string refund, not partial stay or completed/payment mutation',()=>{
    const props=schema('NoShowResolvedDto').properties!;
    expect(props.decision).toMatchObject({enum:['NO_SHOW']});expect(props.refundAmount).toMatchObject({type:'string',enum:['0']});
    expect(props.resolvedAt).toMatchObject({format:'date-time'});expect(props.holdUntil).toMatchObject({format:'date-time'});
    for(const field of ['bookingStatus','paymentStatus','completedAt','amount'])expect(props).not.toHaveProperty(field);
    expect(schema('ResolveNoShowDto').properties!.decision).toMatchObject({enum:['NO_SHOW']});
  });
  it('documents UUIDs, bounded booking version and trimmed request evidence lengths',()=>{
    const props=schema('NoShowReportCreatedDto').properties!;
    expect(props.id).toMatchObject({format:'uuid'});expect(props.bookingId).toMatchObject({format:'uuid'});
    expect(props.bookingVersion).toMatchObject({type:'integer',minimum:2,maximum:2147483647});
    expect(schema('NoShowReportDto').properties!.reason).toMatchObject({minLength:1,maxLength:500});
    expect(schema('ResolveNoShowDto').properties!.evidenceNote).toMatchObject({minLength:1,maxLength:500});
  });
});
