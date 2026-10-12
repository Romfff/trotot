import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {QueryClient} from "@tanstack/react-query";
import {createSharedSessionSynchronizer} from "../src/lib/bootstrap-session";
import {authApi} from "../src/lib/api/client";
import {getSharedSessionId,isLogoutPending} from "../src/lib/auth-channel";
import {useAuthStore} from "../src/stores/auth-store";
import {ApiError} from "../src/lib/auth-types";
vi.mock("../src/lib/api/client",()=>({authApi:{refresh:vi.fn(),me:vi.fn()}}));
vi.mock("../src/lib/auth-channel",()=>({getSharedSessionId:vi.fn(),isLogoutPending:vi.fn()}));
const user={id:"shared-test",phone:"0990000000",email:null,fullName:"Fixture",role:"ADMIN"as const,avatarUrl:null,isPhoneVerified:true,isIdentityVerified:false,status:"ACTIVE",createdAt:null,updatedAt:null};
beforeEach(()=>{vi.clearAllMocks();useAuthStore.getState().clearSession();vi.mocked(getSharedSessionId).mockReturnValue("new-session");vi.mocked(isLogoutPending).mockReturnValue(false);});
afterEach(()=>{useAuthStore.getState().clearSession();});
it("recovers a missed login via server refresh and clears old private cache",async()=>{
 const cache=new QueryClient();cache.setQueryData(["old-private"],"old-data");
 useAuthStore.getState().setSession("old-access",{...user,id:"old-user"},"old-session");
 vi.mocked(authApi.refresh).mockImplementation(async()=>{expect(cache.getQueryData(["old-private"])).toBeUndefined();expect(useAuthStore.getState().user).toBeNull();useAuthStore.getState().setSession("server-access",user,"new-session");return "server-access";});
 vi.mocked(authApi.me).mockResolvedValue(user);
 await createSharedSessionSynchronizer(cache,()=>true)();
 expect(authApi.refresh).toHaveBeenCalledOnce();expect(useAuthStore.getState()).toMatchObject({sessionId:"new-session",user,status:"authenticated"});
});
it.each(["logout","same-session","unmounted","no-shared-session"])("does not refresh for %s",async scenario=>{
 if(scenario==="logout")vi.mocked(isLogoutPending).mockReturnValue(true);
 if(scenario==="same-session")useAuthStore.getState().setSession("access",user,"new-session");
 if(scenario==="no-shared-session")vi.mocked(getSharedSessionId).mockReturnValue(null);
 await createSharedSessionSynchronizer(new QueryClient(),()=>scenario!=="unmounted")();expect(authApi.refresh).not.toHaveBeenCalled();
});
it("deduplicates concurrent notifications and does not spin after invalid credentials",async()=>{
 let reject!:()=>void;vi.mocked(authApi.refresh).mockImplementation(()=>new Promise((_resolve,rejectPromise)=>{reject=()=>rejectPromise(new ApiError(401,"REFRESH_TOKEN_REVOKED","Expired"));}));
 const sync=createSharedSessionSynchronizer(new QueryClient(),()=>true);const first=sync();await sync();expect(authApi.refresh).toHaveBeenCalledOnce();reject();await first;
 expect(authApi.refresh).toHaveBeenCalledOnce();expect(authApi.me).not.toHaveBeenCalled();expect(useAuthStore.getState().status).toBe("anonymous");
});
it("follows a newer identity arriving during synchronization without reviving the old one",async()=>{
 let release!:()=>void;let calls=0;vi.mocked(authApi.refresh).mockImplementation(async()=>{calls++;if(calls===1){await new Promise<void>(done=>{release=done;});throw new ApiError(0,"SESSION_CHANGED","Changed");}useAuthStore.getState().setSession("latest-access",user,"latest-session");return "latest-access";});vi.mocked(authApi.me).mockResolvedValue(user);
 const sync=createSharedSessionSynchronizer(new QueryClient(),()=>true);const first=sync();await vi.waitFor(()=>expect(release).toBeTypeOf("function"));vi.mocked(getSharedSessionId).mockReturnValue("latest-session");await sync();release();await first;
 await vi.waitFor(()=>expect(useAuthStore.getState().sessionId).toBe("latest-session"));expect(calls).toBe(2);
});
