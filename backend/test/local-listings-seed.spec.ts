import { describe, expect, it } from 'vitest';
import { assertLocalDemoTarget } from '../prisma/local-listings-seed.js';
const local={NODE_ENV:'development',ALLOW_DEV_SEED:'true',DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:5432/local_demo'};
describe('explicit local listing fixtures guard',()=>{
  it.each(['localhost','127.0.0.1','[::1]'])('allows explicitly opted-in loopback %s',host=>{
    expect(()=>assertLocalDemoTarget({...local,DATABASE_URL:`postgresql://fixture:fixture@${host}:5432/local_demo`})).not.toThrow();
  });
  it.each([{NODE_ENV:'production'},{NODE_ENV:undefined},{ALLOW_DEV_SEED:undefined},{ALLOW_DEV_SEED:'false'},{DATABASE_URL:'postgresql://fixture:fixture@db.example.com/local_demo'},{DATABASE_URL:'postgresql://fixture:fixture@localhost/postgres'}])('rejects unsafe target %j',change=>{
    expect(()=>assertLocalDemoTarget({...local,...change})).toThrow();
  });
});
