import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt, SignJWT } from 'jose';
import { calculateStayPrice } from '../bookings/booking-pricing.js';
import { HOMESTAY_QUOTE_SECONDS,signHomestayQuote,verifyHomestayQuote } from './homestay-quote.js';

const secret = 'test-only-independent-quote-secret-32characters';
const now = new Date('2026-10-21T10:00:00Z');
const input = { unitId:'11111111-1111-4111-8111-111111111111',checkIn:'2026-10-22',checkOut:'2026-10-26',adults:2,children:1 };
const config = { basePricePerNight:'100.50',weekendPricePerNight:'110.49',cleaningFee:'4.50',
  serviceFeeRate:'5',taxRate:'8',commissionRate:'12',customPrices:new Map<string,string>() };
const price = () => calculateStayPrice(input.checkIn,input.checkOut,config);

describe('server-signed homestay quote', () => {
  beforeEach(() => vi.stubEnv('HOMESTAY_QUOTE_SECRET',secret));
  afterEach(() => vi.unstubAllEnvs());

  it('binds a server price snapshot for exactly fifteen minutes without exposing payout, commission or PII', async () => {
    const quote = await signHomestayQuote(input,price(),now);
    expect(HOMESTAY_QUOTE_SECONDS).toBe(900);
    expect(quote.quoteExpiresAt).toBe('2026-10-21T10:15:00.000Z');
    expect(quote.quoteToken.length).toBeLessThan(2048);
    const payload = decodeJwt(quote.quoteToken);
    expect(payload).toEqual({ ...input,version:1,priceHash:expect.stringMatching(/^[a-f0-9]{64}$/),
      iss:'trotot',aud:'homestay-quote',iat:Math.floor(now.getTime()/1000),exp:Math.floor(now.getTime()/1000)+900 });
    expect(JSON.stringify(payload)).not.toMatch(/commission|payout|guestName|guestPhone|bookingCode/);
    expect(await verifyHomestayQuote(quote.quoteToken,input,price(),now)).toEqual({ priceChanged:false,quoteExpiresAt:quote.quoteExpiresAt });
  });
  it.each(['unitId','checkIn','checkOut','adults','children'] as const)('rejects a token reused for a different %s', async field => {
    const quote = await signHomestayQuote(input,price(),now);
    const changed = { ...input,[field]:typeof input[field] === 'number' ? Number(input[field])+1 : `${input[field]}-different` };
    await expect(verifyHomestayQuote(quote.quoteToken,changed,price(),now)).rejects.toMatchObject({ status:400 });
  });
  it('rejects altered payload/signature, empty/oversized token and unsigned or access-token-shaped input', async () => {
    const quote = await signHomestayQuote(input,price(),now);
    const parts = quote.quoteToken.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...decodeJwt(quote.quoteToken),adults:1 })).toString('base64url');
    const invalid = [parts.join('.'),'', 'x'.repeat(2049),`${quote.quoteToken.slice(0,-10)}tampered00`,
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`];
    for (const token of invalid) await expect(verifyHomestayQuote(token,input,price(),now)).rejects.toMatchObject({ status:400 });
    const access = await new SignJWT({ tokenType:'access',role:'TENANT' }).setProtectedHeader({ alg:'HS256' }).sign(new TextEncoder().encode(secret));
    await expect(verifyHomestayQuote(access,input,price(),now)).rejects.toMatchObject({ status:400 });
  });
  it('accepts immediately before expiry and rejects exactly at expiry or later with a clear error', async () => {
    const quote = await signHomestayQuote(input,price(),now);
    expect((await verifyHomestayQuote(quote.quoteToken,input,price(),new Date(now.getTime()+899999))).priceChanged).toBe(false);
    for (const extra of [900000,900001]) {
      await expect(verifyHomestayQuote(quote.quoteToken,input,price(),new Date(now.getTime()+extra))).rejects.toMatchObject({ response:{ errorCode:'QUOTE_EXPIRED' } });
    }
  });
  it.each([
    { basePricePerNight:'102' },{ cleaningFee:'6' },{ serviceFeeRate:'6' },{ taxRate:'9' },{ commissionRate:'10' },
    { customPrices:new Map([['2026-10-23','123']]) },
  ])('detects a changed server snapshot %j without creating an order', async change => {
    const quote = await signHomestayQuote(input,price(),now);
    const changed = calculateStayPrice(input.checkIn,input.checkOut,{ ...config,...change });
    expect((await verifyHomestayQuote(quote.quoteToken,input,changed,now)).priceChanged).toBe(true);
  });
  it('keeps matching quotes for raw Decimal changes that produce exactly the same rounded snapshot', async () => {
    const quote = await signHomestayQuote(input,price(),now);
    const same = calculateStayPrice(input.checkIn,input.checkOut,{ ...config,basePricePerNight:'100.51' });
    expect((await verifyHomestayQuote(quote.quoteToken,input,same,now)).priceChanged).toBe(false);
  });
  it('issues a zero quote normally and does not infer PAID/CONFIRMED or a free-booking flow', async () => {
    const zero = calculateStayPrice(input.checkIn,input.checkOut,{ ...config,basePricePerNight:0,weekendPricePerNight:0,cleaningFee:0,serviceFeeRate:0,taxRate:0 });
    const quote = await signHomestayQuote(input,zero,now);
    expect(zero.totalAmount.toString()).toBe('0');
    expect((await verifyHomestayQuote(quote.quoteToken,input,zero,now)).priceChanged).toBe(false);
    expect(decodeJwt(quote.quoteToken)).not.toHaveProperty('paymentStatus');
  });
  it.each(['','short'])('fails closed when signing is unconfigured (%s)', async value => {
    vi.stubEnv('HOMESTAY_QUOTE_SECRET',value);
    await expect(signHomestayQuote(input,price(),now)).rejects.toMatchObject({ status:503,response:{ errorCode:'QUOTE_SIGNING_NOT_CONFIGURED' } });
  });
  it('does not permit quote/auth signing-key reuse or a key changed after issue', async () => {
    vi.stubEnv('JWT_ACCESS_SECRET',secret);
    await expect(signHomestayQuote(input,price(),now)).rejects.toMatchObject({ status:503 });
    vi.stubEnv('JWT_ACCESS_SECRET','another-test-only-access-secret-32characters');
    const quote = await signHomestayQuote(input,price(),now);
    vi.stubEnv('HOMESTAY_QUOTE_SECRET','another-test-only-independent-signing-key');
    await expect(verifyHomestayQuote(quote.quoteToken,input,price(),now)).rejects.toMatchObject({ status:400 });
  });
  it('rejects even signed tokens with a different purpose/algorithm/TTL or a future issue time', async () => {
    const quote = await signHomestayQuote(input,price(),now); const payload = decodeJwt(quote.quoteToken);
    for (const change of [{ iss:'other' },{ aud:'other' },{ iat:payload.iat!+1 },{ exp:payload.exp!+1 },{ version:2 }]) {
      const token = await new SignJWT({ ...payload,...change }).setProtectedHeader({ alg:'HS256',typ:'trotot-homestay-quote+jwt' }).sign(new TextEncoder().encode(secret));
      await expect(verifyHomestayQuote(token,input,price(),now)).rejects.toMatchObject({ status:400 });
    }
    const token = await new SignJWT(payload).setProtectedHeader({ alg:'HS384',typ:'trotot-homestay-quote+jwt' }).sign(new TextEncoder().encode(secret));
    await expect(verifyHomestayQuote(token,input,price(),now)).rejects.toMatchObject({ status:400 });
  });
});
