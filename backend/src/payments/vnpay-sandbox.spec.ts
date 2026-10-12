import { createHmac } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { createVnpaySandboxAdapter } from './vnpay-sandbox.js';

// Synthetic local vectors, NOT provider credentials/callbacks or payment proof.
const secret='fixture-only-vnpay-secret-not-a-credential-12345';
const config=()=>({tmnCode:'FIXTURE1',hashSecret:secret,returnUrl:'https://trotot.example/payment/return'});
const adapter=()=>createVnpaySandboxAdapter(config());
const fields=()=>({vnp_Amount:'350050000',vnp_BankCode:'NCB',vnp_BankTranNo:'NCB123',vnp_CardType:'ATM',
  vnp_OrderInfo:'Thanh toan don ABC123',vnp_PayDate:'20261007001500',vnp_ResponseCode:'00',vnp_TmnCode:'FIXTURE1',
  vnp_TransactionNo:'123456789',vnp_TransactionStatus:'00',vnp_TxnRef:'ABC123'});
const goldenData='vnp_Amount=350050000&vnp_BankCode=NCB&vnp_BankTranNo=NCB123&vnp_CardType=ATM&vnp_OrderInfo=Thanh+toan+don+ABC123&vnp_PayDate=20261007001500&vnp_ResponseCode=00&vnp_TmnCode=FIXTURE1&vnp_TransactionNo=123456789&vnp_TransactionStatus=00&vnp_TxnRef=ABC123';
const goldenHash='a4727b8d399851ed600923ca9dc96dd37ea4ae4d4bba2665df02dd6c91e430325c069b00ca24d8c0f8d6e36fb857442ae95e8867a80fec54b2724963316d0b6d';
// Independent native form serialization, not the adapter's checksum helper.
function signed(values:Record<string,string>,key=secret) {
  const data=new URLSearchParams(Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0)).toString().replace(/\*/g,'%2A');
  return `${data}&vnp_SecureHash=${createHmac('sha512',key).update(data,'utf8').digest('hex')}`;
}
const redirect=()=>({transactionRef:'ABC123',amountVnd:'3500500',clientIp:'127.0.0.1',
  createdAt:new Date('2026-10-06T17:00:00Z'),expiresAt:new Date('2026-10-06T17:15:00Z')});

describe('S4 VNPay PAY 2.1.0 sandbox protocol (synthetic vectors only, no booking mutation)',()=>{
  it('verifies a fixed checksum vector and preserves string amounts/provider transaction identity',()=>{
    const result=adapter().verifyIpn(`${goldenData}&vnp_SecureHash=${goldenHash}`);
    expect(result).toMatchObject({provider:'VNPAY_SANDBOX',merchantCode:'FIXTURE1',transactionRef:'ABC123',transactionNo:'123456789',
      amountVnd:'3500500',currency:'VND',providerReportedSuccess:true,payDate:'2026-10-06T17:15:00.000Z'});
    expect(result.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty('paid');expect(result).not.toHaveProperty('bookingStatus');
    expect(JSON.stringify(result)).not.toContain(secret);expect(JSON.stringify(result)).not.toContain(goldenHash);
  });
  it('builds only the fixed sandbox redirect, exact amount ×100 and Vietnam time across UTC midnight',()=>{
    const url=new URL(adapter().createRedirect(redirect()));
    expect(url.origin+url.pathname).toBe('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html');
    const params=url.searchParams,hash=params.get('vnp_SecureHash');params.delete('vnp_SecureHash');
    expect(Object.fromEntries(params)).toEqual({vnp_Amount:'350050000',vnp_Command:'pay',vnp_CreateDate:'20261007000000',vnp_CurrCode:'VND',
      vnp_ExpireDate:'20261007001500',vnp_IpAddr:'127.0.0.1',vnp_Locale:'vn',vnp_OrderInfo:'Thanh toan don ABC123',vnp_OrderType:'other',
      vnp_ReturnUrl:config().returnUrl,vnp_TmnCode:'FIXTURE1',vnp_TxnRef:'ABC123',vnp_Version:'2.1.0'});
    expect(hash).toBe(createHmac('sha512',secret).update(params.toString()).digest('hex'));
    expect(url.toString()).not.toContain(secret);expect(params.has('vnp_SecureHashType')).toBe(false);
  });
  it('uses encoded query data once, including spaces, plus, percent and PHP punctuation rules',()=>{
    const values={...fields(),vnp_OrderInfo:"Don: A+B %20 !'()*~"};
    expect(adapter().verifyIpn(signed(values))).toMatchObject({amountVnd:'3500500',providerReportedSuccess:true});
    expect(adapter().verifyIpn(signed(values).replaceAll('+','%20'))).toEqual(adapter().verifyIpn(signed(values)));
  });
  it('authenticates all values, not just amount: every field tamper invalidates the fixed signature',()=>{
    for (const key of Object.keys(fields())) {
      const query=new URLSearchParams(`${goldenData}&vnp_SecureHash=${goldenHash}`);query.set(key,query.get(key)+'x');
      expect(()=>adapter().verifyIpn(query.toString())).toThrow();
    }
  });
  it('preserves signature validity across query ordering and hex case without changing payload identity',()=>{
    const query=[...new URLSearchParams(goldenData)].reverse();
    const reordered=new URLSearchParams(query).toString()+`&vnp_SecureHash=${goldenHash.toUpperCase()}`;
    expect(adapter().verifyIpn(reordered)).toEqual(adapter().verifyIpn(`${goldenData}&vnp_SecureHash=${goldenHash}`));
  });
  it.each(['vnp_Amount','vnp_TmnCode','vnp_SecureHash'])('rejects duplicate %s even when both values match',key=>{
    const query=`${goldenData}&vnp_SecureHash=${goldenHash}&${key}=${key==='vnp_SecureHash'?goldenHash:fields()[key as keyof ReturnType<typeof fields>]}`;
    expect(()=>adapter().verifyIpn(query)).toThrow();
  });
  it('rejects encoded duplicate names, nested query keys and unsupported hash algorithm downgrade',()=>{
    for (const extra of ['%76np_Amount=350050000','vnp_Amount[]=350050000','vnp_SecureHashType=SHA256','utm_source=forged'])
      expect(()=>adapter().verifyIpn(`${goldenData}&vnp_SecureHash=${goldenHash}&${extra}`)).toThrow();
  });
  it.each(['','zz','0'.repeat(127),'0'.repeat(129),'g'.repeat(128)])('rejects malformed digest without timingSafeEqual length errors',hash=>{
    expect(()=>adapter().verifyIpn(`${goldenData}&vnp_SecureHash=${hash}`)).toThrow('Dữ liệu cổng thanh toán không hợp lệ.');
  });
  it('rejects a different key and a signed callback for a different merchant',()=>{
    expect(()=>adapter().verifyIpn(signed(fields(),'different-fixture-secret-1234567890'))).toThrow();
    expect(()=>adapter().verifyIpn(signed({...fields(),vnp_TmnCode:'FIXTURE2'}))).toThrow();
  });
  it.each([
    {vnp_Amount:'100.5'},{vnp_Amount:'-100'},{vnp_Amount:'1e3'},{vnp_Amount:'NaN'},{vnp_Amount:'101'},
    {vnp_Amount:'1000000000000'},{vnp_Amount:'0'},{vnp_CurrCode:'USD'},{vnp_TransactionNo:'0'},
    {vnp_TransactionNo:'a123'},{vnp_TransactionNo:'1234567890123456'},{vnp_ResponseCode:'0'},
    {vnp_TransactionStatus:'PAID'},{vnp_BankCode:''},{vnp_OrderInfo:''},{vnp_OrderInfo:'a'.repeat(256)},
    {vnp_TxnRef:'ABC/123'},{vnp_BankTranNo:'not an id'},{vnp_CardType:'ATM123'},
    {vnp_PayDate:'20260230010000'},{vnp_PayDate:'20261007240000'},{vnp_PayDate:'20261007006000'},
    {vnp_PayDate:'20261007000060'},{vnp_PayDate:'19691231235959'},{vnp_PayDate:'2026-10-07'},
  ])('rejects a validly signed but invalid notification %#',patch=>{
    expect(()=>adapter().verifyIpn(signed({...fields(),...patch}))).toThrow();
  });
  it.each(['vnp_Amount','vnp_TxnRef','vnp_TransactionNo','vnp_TmnCode','vnp_BankCode','vnp_OrderInfo','vnp_ResponseCode','vnp_TransactionStatus'])('requires %s even with valid checksum',field=>{
    const values:Record<string,string>={...fields()};delete values[field];expect(()=>adapter().verifyIpn(signed(values))).toThrow();
  });
  it('does not confuse failure/partial status with provider-reported success or fabricate a missing payment date',()=>{
    const values:Record<string,string>={...fields(),vnp_ResponseCode:'24',vnp_TransactionNo:'0'};delete values.vnp_PayDate;
    expect(adapter().verifyIpn(signed(values))).toMatchObject({providerReportedSuccess:false,payDate:null});
    expect(adapter().verifyIpn(signed({...fields(),vnp_TransactionStatus:'02'}))).toMatchObject({providerReportedSuccess:false});
    expect(adapter().verifyIpn(signed({...fields(),vnp_ResponseCode:'24'}))).toMatchObject({providerReportedSuccess:false});
  });
  it('validates an actual leap day and preserves protocol upper amount boundary without floating point',()=>{
    expect(adapter().verifyIpn(signed({...fields(),vnp_PayDate:'20280229000000',vnp_Amount:'999999999900'})))
      .toMatchObject({amountVnd:'9999999999',payDate:'2028-02-28T17:00:00.000Z'});
    expect(new URL(adapter().createRedirect({...redirect(),amountVnd:'9999999999',clientIp:'2001:db8::1'})).searchParams.get('vnp_Amount')).toBe('999999999900');
  });
  it.each(['%ZZ','%A','%','%ff','%00'])('rejects malformed encoding/control characters %s',suffix=>{
    expect(()=>adapter().verifyIpn(`${goldenData}&vnp_SecureHash=${goldenHash}&vnp_CardType=${suffix}`)).toThrow();
  });
  it.each(['\u0000','\n','\u007f','\ufffd'])('rejects a singly occurring, correctly signed text field with forbidden character %#',character=>{
    expect(()=>adapter().verifyIpn(signed({...fields(),vnp_OrderInfo:`Don${character}ABC123`}))).toThrow();
  });
  it('rejects invalid UTF-8 in a single parameter rather than only rejecting a duplicate key',()=>{
    const query=`${goldenData.replace('Thanh+toan+don+ABC123','Don%ffABC123')}&vnp_SecureHash=${goldenHash}`;
    expect(()=>adapter().verifyIpn(query)).toThrow();
  });
  it('authenticates an under/over amount without treating it as the booking amount; fingerprints changed provider content',()=>{
    const original=adapter().verifyIpn(signed(fields()));
    for (const vnp_Amount of ['350049900','350050100']) {
      const event=adapter().verifyIpn(signed({...fields(),vnp_Amount}));
      expect(event.transactionNo).toBe(original.transactionNo);
      expect(event.amountVnd).not.toBe(original.amountVnd);expect(event.payloadHash).not.toBe(original.payloadHash);
      expect(event).not.toHaveProperty('bookingStatus'); // locked DB consumer must reconcile, never auto-confirm mismatch
    }
  });
  it('bounds raw payload size and never includes input/key/signature in errors',()=>{
    for(const raw of ['', 'x'.repeat(8193),`${goldenData}&vnp_SecureHash=${'0'.repeat(128)}`]) {
      // Assert rejection outside catch; otherwise catching expect.fail itself
      // could hide an adapter accidentally accepting this payload.
      expect(()=>adapter().verifyIpn(raw)).toThrow();
      try {adapter().verifyIpn(raw);}catch(error) {
        expect(String(error)).not.toContain(secret);expect(String(error)).not.toContain(goldenData);expect(String(error)).not.toContain(goldenHash);
      }
    }
  });
  it.each(['0','-1','1.5','1e3','NaN',' 100','0100','10000000000'])('rejects redirect amount %s without generating a payment link',amountVnd=>{
    expect(()=>adapter().createRedirect({...redirect(),amountVnd})).toThrow();
  });
  it('rejects invalid IP/ref/date and a deadline not strictly later at provider precision',()=>{
    for (const patch of [{clientIp:'not an ip'},{clientIp:''},{transactionRef:'ABC-123'},{transactionRef:'a'.repeat(101)},
      {createdAt:new Date(NaN)},{expiresAt:new Date(NaN)},{expiresAt:redirect().createdAt},
      {expiresAt:new Date(redirect().createdAt.getTime()+999)}])
      expect(()=>adapter().createRedirect({...redirect(),...patch})).toThrow();
  });
  it.each([{tmnCode:''},{tmnCode:'123456789'},{hashSecret:''},{hashSecret:'short'},
    {returnUrl:'not-a-url'},{returnUrl:'http://trotot.example/return'},{returnUrl:'https://user:pass@trotot.example/return'},
    {returnUrl:'https://trotot.example/return#secret'},{returnUrl:`https://trotot.example/${'x'.repeat(255)}`}])('rejects incomplete/unsafe config %#',patch=>{
    expect(()=>createVnpaySandboxAdapter({...config(),...patch})).toThrow('Chưa cấu hình VNPay Sandbox hợp lệ.');
  });
  it('snapshots server config against caller mutation',()=>{
    const cfg=config(),instance=createVnpaySandboxAdapter(cfg);cfg.hashSecret='new-fixture-secret-12345678901234567890';cfg.tmnCode='FIXTURE2';cfg.returnUrl='https://different.example/return';
    expect(instance.verifyIpn(`${goldenData}&vnp_SecureHash=${goldenHash}`).merchantCode).toBe('FIXTURE1');
    expect(new URL(instance.createRedirect(redirect())).searchParams.get('vnp_ReturnUrl')).toBe(config().returnUrl);
  });
});
