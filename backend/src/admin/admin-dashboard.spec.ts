import { describe,expect,it } from 'vitest';
import { dashboardRange } from './admin-dashboard.service.js';
describe('S5 Admin dashboard calendar boundaries',()=>{
  it('includes the last day and converts Vietnam midnight exactly',()=>{
    expect(dashboardRange('2026-01-01','2026-01-31')).toEqual({start:new Date('2025-12-31T17:00:00Z'),end:new Date('2026-01-31T17:00:00Z')});
    expect(dashboardRange('2026-10-08','2026-10-08')).toEqual({start:new Date('2026-10-07T17:00:00Z'),end:new Date('2026-10-08T17:00:00Z')});
  });
  it('accepts a leap year of 366 days',()=>{expect(dashboardRange('2024-01-01','2024-12-31').end.toISOString()).toBe('2024-12-31T17:00:00.000Z');});
  it.each([['2026-02-29','2026-03-01'],['2026-02-30','2026-03-01'],['2026-01-02','2026-01-01'],['2026-01-01','2027-01-02'],['0000-01-01','0000-01-02'],['2026-1-01','2026-01-02'],['2026-01-01T00:00:00Z','2026-01-02'],['','2026-01-02']])('rejects invalid range %s to %s',(from,to)=>{
    expect(()=>dashboardRange(from,to)).toThrow(expect.objectContaining({status:400}));
  });
});
